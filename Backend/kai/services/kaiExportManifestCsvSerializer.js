import { composeExportManifestRenderModel } from "./kaiExportManifestRenderModelService.js";

const CSV_CONTRACT_VERSION = "kai-sprint2-export-manifest-csv-v1";
const CSV_HEADER = ["citation_ref", "claim_id", "evidence_item_id", "source_id", "source_version_id", "limitation_codes"];

function isNonArrayObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function csvField(value) {
  const normalized = String(value ?? "");
  if (/[",\n\r]/.test(normalized)) {
    return `"${normalized.replaceAll('"', '""')}"`;
  }
  return normalized;
}

function csvRow(fields) {
  return fields.map(csvField).join(",");
}

function limitationCodesByCitationRef(renderModel) {
  const byCitationRef = new Map();
  for (const entry of renderModel.methodNotes.limitationEntries) {
    if (!entry.citationRef) continue;
    byCitationRef.set(entry.citationRef, [...entry.limitationCodes].sort());
  }
  return byCitationRef;
}

export function serializeExportManifestRenderModelToCsv(renderModel) {
  if (!validateRenderModel(renderModel)) {
    throw new TypeError("A valid export manifest render-model DTO is required.");
  }

  const codesByCitationRef = limitationCodesByCitationRef(renderModel);
  const lines = [csvRow(CSV_HEADER)];
  for (const citation of renderModel.citations) {
    const codes = codesByCitationRef.get(citation.citationRef) || [];
    lines.push(csvRow([
      citation.citationRef,
      citation.claimId,
      citation.evidenceItemId,
      citation.sourceId,
      citation.sourceVersionId,
      codes.join(";"),
    ]));
  }

  return `${lines.join("\r\n")}\r\n`;
}

export async function serializeExportManifestToCsv(input, dependencies = {}) {
  const renderModelService = dependencies.composeExportManifestRenderModel || composeExportManifestRenderModel;
  const result = await renderModelService(input, dependencies.renderModelDependencies || {});
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      csvContractVersion: CSV_CONTRACT_VERSION,
      csv: serializeExportManifestRenderModelToCsv(result.data),
    },
    error: null,
  };
}

export const __exportManifestCsvSerializerTestables = Object.freeze({
  CSV_CONTRACT_VERSION,
  CSV_HEADER,
  validateRenderModel,
});
