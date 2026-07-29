import { isMainThread, parentPort, workerData } from "node:worker_threads";

const PROTECTED_PDF_RESULT = Object.freeze({
  policy: "block",
  category: "encrypted_or_password_protected",
});

function dependencyFailure() {
  return new Error("PDF dependency inspection failed.");
}

export function detectPdfEncryptionPassword(document, DocumentConstructor) {
  let needsPassword;
  try {
    needsPassword = document.needsPassword();
  } catch {
    throw dependencyFailure();
  }
  if (typeof needsPassword !== "boolean") {
    throw dependencyFailure();
  }

  let encryptionMetadata;
  try {
    encryptionMetadata = document.getMetaData(DocumentConstructor.META_ENCRYPTION);
  } catch {
    throw dependencyFailure();
  }
  if (encryptionMetadata !== undefined && typeof encryptionMetadata !== "string") {
    throw dependencyFailure();
  }
  if (encryptionMetadata === "") {
    throw dependencyFailure();
  }

  if (needsPassword || (typeof encryptionMetadata === "string" && encryptionMetadata !== "None")) {
    return PROTECTED_PDF_RESULT;
  }

  return undefined;
}

async function runPdfAssessment() {
  globalThis.$libmupdf_log_error = () => {};
  globalThis.$libmupdf_log_warning = () => {};
  const mupdf = await import("mupdf");
  mupdf.setLog(null);
  let document = null;

  try {
    document = mupdf.Document.openDocument(workerData.bytes, "application/pdf");
    document.countPages();
    const result = detectPdfEncryptionPassword(document, mupdf.Document);
    const message = {
      type: "kai_pdf_worker_liveness_ok",
      liveness_operation: "Document.countPages",
      handles_destroyed: true,
    };

    if (result !== undefined) {
      message.result = result;
    }

    parentPort.postMessage(message);
  } finally {
    if (document) {
      document.destroy();
    }
  }
}

if (!isMainThread && parentPort) {
  runPdfAssessment().catch(() => {
    parentPort.postMessage({
      type: "kai_pdf_worker_liveness_failed",
    });
  });
}
