import PDFDocument from "pdfkit";
import { composeExportManifestRenderModel } from "./kaiExportManifestRenderModelService.js";

const PDF_CONTRACT_VERSION = "kai-sprint2-export-manifest-pdf-v1";

// Fixed so PDFSecurity.generateFileID (and the Info dict) never vary between
// runs of the same render model - the only inputs pdfkit mixes into either
// are this Info object's own key/value pairs.
const DETERMINISTIC_CREATION_DATE = new Date(0);

const PAGE_MARGIN = 54;

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

function heading(doc, text) {
  doc.moveDown();
  doc.fontSize(14).font("Helvetica-Bold").text(text);
  doc.moveDown(0.5);
  doc.fontSize(11).font("Helvetica");
}

function subheading(doc, text) {
  doc.moveDown(0.5);
  doc.fontSize(12).font("Helvetica-Bold").text(text);
  doc.moveDown(0.25);
  doc.fontSize(11).font("Helvetica");
}

function bodyText(doc, text) {
  doc.fontSize(11).font("Helvetica").text(text, { align: "left" });
}

function bulletText(doc, text) {
  doc.fontSize(11).font("Helvetica").text(`• ${text}`, { align: "left" });
}

export function serializeExportManifestRenderModelToPdf(renderModel) {
  if (!validateRenderModel(renderModel)) {
    throw new TypeError("A valid export manifest render-model DTO is required.");
  }

  const doc = new PDFDocument({
    margins: { top: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN, right: PAGE_MARGIN },
    autoFirstPage: true,
    bufferPages: true,
    pdfVersion: "1.7",
    info: {
      Producer: "KAI",
      Creator: "KAI",
      CreationDate: DETERMINISTIC_CREATION_DATE,
    },
  });

  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  const finished = new Promise((resolve, reject) => {
    doc.on("end", resolve);
    doc.on("error", reject);
  });

  doc.fontSize(20).font("Helvetica-Bold").text("Export Manifest");
  doc.moveDown(0.5);
  doc.fontSize(10).font("Helvetica");
  doc.text(`PDF contract: ${PDF_CONTRACT_VERSION}`);
  doc.text(`Render model contract: ${normalizeScalar(renderModel.renderModelContractVersion)}`);
  doc.text(`Content type: ${normalizeScalar(renderModel.exportCandidate.contentType)}`);
  doc.text(`Requested audience: ${normalizeScalar(renderModel.exportCandidate.requestedAudience)}`);

  heading(doc, "Content");
  for (const block of renderModel.content.blocks) {
    subheading(doc, `Block ${block.ordinal}`);
    bodyText(doc, normalizeScalar(block.text));
    const refs = formatCitationRefs(block.citationRefs);
    if (refs) {
      doc.moveDown(0.25);
      doc.fontSize(10).font("Helvetica-Oblique").text(refs);
      doc.fontSize(11).font("Helvetica");
    }
  }

  heading(doc, "Citation Appendix");
  if (renderModel.citations.length === 0) {
    bulletText(doc, "none");
  }
  for (const citation of renderModel.citations) {
    bulletText(
      doc,
      `${citationMarker(citation.citationRef)} Claim ${normalizeScalar(citation.claimId)}; `
        + `evidence ${normalizeScalar(citation.evidenceItemId)}; `
        + `source ${normalizeScalar(citation.sourceId)}; `
        + `source version ${normalizeScalar(citation.sourceVersionId)}.`,
    );
  }

  heading(doc, "Limitations and Method Notes");
  if (renderModel.methodNotes.limitationEntries.length === 0) {
    bulletText(doc, "none");
  }
  for (const entry of renderModel.methodNotes.limitationEntries) {
    const subject = entry.citationRef
      ? citationMarker(entry.citationRef)
      : `Claim ${normalizeScalar(entry.claimId)} / evidence ${normalizeScalar(entry.evidenceItemId)}`;
    bulletText(doc, `${subject} limitation codes: ${formatLimitationCodes(entry.limitationCodes)}.`);
  }

  doc.end();
  return finished.then(() => Buffer.concat(chunks));
}

export async function serializeExportManifestToPdf(input, dependencies = {}) {
  const renderModelService = dependencies.composeExportManifestRenderModel || composeExportManifestRenderModel;
  const result = await renderModelService(input, dependencies.renderModelDependencies || {});
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      pdfContractVersion: PDF_CONTRACT_VERSION,
      pdf: await serializeExportManifestRenderModelToPdf(result.data),
    },
    error: null,
  };
}

export const __exportManifestPdfSerializerTestables = Object.freeze({
  PDF_CONTRACT_VERSION,
  validateRenderModel,
});
