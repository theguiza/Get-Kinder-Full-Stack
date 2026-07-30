import { detectCsvRowLimitPolicy } from "../validators/csvRowLimitDetector.js";
import { detectOoxmlArchiveResourceLimitPolicy } from "../validators/ooxmlArchiveResourceLimitDetector.js";
import { detectP0FileTypeAgreement } from "../validators/p0FileTypeAgreementDetector.js";
import { runPdfAssessorWorkerBoundary } from "../validators/pdfAssessorWorkerBoundary.js";
import { runMalwareScanWithAdapter } from "./malwareScanAdapter.js";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PDF_MIME = "application/pdf";
const CSV_MIMES = Object.freeze(new Set(["text/csv", "application/csv"]));
const TEXT_EXTENSIONS = Object.freeze(new Set([".txt", ".md"]));

const PASS_RESULT = Object.freeze({ policy: "pass" });
const ASSESSMENT_FAILURE_RESULT = Object.freeze({
  status: "failed",
  category: "security_assessment_timeout",
});

function passResult() {
  return { ...PASS_RESULT };
}

function blockResult(category) {
  return { policy: "block", category };
}

function assessmentFailureResult(category = ASSESSMENT_FAILURE_RESULT.category) {
  return { status: "failed", category };
}

function isBlockResult(result) {
  return (
    result &&
    typeof result === "object" &&
    result.policy === "block" &&
    typeof result.category === "string"
  );
}

function isPassTypeAgreement(result, extension, declaredMime) {
  return (
    result &&
    typeof result === "object" &&
    result.policy === "allow" &&
    result.category === "type_agreement_pass" &&
    result.evidence?.normalized_extension === extension &&
    result.evidence?.normalized_declared_mime === declaredMime
  );
}

function isFailureResult(result) {
  return (
    result &&
    typeof result === "object" &&
    result.status === "failed" &&
    typeof result.category === "string"
  );
}

function normalizeDeclaredMime(declaredMime) {
  return declaredMime.trim().toLowerCase();
}

function normalizeInput({ extension, declaredMime, bytes, sha256 } = {}) {
  if (typeof extension !== "string") return null;
  if (typeof declaredMime !== "string") return null;
  if (!(bytes instanceof Uint8Array)) return null;
  return Object.freeze({
    extension: extension.toLowerCase(),
    declaredMime: normalizeDeclaredMime(declaredMime),
    bytes,
    sha256: typeof sha256 === "string" ? sha256 : undefined,
  });
}

async function assessMalware(input, dependencies) {
  const result = await runMalwareScanWithAdapter(
    { bytes: input.bytes, sha256: input.sha256 },
    dependencies,
  );
  if (result.status === "clean") return passResult();
  if (result.status === "malware_detected") return blockResult("malware_failed");
  if (isFailureResult(result)) return assessmentFailureResult(result.category);
  return assessmentFailureResult("malware_scan_failed");
}

async function passAfterMalwareScan(input, dependencies) {
  try {
    return await assessMalware(input, dependencies);
  } catch {
    return assessmentFailureResult("malware_scan_failed");
  }
}

function defaultDetectors() {
  return Object.freeze({
    detectP0FileTypeAgreement,
    detectCsvRowLimitPolicy,
    detectOoxmlArchiveResourceLimitPolicy,
    runPdfAssessorWorkerBoundary,
  });
}

async function assessCsv(input, detectors) {
  const result = detectors.detectCsvRowLimitPolicy(input);
  if (result === undefined) return passResult();
  if (isBlockResult(result)) return blockResult(result.category);
  return assessmentFailureResult();
}

async function assessXlsx(input, detectors) {
  const result = await detectors.detectOoxmlArchiveResourceLimitPolicy(input);
  if (result === undefined) return passResult();
  if (isBlockResult(result)) return blockResult(result.category);
  return assessmentFailureResult();
}

async function assessPdf(input, detectors) {
  const result = await detectors.runPdfAssessorWorkerBoundary(input.bytes);
  if (result === undefined) return passResult();
  if (isBlockResult(result)) return blockResult(result.category);
  if (isFailureResult(result)) return assessmentFailureResult(result.category);
  return assessmentFailureResult();
}

export async function assessBoundedFileSecurity(input = {}, dependencies = {}) {
  const normalized = normalizeInput(input);
  if (!normalized) return assessmentFailureResult();

  const detectors = {
    ...defaultDetectors(),
    ...(dependencies.detectors || {}),
  };

  let typeAgreementResult;
  try {
    typeAgreementResult = detectors.detectP0FileTypeAgreement(normalized);
  } catch {
    return assessmentFailureResult();
  }

  if (isBlockResult(typeAgreementResult)) {
    return blockResult(typeAgreementResult.category);
  }

  if (CSV_MIMES.has(normalized.declaredMime)) {
    if (!isPassTypeAgreement(typeAgreementResult, ".csv", normalized.declaredMime)) {
      return assessmentFailureResult();
    }
    try {
      const result = await assessCsv(normalized, detectors);
      if (result.policy !== "pass") return result;
      return await passAfterMalwareScan(normalized, dependencies);
    } catch {
      return assessmentFailureResult();
    }
  }

  if (normalized.extension === ".xlsx" || normalized.declaredMime === XLSX_MIME) {
    if (!isPassTypeAgreement(typeAgreementResult, ".xlsx", XLSX_MIME)) {
      return assessmentFailureResult();
    }
    try {
      const result = await assessXlsx(normalized, detectors);
      if (result.policy !== "pass") return result;
      return await passAfterMalwareScan(normalized, dependencies);
    } catch {
      return assessmentFailureResult();
    }
  }

  if (normalized.extension === ".pdf" || normalized.declaredMime === PDF_MIME) {
    if (!isPassTypeAgreement(typeAgreementResult, ".pdf", PDF_MIME)) {
      return assessmentFailureResult();
    }
    try {
      const result = await assessPdf(normalized, detectors);
      if (result.policy !== "pass") return result;
      return await passAfterMalwareScan(normalized, dependencies);
    } catch {
      return assessmentFailureResult();
    }
  }

  if (TEXT_EXTENSIONS.has(normalized.extension)) {
    if (!isPassTypeAgreement(typeAgreementResult, normalized.extension, normalized.declaredMime)) {
      return assessmentFailureResult();
    }
    return await passAfterMalwareScan(normalized, dependencies);
  }

  return assessmentFailureResult();
}

export const __testables = Object.freeze({
  ASSESSMENT_FAILURE_RESULT,
  normalizeInput,
});
