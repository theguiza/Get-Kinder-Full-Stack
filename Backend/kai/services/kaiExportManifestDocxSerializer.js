import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { composeExportManifestRenderModel } from "./kaiExportManifestRenderModelService.js";

const DOCX_CONTRACT_VERSION = "kai-sprint2-export-manifest-docx-v1";

function isNonArrayObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeScalar(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n");
}

function citationMarker(citationRef) {
  return `[${normalizeScalar(citationRef)}]`;
}

function formatCitationRefs(citationRefs) {
  if (!Array.isArray(citationRefs) || citationRefs.length === 0) return null;
  return `References: ${citationRefs.map(citationMarker).join(" ")}`;
}

function formatLimitationCodes(codes) {
  if (!Array.isArray(codes) || codes.length === 0) return "none";
  return codes.join(", ");
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

function headingParagraph(text, level = HeadingLevel.HEADING_1) {
  return new Paragraph({ heading: level, children: [new TextRun({ text, bold: true })] });
}

function bodyParagraph(text) {
  return new Paragraph({ children: [new TextRun(text)] });
}

function bodyParagraphs(text) {
  return normalizeScalar(text).split("\n").map((line) => bodyParagraph(line));
}

function obliqueParagraph(text) {
  return new Paragraph({ children: [new TextRun({ text, italics: true })] });
}

function bulletParagraph(text) {
  return new Paragraph({ bullet: { level: 0 }, children: [new TextRun(text)] });
}

export function serializeExportManifestRenderModelToDocx(renderModel) {
  if (!validateRenderModel(renderModel)) {
    throw new TypeError("A valid export manifest render-model DTO is required.");
  }

  const children = [
    headingParagraph("Export Manifest", HeadingLevel.TITLE),
    bodyParagraph(`DOCX contract: ${DOCX_CONTRACT_VERSION}`),
    bodyParagraph(`Render model contract: ${normalizeScalar(renderModel.renderModelContractVersion)}`),
    bodyParagraph(`Content type: ${normalizeScalar(renderModel.exportCandidate.contentType)}`),
    bodyParagraph(`Requested audience: ${normalizeScalar(renderModel.exportCandidate.requestedAudience)}`),
    headingParagraph("Content"),
  ];

  for (const block of renderModel.content.blocks) {
    children.push(headingParagraph(`Block ${block.ordinal}`, HeadingLevel.HEADING_2));
    children.push(...bodyParagraphs(block.text));
    const refs = formatCitationRefs(block.citationRefs);
    if (refs) children.push(obliqueParagraph(refs));
  }

  children.push(headingParagraph("Citation Appendix"));
  if (renderModel.citations.length === 0) {
    children.push(bulletParagraph("none"));
  }
  for (const citation of renderModel.citations) {
    children.push(bulletParagraph(
      `${citationMarker(citation.citationRef)} Claim ${normalizeScalar(citation.claimId)}; `
        + `evidence ${normalizeScalar(citation.evidenceItemId)}; `
        + `source ${normalizeScalar(citation.sourceId)}; `
        + `source version ${normalizeScalar(citation.sourceVersionId)}.`,
    ));
  }

  children.push(headingParagraph("Limitations and Method Notes"));
  if (renderModel.methodNotes.limitationEntries.length === 0) {
    children.push(bulletParagraph("none"));
  }
  for (const entry of renderModel.methodNotes.limitationEntries) {
    const subject = entry.citationRef
      ? citationMarker(entry.citationRef)
      : `Claim ${normalizeScalar(entry.claimId)} / evidence ${normalizeScalar(entry.evidenceItemId)}`;
    children.push(bulletParagraph(`${subject} limitation codes: ${formatLimitationCodes(entry.limitationCodes)}.`));
  }

  const document = new Document({
    creator: "KAI",
    lastModifiedBy: "KAI",
    title: "Export Manifest",
    sections: [{ children }],
  });

  return Packer.toBuffer(document);
}

export async function serializeExportManifestToDocx(input, dependencies = {}) {
  const renderModelService = dependencies.composeExportManifestRenderModel || composeExportManifestRenderModel;
  const result = await renderModelService(input, dependencies.renderModelDependencies || {});
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      docxContractVersion: DOCX_CONTRACT_VERSION,
      docx: await serializeExportManifestRenderModelToDocx(result.data),
    },
    error: null,
  };
}

export const __exportManifestDocxSerializerTestables = Object.freeze({
  DOCX_CONTRACT_VERSION,
  validateRenderModel,
});
