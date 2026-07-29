import { isMainThread, parentPort, workerData } from "node:worker_threads";

async function runPdfLiveness() {
  const mupdf = await import("mupdf");
  let document = null;

  try {
    document = mupdf.Document.openDocument(workerData.bytes, "application/pdf");
    document.countPages();
  } finally {
    if (document) {
      document.destroy();
    }
  }

  parentPort.postMessage({
    type: "kai_pdf_worker_liveness_ok",
    liveness_operation: "Document.countPages",
    handles_destroyed: true,
  });
}

if (!isMainThread && parentPort) {
  runPdfLiveness().catch(() => {
    parentPort.postMessage({
      type: "kai_pdf_worker_liveness_failed",
    });
  });
}
