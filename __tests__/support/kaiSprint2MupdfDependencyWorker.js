import { performance } from "node:perf_hooks";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

export const MUPDF_DEPENDENCY_VERSION = "1.28.0";
export const MUPDF_PRE_PARSE_INPUT_GATE_BYTES = 25 * 1024 * 1024;
export const MUPDF_PARENT_TIMEOUT_MS = 60_000;
export const MAXIMUM_CONCURRENT_PDF_ASSESSOR_WORKERS = 1;
export const SYNTHETIC_PDF_BUFFER_SOURCE = "synthetic_test_buffer";

const syntheticBufferSourceMarker = Symbol("kaiSprint2SyntheticMupdfDependencyBuffer");

let activePdfAssessorWorkers = 0;
let maxObservedConcurrentPdfAssessorWorkers = 0;

function encodeAscii(text) {
  return new TextEncoder().encode(text);
}

function concatBytes(parts) {
  const totalLength = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;

  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }

  return output;
}

function markSyntheticBuffer(bytes) {
  Object.defineProperty(bytes, syntheticBufferSourceMarker, {
    configurable: false,
    enumerable: false,
    value: true,
  });
  return bytes;
}

function assertSyntheticBuffer(bytes) {
  if (bytes?.[syntheticBufferSourceMarker] !== true) {
    return {
      ok: false,
      status: "failed",
      category: "non_synthetic_input_rejected",
      worker_created: false,
      input_source: "not_synthetic_test_buffer",
    };
  }
  return { ok: true };
}

export function createSyntheticPdfBytesForMupdfDependencyTest() {
  const header = "%PDF-1.4\n";
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1 1] >>\nendobj\n",
  ];
  const offsets = [0];
  const parts = [encodeAscii(header)];
  let byteOffset = parts[0].byteLength;

  for (const object of objects) {
    offsets.push(byteOffset);
    const objectBytes = encodeAscii(object);
    parts.push(objectBytes);
    byteOffset += objectBytes.byteLength;
  }

  const xrefOffset = byteOffset;
  const xref = [
    "xref\n0 4\n",
    "0000000000 65535 f \n",
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`),
    "trailer\n<< /Size 4 /Root 1 0 R >>\n",
    `startxref\n${xrefOffset}\n%%EOF\n`,
  ].join("");
  parts.push(encodeAscii(xref));

  return markSyntheticBuffer(concatBytes(parts));
}

export function createSyntheticOversizeBytesForMupdfDependencyTest() {
  return markSyntheticBuffer(new Uint8Array(MUPDF_PRE_PARSE_INPUT_GATE_BYTES + 1));
}

export function resetMupdfWorkerConcurrencyForTest() {
  activePdfAssessorWorkers = 0;
  maxObservedConcurrentPdfAssessorWorkers = 0;
}

export function getMupdfWorkerConcurrencyForTest() {
  return Object.freeze({
    active: activePdfAssessorWorkers,
    maxObserved: maxObservedConcurrentPdfAssessorWorkers,
    configuredMaximum: MAXIMUM_CONCURRENT_PDF_ASSESSOR_WORKERS,
  });
}

export function createSecurityAssessmentTimeoutLatchForTest() {
  let result = null;
  let lateMessageRejected = false;

  return Object.freeze({
    timeout() {
      if (!result) {
        result = Object.freeze({
          status: "failed",
          category: "security_assessment_timeout",
        });
      }
      return result;
    },
    workerMessage(message) {
      if (result) {
        lateMessageRejected = true;
        return result;
      }
      result = Object.freeze(message);
      return result;
    },
    result() {
      return result;
    },
    lateMessageRejected() {
      return lateMessageRejected;
    },
  });
}

export async function assessSyntheticPdfWithFileBackedMupdfWorker({
  bytes,
  timeoutMs = MUPDF_PARENT_TIMEOUT_MS,
  workerMode = "mupdf-open",
  workerDelayMs = 0,
  workerLoopMs = 0,
  startTimeoutAfterWorkerStartForTest = false,
} = {}) {
  const syntheticCheck = assertSyntheticBuffer(bytes);
  if (!syntheticCheck.ok) {
    return syntheticCheck;
  }

  if (bytes.byteLength > MUPDF_PRE_PARSE_INPUT_GATE_BYTES) {
    return Object.freeze({
      status: "failed",
      category: "input_size_exceeds_pre_parse_gate",
      input_size_bytes: bytes.byteLength,
      input_gate_bytes: MUPDF_PRE_PARSE_INPUT_GATE_BYTES,
      worker_created: false,
      input_source: SYNTHETIC_PDF_BUFFER_SOURCE,
    });
  }

  if (activePdfAssessorWorkers >= MAXIMUM_CONCURRENT_PDF_ASSESSOR_WORKERS) {
    return Object.freeze({
      status: "failed",
      category: "maximum_concurrent_pdf_assessor_workers_exceeded",
      configured_maximum: MAXIMUM_CONCURRENT_PDF_ASSESSOR_WORKERS,
      worker_created: false,
      input_source: SYNTHETIC_PDF_BUFFER_SOURCE,
    });
  }

  activePdfAssessorWorkers += 1;
  maxObservedConcurrentPdfAssessorWorkers = Math.max(
    maxObservedConcurrentPdfAssessorWorkers,
    activePdfAssessorWorkers,
  );

  const workerUrl = new URL(import.meta.url);
  const worker = new Worker(workerUrl, {
    type: "module",
    workerData: {
      bytes,
      mode: workerMode,
      delayMs: workerDelayMs,
      loopMs: workerLoopMs,
    },
  });
  const latch = createSecurityAssessmentTimeoutLatchForTest();
  const telemetry = {
    file_backed_worker_url_protocol: workerUrl.protocol,
    input_source: SYNTHETIC_PDF_BUFFER_SOURCE,
    late_messages_rejected: 0,
    mupdf_started_before_timeout: false,
    worker_created: true,
    worker_terminated: false,
  };
  let timeout = null;
  let finalized = false;
  let timeoutTerminationInProgress = false;

  return await new Promise((resolve) => {
    function clearParentTimeout() {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
    }

    function releaseWorkerSlot() {
      if (activePdfAssessorWorkers > 0) {
        activePdfAssessorWorkers -= 1;
      }
    }

    function finalize(result) {
      if (finalized) {
        return;
      }
      finalized = true;
      clearParentTimeout();
      releaseWorkerSlot();
      resolve(Object.freeze({ ...result, ...telemetry }));
    }

    function armParentTimeout() {
      if (timeout) {
        return;
      }
      timeout = setTimeout(async () => {
        const timeoutResult = latch.timeout();
        timeoutTerminationInProgress = true;
        const terminationStartedAt = performance.now();
        try {
          await worker.terminate();
          telemetry.worker_terminated = true;
        } finally {
          telemetry.worker_termination_ms = performance.now() - terminationStartedAt;
          finalize({
            ...timeoutResult,
            timeout_ms: timeoutMs,
          });
        }
      }, timeoutMs);
    }

    if (!startTimeoutAfterWorkerStartForTest) {
      armParentTimeout();
    }

    worker.on("message", (message) => {
      if (message?.type === "mupdf-started") {
        telemetry.mupdf_started_before_timeout = true;
        if (startTimeoutAfterWorkerStartForTest) {
          armParentTimeout();
        }
        return;
      }

      const accepted = latch.workerMessage(message);
      if (accepted !== message) {
        telemetry.late_messages_rejected += 1;
        return;
      }

      finalize(message);
    });

    worker.on("error", (error) => {
      const errorResult = {
        status: "failed",
        category: "worker_error",
        message: error.message,
      };
      latch.workerMessage(errorResult);
      finalize(errorResult);
    });

    worker.on("exit", (code) => {
      if (timeoutTerminationInProgress) {
        return;
      }
      if (!finalized && code !== 0) {
        const exitResult = {
          status: "failed",
          category: "worker_exit",
          worker_exit_code: code,
        };
        latch.workerMessage(exitResult);
        finalize(exitResult);
      }
    });
  });
}

async function openSyntheticPdfWithMupdf(bytes) {
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  try {
    return {
      import_succeeded: true,
      page_count: doc.countPages(),
      document_is_pdf: doc.isPDF(),
    };
  } finally {
    doc.destroy();
  }
}

async function runWorker() {
  if (workerData.mode === "delayed-success") {
    setTimeout(() => {
      parentPort.postMessage({
        status: "passed",
        category: "delayed_worker_success",
      });
    }, workerData.delayMs);
    return;
  }

  if (workerData.mode === "mupdf-tight-loop") {
    const firstResult = await openSyntheticPdfWithMupdf(workerData.bytes);
    parentPort.postMessage({
      type: "mupdf-started",
      ...firstResult,
    });

    const stopAt = performance.now() + workerData.loopMs;
    let iterations = 0;
    while (performance.now() < stopAt) {
      await openSyntheticPdfWithMupdf(workerData.bytes);
      iterations += 1;
    }

    parentPort.postMessage({
      status: "passed",
      category: "mupdf_loop_finished",
      iterations,
      ...firstResult,
    });
    return;
  }

  const result = await openSyntheticPdfWithMupdf(workerData.bytes);
  parentPort.postMessage({
    status: "passed",
    category: "mupdf_dependency_verified",
    ...result,
  });
}

if (!isMainThread && parentPort) {
  await runWorker();
}
