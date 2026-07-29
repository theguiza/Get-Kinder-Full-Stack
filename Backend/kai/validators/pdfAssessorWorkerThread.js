import { isMainThread, parentPort, workerData } from "node:worker_threads";

const PROTECTED_PDF_RESULT = Object.freeze({
  policy: "block",
  category: "encrypted_or_password_protected",
});
const NO_EXTRACTABLE_TEXT_PDF_RESULT = Object.freeze({
  policy: "block",
  category: "pdf_no_extractable_text",
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

function assertUsablePageCount(pageCount) {
  if (!Number.isSafeInteger(pageCount) || pageCount < 0) {
    throw dependencyFailure();
  }
}

function destroyDependencyHandle(handle) {
  if (handle !== null && handle !== undefined && typeof handle.destroy !== "function") {
    throw dependencyFailure();
  }
  handle?.destroy();
}

export function detectPdfExtractableText(document, pageCount) {
  assertUsablePageCount(pageCount);

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    let page = null;
    let structuredText = null;
    let pageHasExtractableText = false;

    try {
      page = document.loadPage(pageIndex);
      if (!page || typeof page.toStructuredText !== "function") {
        throw dependencyFailure();
      }

      structuredText = page.toStructuredText();
      if (!structuredText || typeof structuredText.walk !== "function") {
        throw dependencyFailure();
      }

      structuredText.walk({
        onChar(character) {
          if (typeof character !== "string") {
            throw dependencyFailure();
          }
          if (/\S/u.test(character)) {
            pageHasExtractableText = true;
          }
        },
      });
    } catch {
      throw dependencyFailure();
    } finally {
      try {
        destroyDependencyHandle(structuredText);
      } finally {
        destroyDependencyHandle(page);
      }
    }

    if (pageHasExtractableText) {
      return undefined;
    }
  }

  return NO_EXTRACTABLE_TEXT_PDF_RESULT;
}

export function assessOpenedPdfDocument(document, DocumentConstructor, pageCount) {
  const encryptionPasswordResult = detectPdfEncryptionPassword(document, DocumentConstructor);
  if (encryptionPasswordResult !== undefined) {
    return encryptionPasswordResult;
  }

  return detectPdfExtractableText(document, pageCount);
}

async function runPdfAssessment() {
  globalThis.$libmupdf_log_error = () => {};
  globalThis.$libmupdf_log_warning = () => {};
  const mupdf = await import("mupdf");
  mupdf.setLog(null);
  let document = null;

  try {
    document = mupdf.Document.openDocument(workerData.bytes, "application/pdf");
    const pageCount = document.countPages();
    const result = assessOpenedPdfDocument(document, mupdf.Document, pageCount);
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
