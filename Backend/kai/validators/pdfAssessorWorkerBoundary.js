import { Worker } from "node:worker_threads";

import { detectP0FileTypeAgreement } from "./p0FileTypeAgreementDetector.js";

export const PDF_ASSESSOR_PRE_PARSE_INPUT_GATE_BYTES = 25 * 1024 * 1024;
export const PDF_ASSESSOR_PARENT_TIMEOUT_MS = 10_000;
export const MAXIMUM_CONCURRENT_PDF_ASSESSOR_WORKERS = 1;
export const PDF_PROFILE_MAXIMUM_SECTION_SHAPES = 20;
export const PDF_PROFILE_MAXIMUM_BLOCK_SHAPES = 80;

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
const PDF_PROFILE_NOT_PROFILABLE_REASONS = Object.freeze(new Set([
  "encrypted_or_password_protected",
  "pdf_no_extractable_text",
  "pdf_active_or_embedded_content",
  "pdf_identity_not_confirmed",
]));
const PROVISIONAL_GOVERNANCE = Object.freeze({
  meaning: "unknown",
  sensitivity: "unknown",
  review: "required",
  allowed_use: "internal only",
  llm_use: "not allowed",
  public_use: "not allowed",
  funder_use: "not allowed",
});
function governance() {
  return { ...PROVISIONAL_GOVERNANCE };
}
function withGovernance(result) {
  return Object.freeze({
    ...result,
    governance: Object.freeze(governance()),
  });
}
const PDF_PROFILE_WORKER_FAILURE_RESULT = Object.freeze({
  status: "failed",
  format: "pdf",
  error: Object.freeze({
    category: "pdf_profile_worker_failed",
    safe_message: "PDF profiling could not safely parse this file.",
  }),
  governance: Object.freeze(governance()),
});
const PDF_PROFILE_INPUT_SIZE_EXCEEDED_RESULT = Object.freeze({
  status: "failed",
  format: "pdf",
  error: Object.freeze({
    category: "input_size_exceeds_pre_parse_gate",
    safe_message: "PDF profiling input exceeds the configured pre-parse byte gate.",
  }),
  governance: Object.freeze(governance()),
});
const PDF_PROFILE_BUSY_RESULT = Object.freeze({
  status: "failed",
  format: "pdf",
  error: Object.freeze({
    category: "maximum_concurrent_pdf_assessor_workers_exceeded",
    safe_message: "PDF profiling worker capacity is currently unavailable.",
  }),
  governance: Object.freeze(governance()),
});
const PDF_PROFILE_TIMEOUT_RESULT = Object.freeze({
  status: "failed",
  format: "pdf",
  error: Object.freeze({
    category: "security_assessment_timeout",
    safe_message: "PDF profiling worker timed out.",
  }),
  governance: Object.freeze(governance()),
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

function createFileBackedPdfWorker(bytes, workerData = {}) {
  assertFileBackedWorkerUrl(PDF_WORKER_THREAD_URL);
  return new Worker(PDF_WORKER_THREAD_URL, {
    type: "module",
    workerData: { bytes, ...workerData },
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

function armFixedParentTimeout(setTimeoutFn, callback) {
  return setTimeoutFn(callback, PDF_ASSESSOR_PARENT_TIMEOUT_MS);
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

function pdfProfileWorkerFailure() {
  return PDF_PROFILE_WORKER_FAILURE_RESULT;
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

function isSafeNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isExactPdfProfileNotProfilable(result) {
  return (
    result &&
    typeof result === "object" &&
    Object.keys(result).length === 3 &&
    result.status === "not_profilable" &&
    result.format === "pdf" &&
    PDF_PROFILE_NOT_PROFILABLE_REASONS.has(result.reason)
  );
}

function isExactPdfProfile(profile) {
  if (!profile || typeof profile !== "object") return false;
  if (!Object.hasOwn(profile, "status") || profile.status !== "profiled") return false;
  if (!Object.hasOwn(profile, "format") || profile.format !== "pdf") return false;

  const expectedKeys = [
    "status",
    "format",
    "trusted_metadata",
    "counts",
    "structural_metadata",
    "section_shapes",
    "block_shapes",
  ];
  if (Object.keys(profile).join("\0") !== expectedKeys.join("\0")) return false;

  const { trusted_metadata: trustedMetadata, counts, structural_metadata: metadata } = profile;
  if (
    !trustedMetadata ||
    typeof trustedMetadata !== "object" ||
    Object.keys(trustedMetadata).join("\0") !== "extension\0declared_mime\0byte_size"
  ) {
    return false;
  }
  if (
    trustedMetadata.extension !== ".pdf" ||
    trustedMetadata.declared_mime !== "application/pdf" ||
    !isSafeNonNegativeInteger(trustedMetadata.byte_size)
  ) {
    return false;
  }

  if (!counts || typeof counts !== "object") return false;
  for (const key of [
    "page_count",
    "extractable_text_page_count",
    "text_block_count",
    "line_count",
    "character_count",
    "non_whitespace_character_count",
    "image_block_count",
    "vector_block_count",
  ]) {
    if (!isSafeNonNegativeInteger(counts[key])) return false;
  }
  if (counts.page_count <= 0 || counts.extractable_text_page_count <= 0) return false;
  if (counts.non_whitespace_character_count <= 0) return false;

  if (
    !metadata ||
    typeof metadata !== "object" ||
    Object.keys(metadata).join("\0") !== "page_count_source\0extractable_text_source\0extractable_text_confirmed\0ocr_performed"
  ) {
    return false;
  }
  if (metadata.page_count_source !== "mupdf_worker") return false;
  if (metadata.extractable_text_source !== "mupdf_structured_text_worker") return false;
  if (metadata.extractable_text_confirmed !== true) return false;
  if (metadata.ocr_performed !== false) return false;

  if (!Array.isArray(profile.section_shapes) || profile.section_shapes.length > PDF_PROFILE_MAXIMUM_SECTION_SHAPES) {
    return false;
  }
  for (const section of profile.section_shapes) {
    if (!section || typeof section !== "object") return false;
    if (Object.keys(section).join("\0") !== "section_key\0section_type\0page_number\0counts\0redacted") return false;
    if (!/^page_\d+$/.test(section.section_key)) return false;
    if (section.section_type !== "page") return false;
    if (!Number.isSafeInteger(section.page_number) || section.page_number <= 0) return false;
    if (section.redacted !== true) return false;
    for (const key of ["text_block_count", "line_count", "character_count", "non_whitespace_character_count", "image_block_count", "vector_block_count"]) {
      if (!isSafeNonNegativeInteger(section.counts?.[key])) return false;
    }
  }

  if (!Array.isArray(profile.block_shapes) || profile.block_shapes.length > PDF_PROFILE_MAXIMUM_BLOCK_SHAPES) {
    return false;
  }
  for (const block of profile.block_shapes) {
    if (!block || typeof block !== "object") return false;
    if (Object.keys(block).join("\0") !== "block_key\0page_number\0block_index\0block_type\0line_count\0character_count\0non_whitespace_character_count\0redacted") {
      return false;
    }
    if (!/^page_\d+_block_\d+$/.test(block.block_key)) return false;
    if (!Number.isSafeInteger(block.page_number) || block.page_number <= 0) return false;
    if (!isSafeNonNegativeInteger(block.block_index) || block.block_index <= 0) return false;
    if (!["text", "image", "vector"].includes(block.block_type)) return false;
    if (!isSafeNonNegativeInteger(block.line_count)) return false;
    if (!isSafeNonNegativeInteger(block.character_count)) return false;
    if (!isSafeNonNegativeInteger(block.non_whitespace_character_count)) return false;
    if (block.redacted !== true) return false;
  }

  return true;
}

function pdfProfileNotProfilable(reason) {
  return withGovernance({
    status: "not_profilable",
    format: "pdf",
    reason,
  });
}

function normalizeExtension(extension) {
  return typeof extension === "string" ? extension.trim().toLowerCase() : "";
}

function normalizeDeclaredMime(declaredMime) {
  return typeof declaredMime === "string" ? declaredMime.trim().toLowerCase() : "";
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
    workerData = {},
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
      parentTimeout = armFixedParentTimeout(setTimeoutFn, () => {
        settle({ result: latch.timeout() });
      });
      worker = createWorker(ownedBytes, workerData);
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

async function runPdfProfilingWorkerBoundaryInternal(input = {}, options = {}) {
  const bytes = input.bytes;
  if (!isAcceptedByteInput(bytes)) {
    throw new TypeError("runPdfProfilingWorkerBoundary accepts only Buffer or Uint8Array bytes.");
  }
  if (!Number.isSafeInteger(input.byteSize) || input.byteSize < 0 || input.byteSize !== bytes.byteLength) {
    throw new TypeError("runPdfProfilingWorkerBoundary requires byteSize to match bytes.");
  }

  const extension = normalizeExtension(input.extension);
  const declaredMime = normalizeDeclaredMime(input.declaredMime);
  if (extension !== ".pdf" || declaredMime !== "application/pdf") {
    return pdfProfileNotProfilable("pdf_identity_not_confirmed");
  }

  let typeResult;
  try {
    typeResult = detectP0FileTypeAgreement({ extension, declaredMime, bytes });
  } catch {
    return pdfProfileNotProfilable("pdf_identity_not_confirmed");
  }
  if (typeResult.policy !== "allow") {
    return pdfProfileNotProfilable("pdf_identity_not_confirmed");
  }

  if (bytes.byteLength > PDF_ASSESSOR_PRE_PARSE_INPUT_GATE_BYTES) {
    return PDF_PROFILE_INPUT_SIZE_EXCEEDED_RESULT;
  }

  if (!acquirePdfWorkerPermit()) {
    return PDF_PROFILE_BUSY_RESULT;
  }

  const {
    createWorker = createFileBackedPdfWorker,
    onLateWorkerMessageRejectedForTest,
    onWorkerMessageForTest,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  } = options;
  let ownedBytes = copyToOwnedUint8Array(bytes);
  let worker = null;
  let parentTimeout = null;
  let settled = false;
  let terminatePromise = null;
  const latch = createResultLatch();

  return await new Promise((resolve) => {
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

    const settle = async (result) => {
      if (settled) return;
      settled = true;
      clearParentTimeout();
      try {
        await terminateWorker();
      } finally {
        cleanup();
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

      if (message?.type === "kai_pdf_profile_worker_ok") {
        if (isExactPdfProfile(message.profile)) {
          settle(withGovernance(message.profile));
          return;
        }
        settle(pdfProfileWorkerFailure());
        return;
      }

      if (message?.type === "kai_pdf_profile_worker_not_profilable") {
        if (isExactPdfProfileNotProfilable(message.result)) {
          settle(withGovernance(message.result));
          return;
        }
        settle(pdfProfileWorkerFailure());
        return;
      }

      settle(pdfProfileWorkerFailure());
    }

    function onError() {
      const accepted = latch.workerMessage({ type: "kai_pdf_profile_worker_error" });
      if (!accepted.accepted) {
        onLateWorkerMessageRejectedForTest?.();
        return;
      }
      settle(pdfProfileWorkerFailure());
    }

    function onExit() {
      if (settled) return;
      const accepted = latch.workerMessage({ type: "kai_pdf_profile_worker_exit" });
      if (!accepted.accepted) {
        onLateWorkerMessageRejectedForTest?.();
        return;
      }
      settle(pdfProfileWorkerFailure());
    }

    try {
      parentTimeout = armFixedParentTimeout(setTimeoutFn, () => {
        settle(PDF_PROFILE_TIMEOUT_RESULT);
      });
      worker = createWorker(ownedBytes, {
        operation: "profile",
        trustedMetadata: {
          extension,
          declaredMime,
          byteSize: bytes.byteLength,
        },
      });
      ownedBytes = null;
    } catch {
      cleanup();
      resolve(pdfProfileWorkerFailure());
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

export async function runPdfProfilingWorkerBoundary(input) {
  return await runPdfProfilingWorkerBoundaryInternal(input);
}

export const __testables = Object.freeze({
  createResultLatch,
  isExactPdfProfile,
  isExactPdfProfileNotProfilable,
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
  async runPdfProfilingWorkerBoundaryWithTestControls(input, options) {
    return await runPdfProfilingWorkerBoundaryInternal(input, options);
  },
});
