import { Worker } from "node:worker_threads";

export const PDF_ASSESSOR_PRE_PARSE_INPUT_GATE_BYTES = 25 * 1024 * 1024;
export const PDF_ASSESSOR_PARENT_TIMEOUT_MS = 10_000;
export const MAXIMUM_CONCURRENT_PDF_ASSESSOR_WORKERS = 1;

const PDF_WORKER_THREAD_URL = new URL("./pdfAssessorWorkerThread.js", import.meta.url);
const INPUT_SIZE_EXCEEDED_RESULT = Object.freeze({
  status: "failed",
  category: "input_size_exceeds_pre_parse_gate",
});
const BUSY_RESULT = Object.freeze({
  status: "failed",
  category: "maximum_concurrent_pdf_assessor_workers_exceeded",
});
const TIMEOUT_RESULT = Object.freeze({
  status: "failed",
  category: "security_assessment_timeout",
});
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
const PDF_BLOCK_RESULT_BY_CATEGORY = Object.freeze({
  encrypted_or_password_protected: PROTECTED_PDF_RESULT,
  pdf_no_extractable_text: NO_EXTRACTABLE_TEXT_PDF_RESULT,
  pdf_active_or_embedded_content: ACTIVE_OR_EMBEDDED_PDF_RESULT,
});

let activePdfAssessorWorkers = 0;
let maxObservedPdfAssessorWorkers = 0;

function isAcceptedByteInput(input) {
  return Buffer.isBuffer(input) || input instanceof Uint8Array;
}

function copyToOwnedUint8Array(input) {
  const bytes = new Uint8Array(input.byteLength);
  bytes.set(input);
  return bytes;
}

function assertFileBackedWorkerUrl(workerUrl) {
  if (!(workerUrl instanceof URL) || workerUrl.protocol !== "file:") {
    throw new Error("PDF assessor worker must be file-backed.");
  }
}

function createFileBackedPdfWorker(bytes) {
  assertFileBackedWorkerUrl(PDF_WORKER_THREAD_URL);
  return new Worker(PDF_WORKER_THREAD_URL, {
    type: "module",
    workerData: { bytes },
    transferList: [bytes.buffer],
  });
}

function createResultLatch() {
  let result = null;

  return {
    timeout() {
      if (!result) {
        result = TIMEOUT_RESULT;
      }
      return result;
    },
    workerMessage(message) {
      if (result) {
        return { accepted: false, result };
      }
      result = message;
      return { accepted: true, result };
    },
    result() {
      return result;
    },
  };
}

function acquirePdfWorkerPermit() {
  if (activePdfAssessorWorkers >= MAXIMUM_CONCURRENT_PDF_ASSESSOR_WORKERS) {
    return false;
  }

  activePdfAssessorWorkers += 1;
  maxObservedPdfAssessorWorkers = Math.max(
    maxObservedPdfAssessorWorkers,
    activePdfAssessorWorkers,
  );
  return true;
}

function releasePdfWorkerPermit() {
  if (activePdfAssessorWorkers > 0) {
    activePdfAssessorWorkers -= 1;
  }
}

function sanitizedWorkerFailure() {
  return new Error("PDF assessor worker failed.");
}

function isExactPdfBlockResult(result) {
  return (
    result &&
    typeof result === "object" &&
    Object.keys(result).length === 2 &&
    result.policy === "block" &&
    Object.hasOwn(PDF_BLOCK_RESULT_BY_CATEGORY, result.category)
  );
}

async function runPdfAssessorWorkerBoundaryInternal(input, options = {}) {
  if (!isAcceptedByteInput(input)) {
    throw new TypeError("runPdfAssessorWorkerBoundary accepts only Buffer or Uint8Array input.");
  }

  if (input.byteLength > PDF_ASSESSOR_PRE_PARSE_INPUT_GATE_BYTES) {
    return INPUT_SIZE_EXCEEDED_RESULT;
  }

  if (!acquirePdfWorkerPermit()) {
    return BUSY_RESULT;
  }

  const {
    createWorker = createFileBackedPdfWorker,
    onLateWorkerMessageRejectedForTest,
    onWorkerMessageForTest,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  } = options;
  let ownedBytes = copyToOwnedUint8Array(input);
  let worker = null;
  let parentTimeout = null;
  let settled = false;
  let terminatePromise = null;
  const latch = createResultLatch();

  return await new Promise((resolve, reject) => {
    const clearParentTimeout = () => {
      if (parentTimeout) {
        clearTimeoutFn(parentTimeout);
        parentTimeout = null;
      }
    };

    const removeWorkerListeners = () => {
      if (!worker) return;
      worker.off("message", onMessage);
      worker.off("error", onError);
      worker.off("exit", onExit);
    };

    const terminateWorker = async () => {
      if (!worker) return;
      if (!terminatePromise) {
        terminatePromise = worker.terminate();
      }
      await terminatePromise;
    };

    const cleanup = () => {
      clearParentTimeout();
      removeWorkerListeners();
      worker = null;
      ownedBytes = null;
      releasePdfWorkerPermit();
    };

    const settle = async ({ result, error }) => {
      if (settled) return;
      settled = true;
      clearParentTimeout();
      try {
        await terminateWorker();
      } finally {
        cleanup();
      }

      if (error) {
        reject(error);
        return;
      }
      resolve(result);
    };

    function onMessage(message) {
      const accepted = latch.workerMessage(message);
      if (!accepted.accepted) {
        onLateWorkerMessageRejectedForTest?.();
        return;
      }

      onWorkerMessageForTest?.(message);

      if (message?.type === "kai_pdf_worker_liveness_ok") {
        if (Object.hasOwn(message, "result")) {
          if (!isExactPdfBlockResult(message.result)) {
            settle({ error: sanitizedWorkerFailure() });
            return;
          }

          settle({ result: PDF_BLOCK_RESULT_BY_CATEGORY[message.result.category] });
          return;
        }

        settle({ result: undefined });
        return;
      }

      settle({ error: sanitizedWorkerFailure() });
    }

    function onError() {
      const accepted = latch.workerMessage({ type: "kai_pdf_worker_error" });
      if (!accepted.accepted) {
        onLateWorkerMessageRejectedForTest?.();
        return;
      }
      settle({ error: sanitizedWorkerFailure() });
    }

    function onExit(code) {
      if (settled) return;
      const accepted = latch.workerMessage({ type: "kai_pdf_worker_exit" });
      if (!accepted.accepted) {
        onLateWorkerMessageRejectedForTest?.();
        return;
      }
      settle({ error: sanitizedWorkerFailure() });
    }

    try {
      parentTimeout = setTimeoutFn(() => {
        settle({ result: latch.timeout() });
      }, PDF_ASSESSOR_PARENT_TIMEOUT_MS);
      worker = createWorker(ownedBytes);
      ownedBytes = null;
    } catch {
      cleanup();
      reject(sanitizedWorkerFailure());
      return;
    }

    worker.on("message", onMessage);
    worker.on("error", onError);
    worker.on("exit", onExit);
  });
}

export async function runPdfAssessorWorkerBoundary(input) {
  return await runPdfAssessorWorkerBoundaryInternal(input);
}

export const __testables = Object.freeze({
  createResultLatch,
  isExactPdfBlockResult,
  getDefaultWorkerUrlProtocol() {
    return PDF_WORKER_THREAD_URL.protocol;
  },
  getPdfAssessorWorkerState() {
    return Object.freeze({
      active: activePdfAssessorWorkers,
      maxObserved: maxObservedPdfAssessorWorkers,
      configuredMaximum: MAXIMUM_CONCURRENT_PDF_ASSESSOR_WORKERS,
    });
  },
  resetPdfAssessorWorkerState() {
    activePdfAssessorWorkers = 0;
    maxObservedPdfAssessorWorkers = 0;
  },
  async runPdfAssessorWorkerBoundaryWithTestControls(input, options) {
    return await runPdfAssessorWorkerBoundaryInternal(input, options);
  },
});
