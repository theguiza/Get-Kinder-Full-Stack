import { isMainThread, parentPort, workerData } from "node:worker_threads";

const PROTECTED_PDF_RESULT = Object.freeze({
  policy: "block",
  category: "encrypted_or_password_protected",
});
const NO_EXTRACTABLE_TEXT_PDF_RESULT = Object.freeze({
  policy: "block",
  category: "pdf_no_extractable_text",
});
const ACTIVE_OR_EMBEDDED_PDF_RESULT = Object.freeze({
  policy: "block",
  category: "pdf_active_or_embedded_content",
});
const MAXIMUM_PDF_OBJECT_TRAVERSAL_NODES = 10_000;

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

function dependencyOperation(operation) {
  try {
    return operation();
  } catch {
    throw dependencyFailure();
  }
}

function assertPdfObject(object) {
  if (
    !object ||
    typeof object.isNull !== "function" ||
    typeof object.resolve !== "function" ||
    typeof object.get !== "function" ||
    typeof object.forEach !== "function"
  ) {
    throw dependencyFailure();
  }
}

function pdfObjectIs(object, predicateName) {
  assertPdfObject(object);
  if (typeof object[predicateName] !== "function") {
    throw dependencyFailure();
  }
  const result = dependencyOperation(() => object[predicateName]());
  if (typeof result !== "boolean") {
    throw dependencyFailure();
  }
  return result;
}

function pdfObjectLength(object) {
  assertPdfObject(object);
  const length = dependencyOperation(() => object.length);
  if (!Number.isSafeInteger(length) || length < 0) {
    throw dependencyFailure();
  }
  return length;
}

function resolvePdfObject(object) {
  assertPdfObject(object);
  if (pdfObjectIs(object, "isNull")) {
    return object;
  }

  const resolved = dependencyOperation(() => object.resolve());
  assertPdfObject(resolved);
  return resolved;
}

function getPdfObject(object, ...path) {
  assertPdfObject(object);
  const result = dependencyOperation(() => object.get(...path));
  assertPdfObject(result);
  return result;
}

function pdfObjectExists(object) {
  assertPdfObject(object);
  return !pdfObjectIs(object, "isNull");
}

function pdfObjectNameOrNull(object) {
  const resolved = resolvePdfObject(object);
  if (pdfObjectIs(resolved, "isNull")) {
    return null;
  }
  if (!pdfObjectIs(resolved, "isName")) {
    return null;
  }

  const name = dependencyOperation(() => resolved.asName());
  if (typeof name !== "string" || name.length === 0) {
    throw dependencyFailure();
  }
  return name;
}

function forEachPdfObject(object, visitor) {
  assertPdfObject(object);
  dependencyOperation(() => {
    object.forEach((value, key, self) => {
      assertPdfObject(value);
      if (typeof key !== "number" && typeof key !== "string") {
        throw dependencyFailure();
      }
      assertPdfObject(self);
      visitor(value, key, self);
    });
  });
}

function shouldSkipAlreadySeenIndirectObject(object, seenIndirectObjects) {
  if (!pdfObjectIs(object, "isIndirect")) {
    return false;
  }

  const objectNumber = dependencyOperation(() => object.asIndirect());
  if (!Number.isSafeInteger(objectNumber) || objectNumber <= 0) {
    throw dependencyFailure();
  }
  if (seenIndirectObjects.has(objectNumber)) {
    return true;
  }
  seenIndirectObjects.add(objectNumber);
  return false;
}

function scanForProhibitedPdfKeys(object, state) {
  state.visitedNodes += 1;
  if (state.visitedNodes > MAXIMUM_PDF_OBJECT_TRAVERSAL_NODES) {
    throw dependencyFailure();
  }

  assertPdfObject(object);
  if (pdfObjectIs(object, "isNull")) {
    return false;
  }
  if (shouldSkipAlreadySeenIndirectObject(object, state.seenIndirectObjects)) {
    return false;
  }

  const resolved = resolvePdfObject(object);
  if (pdfObjectIs(resolved, "isNull")) {
    return false;
  }

  if (pdfObjectIs(resolved, "isArray")) {
    const length = pdfObjectLength(resolved);
    for (let index = 0; index < length; index += 1) {
      if (scanForProhibitedPdfKeys(getPdfObject(resolved, index), state)) {
        return true;
      }
    }
    return false;
  }

  if (pdfObjectIs(resolved, "isDictionary")) {
    let blocked = false;
    forEachPdfObject(resolved, (value, key) => {
      if (blocked) {
        return;
      }
      if (key === "JS" || key === "EF" || key === "AF") {
        blocked = true;
        return;
      }
      if (scanForProhibitedPdfKeys(value, state)) {
        blocked = true;
      }
    });
    return blocked;
  }

  return false;
}

function isAllowedInternalDestination(object) {
  const resolved = resolvePdfObject(object);
  if (pdfObjectIs(resolved, "isArray")) {
    return true;
  }
  if (pdfObjectIs(resolved, "isName")) {
    return true;
  }
  return pdfObjectIs(resolved, "isString");
}

function inspectPdfActionObject(actionObject) {
  const action = resolvePdfObject(actionObject);
  if (!pdfObjectIs(action, "isDictionary")) {
    return true;
  }

  const subtypeObject = getPdfObject(action, "S");
  const subtype = pdfObjectNameOrNull(subtypeObject);
  if (subtype !== "GoTo") {
    return true;
  }

  const nextAction = getPdfObject(action, "Next");
  if (pdfObjectExists(nextAction)) {
    return inspectPdfActionOrActionArray(nextAction);
  }

  return false;
}

function inspectPdfActionOrActionArray(object) {
  const resolved = resolvePdfObject(object);
  if (pdfObjectIs(resolved, "isArray")) {
    const length = pdfObjectLength(resolved);
    for (let index = 0; index < length; index += 1) {
      if (inspectPdfActionObject(getPdfObject(resolved, index))) {
        return true;
      }
    }
    return false;
  }

  return inspectPdfActionObject(resolved);
}

function inspectPdfAdditionalActions(additionalActionsObject) {
  const additionalActions = resolvePdfObject(additionalActionsObject);
  if (!pdfObjectIs(additionalActions, "isDictionary")) {
    throw dependencyFailure();
  }

  let blocked = false;
  forEachPdfObject(additionalActions, (value) => {
    if (!blocked && inspectPdfActionOrActionArray(value)) {
      blocked = true;
    }
  });
  return blocked;
}

function inspectPdfOpenAction(root) {
  const openAction = getPdfObject(root, "OpenAction");
  if (!pdfObjectExists(openAction)) {
    return false;
  }

  const resolvedOpenAction = resolvePdfObject(openAction);
  if (pdfObjectIs(resolvedOpenAction, "isDictionary")) {
    return inspectPdfActionObject(resolvedOpenAction);
  }
  if (isAllowedInternalDestination(resolvedOpenAction)) {
    return false;
  }

  throw dependencyFailure();
}

function inspectPdfNamedSecurityEntries(root) {
  const names = getPdfObject(root, "Names");
  if (!pdfObjectExists(names)) {
    return false;
  }

  const namesDictionary = resolvePdfObject(names);
  if (!pdfObjectIs(namesDictionary, "isDictionary")) {
    throw dependencyFailure();
  }

  return (
    pdfObjectExists(getPdfObject(namesDictionary, "JavaScript")) ||
    pdfObjectExists(getPdfObject(namesDictionary, "EmbeddedFiles"))
  );
}

function inspectPdfAnnotationObject(annotationObject) {
  const annotation = resolvePdfObject(annotationObject);
  if (!pdfObjectIs(annotation, "isDictionary")) {
    throw dependencyFailure();
  }

  const subtype = pdfObjectNameOrNull(getPdfObject(annotation, "Subtype"));
  if (subtype === "FileAttachment") {
    return true;
  }

  const action = getPdfObject(annotation, "A");
  if (pdfObjectExists(action) && inspectPdfActionOrActionArray(action)) {
    return true;
  }

  const additionalActions = getPdfObject(annotation, "AA");
  if (pdfObjectExists(additionalActions) && inspectPdfAdditionalActions(additionalActions)) {
    return true;
  }

  return false;
}

function inspectPdfPageObject(pageObject) {
  const page = resolvePdfObject(pageObject);
  if (!pdfObjectIs(page, "isDictionary")) {
    throw dependencyFailure();
  }

  const additionalActions = getPdfObject(page, "AA");
  if (pdfObjectExists(additionalActions) && inspectPdfAdditionalActions(additionalActions)) {
    return true;
  }

  const annotations = getPdfObject(page, "Annots");
  if (!pdfObjectExists(annotations)) {
    return false;
  }

  const annotationsArray = resolvePdfObject(annotations);
  if (!pdfObjectIs(annotationsArray, "isArray")) {
    throw dependencyFailure();
  }

  const annotationCount = pdfObjectLength(annotationsArray);
  for (let annotationIndex = 0; annotationIndex < annotationCount; annotationIndex += 1) {
    if (inspectPdfAnnotationObject(getPdfObject(annotationsArray, annotationIndex))) {
      return true;
    }
  }

  return false;
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

export function detectPdfActiveOrEmbeddedContent(document, pageCount) {
  assertUsablePageCount(pageCount);

  try {
    if (typeof document.asPDF !== "function") {
      throw dependencyFailure();
    }
    const pdfDocument = document.asPDF();
    if (
      !pdfDocument ||
      typeof pdfDocument.getTrailer !== "function" ||
      typeof pdfDocument.loadPage !== "function"
    ) {
      throw dependencyFailure();
    }

    const trailer = pdfDocument.getTrailer();
    assertPdfObject(trailer);
    const root = resolvePdfObject(getPdfObject(trailer, "Root"));
    if (!pdfObjectIs(root, "isDictionary")) {
      throw dependencyFailure();
    }

    if (inspectPdfNamedSecurityEntries(root)) {
      return ACTIVE_OR_EMBEDDED_PDF_RESULT;
    }

    if (scanForProhibitedPdfKeys(root, {
      seenIndirectObjects: new Set(),
      visitedNodes: 0,
    })) {
      return ACTIVE_OR_EMBEDDED_PDF_RESULT;
    }

    if (inspectPdfOpenAction(root)) {
      return ACTIVE_OR_EMBEDDED_PDF_RESULT;
    }

    const catalogAdditionalActions = getPdfObject(root, "AA");
    if (
      pdfObjectExists(catalogAdditionalActions) &&
      inspectPdfAdditionalActions(catalogAdditionalActions)
    ) {
      return ACTIVE_OR_EMBEDDED_PDF_RESULT;
    }

    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      let page = null;
      try {
        page = pdfDocument.loadPage(pageIndex);
        if (!page || typeof page.getObject !== "function") {
          throw dependencyFailure();
        }
        const pageObject = page.getObject();
        assertPdfObject(pageObject);
        if (inspectPdfPageObject(pageObject)) {
          return ACTIVE_OR_EMBEDDED_PDF_RESULT;
        }
      } finally {
        destroyDependencyHandle(page);
      }
    }
  } catch (error) {
    if (error?.message === "PDF dependency inspection failed.") {
      throw error;
    }
    throw dependencyFailure();
  }

  return undefined;
}

export function assessOpenedPdfDocument(document, DocumentConstructor, pageCount) {
  const encryptionPasswordResult = detectPdfEncryptionPassword(document, DocumentConstructor);
  if (encryptionPasswordResult !== undefined) {
    return encryptionPasswordResult;
  }

  const extractableTextResult = detectPdfExtractableText(document, pageCount);
  if (extractableTextResult !== undefined) {
    return extractableTextResult;
  }

  return detectPdfActiveOrEmbeddedContent(document, pageCount);
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
