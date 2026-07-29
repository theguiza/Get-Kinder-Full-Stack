import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";

import {
  MAXIMUM_CONCURRENT_PDF_ASSESSOR_WORKERS,
  PDF_ASSESSOR_PARENT_TIMEOUT_MS,
  PDF_ASSESSOR_PRE_PARSE_INPUT_GATE_BYTES,
  runPdfAssessorWorkerBoundary,
  __testables as pdfWorkerBoundaryTestables,
} from "../Backend/kai/validators/pdfAssessorWorkerBoundary.js";

const mainSource = readFileSync("Backend/kai/validators/pdfAssessorWorkerBoundary.js", "utf8");
const workerSource = readFileSync("Backend/kai/validators/pdfAssessorWorkerThread.js", "utf8");

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

function syntheticPdfBytes() {
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
  parts.push(encodeAscii([
    "xref\n0 4\n",
    "0000000000 65535 f \n",
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`),
    "trailer\n<< /Size 4 /Root 1 0 R >>\n",
    `startxref\n${xrefOffset}\n%%EOF\n`,
  ].join("")));

  return concatBytes(parts);
}

class SyntheticWorker extends EventEmitter {
  constructor() {
    super();
    this.terminateCalls = 0;
    this.terminateResolve = null;
  }

  terminate() {
    this.terminateCalls += 1;
    return new Promise((resolve) => {
      this.terminateResolve = () => {
        this.emit("exit", 1);
        resolve(1);
      };
    });
  }

  finishTermination() {
    this.terminateResolve?.();
  }
}

function assertReadableAndUnchanged(input, expectedBytes) {
  assert.equal(input.byteLength, expectedBytes.byteLength);
  assert.deepEqual(Array.from(input), Array.from(expectedBytes));
  assert.equal(input[0], expectedBytes[0]);
  assert.deepEqual(Array.from(input.slice(0, input.byteLength)), Array.from(expectedBytes));
}

function ownershipInputs() {
  const visible = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34];

  const allocatedBuffer = Buffer.alloc(visible.length);
  allocatedBuffer.set(visible);

  const fromBuffer = Buffer.from(visible);

  const standaloneUint8Array = new Uint8Array(visible);

  const bufferSubviewBacking = Buffer.from([
    0xa1,
    0xa2,
    0xa3,
    ...visible,
    0xb1,
    0xb2,
    0xb3,
  ]);
  const bufferSubview = bufferSubviewBacking.subarray(3, 3 + visible.length);
  assert.notEqual(bufferSubview.byteOffset, 0);

  const uint8ArraySubviewBacking = new Uint8Array([
    0xc1,
    0xc2,
    0xc3,
    0xc4,
    ...visible,
    0xd1,
    0xd2,
    0xd3,
    0xd4,
  ]);
  const uint8ArraySubview = uint8ArraySubviewBacking.subarray(4, 4 + visible.length);
  assert.notEqual(uint8ArraySubview.byteOffset, 0);

  return [
    {
      name: "Buffer.alloc",
      input: allocatedBuffer,
      expectedBytes: Uint8Array.from(visible),
      forbiddenAdjacentBytes: [],
    },
    {
      name: "Buffer.from",
      input: fromBuffer,
      expectedBytes: Uint8Array.from(visible),
      forbiddenAdjacentBytes: [],
    },
    {
      name: "standalone Uint8Array",
      input: standaloneUint8Array,
      expectedBytes: Uint8Array.from(visible),
      forbiddenAdjacentBytes: [],
    },
    {
      name: "Buffer subview with non-zero byteOffset",
      input: bufferSubview,
      expectedBytes: Uint8Array.from(visible),
      forbiddenAdjacentBytes: [0xa1, 0xa2, 0xa3, 0xb1, 0xb2, 0xb3],
    },
    {
      name: "Uint8Array subview with non-zero byteOffset",
      input: uint8ArraySubview,
      expectedBytes: Uint8Array.from(visible),
      forbiddenAdjacentBytes: [0xc1, 0xc2, 0xc3, 0xc4, 0xd1, 0xd2, 0xd3, 0xd4],
    },
  ];
}

function assertFreshVisibleRangeCopy({ input, transferredBytes, expectedBytes, forbiddenAdjacentBytes }) {
  assert.ok(transferredBytes instanceof Uint8Array);
  assert.equal(transferredBytes.buffer === input.buffer, false);
  assert.equal(transferredBytes.byteOffset, 0);
  assert.equal(transferredBytes.byteLength, expectedBytes.byteLength);
  assert.equal(transferredBytes.buffer.byteLength, expectedBytes.byteLength);
  assert.deepEqual(Array.from(transferredBytes), Array.from(expectedBytes));

  for (const forbiddenByte of forbiddenAdjacentBytes) {
    assert.equal(transferredBytes.includes(forbiddenByte), false);
  }
}

test("P0-05 PDF worker boundary rejects non-Buffer and non-Uint8Array input", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();

  for (const input of [
    null,
    undefined,
    "not bytes",
    new ArrayBuffer(4),
    new Int8Array(4),
  ]) {
    await assert.rejects(
      runPdfAssessorWorkerBoundary(input),
      /accepts only Buffer or Uint8Array input/,
    );
  }

  assert.equal(pdfWorkerBoundaryTestables.getPdfAssessorWorkerState().active, 0);
});

test("P0-05 PDF worker boundary rejects over-25-MiB input before worker creation", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();
  let workerCreated = false;
  const result = await pdfWorkerBoundaryTestables.runPdfAssessorWorkerBoundaryWithTestControls(
    new Uint8Array(PDF_ASSESSOR_PRE_PARSE_INPUT_GATE_BYTES + 1),
    {
      createWorker() {
        workerCreated = true;
        throw new Error("worker must not be created");
      },
    },
  );

  assert.equal(PDF_ASSESSOR_PRE_PARSE_INPUT_GATE_BYTES, 25 * 1024 * 1024);
  assert.deepEqual(result, {
    status: "failed",
    category: "input_size_exceeds_pre_parse_gate",
  });
  assert.equal(workerCreated, false);
  assert.equal(pdfWorkerBoundaryTestables.getPdfAssessorWorkerState().active, 0);
});

test("P0-05 PDF worker boundary opens a minimal synthetic PDF inside a file-backed worker and destroys handles", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();
  const workerMessages = [];
  const result = await pdfWorkerBoundaryTestables.runPdfAssessorWorkerBoundaryWithTestControls(
    Buffer.from(syntheticPdfBytes()),
    {
      onWorkerMessageForTest(message) {
        workerMessages.push(message);
      },
    },
  );

  assert.equal(result, undefined);
  assert.equal(await runPdfAssessorWorkerBoundary(Buffer.from(syntheticPdfBytes())), undefined);
  assert.equal(workerMessages.length, 1);
  assert.deepEqual(workerMessages[0], {
    type: "kai_pdf_worker_liveness_ok",
    liveness_operation: "Document.countPages",
    handles_destroyed: true,
  });
  for (const forbiddenKey of ["status", "policy", "category", "scope", "eligibility", "security_result"]) {
    assert.equal(Object.hasOwn(workerMessages[0], forbiddenKey), false, forbiddenKey);
  }
  assert.equal(globalThis.$libmupdf_log_error, undefined);
  assert.equal(globalThis.$libmupdf_log_warning, undefined);
  assert.equal(pdfWorkerBoundaryTestables.getPdfAssessorWorkerState().active, 0);
});

test("P0-05 PDF worker boundary transfers only an owned exact visible-range copy", async () => {
  for (const { name, input, expectedBytes, forbiddenAdjacentBytes } of ownershipInputs()) {
    pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();
    const originalByteLength = input.byteLength;
    const originalBytes = Uint8Array.from(input);
    const worker = new SyntheticWorker();
    let transferredBytes = null;

    const promise = pdfWorkerBoundaryTestables.runPdfAssessorWorkerBoundaryWithTestControls(input, {
      createWorker(bytes) {
        transferredBytes = bytes;
        return worker;
      },
    });

    assertFreshVisibleRangeCopy({
      input,
      transferredBytes,
      expectedBytes,
      forbiddenAdjacentBytes,
    });

    worker.emit("message", {
      type: "kai_pdf_worker_liveness_ok",
      liveness_operation: "Document.countPages",
      handles_destroyed: true,
    });
    worker.finishTermination();

    assert.equal(await promise, undefined, name);
    assert.equal(input.byteLength, originalByteLength, name);
    assertReadableAndUnchanged(input, originalBytes);
    assert.equal(pdfWorkerBoundaryTestables.getPdfAssessorWorkerState().active, 0, name);
  }
});

test("P0-05 PDF worker boundary timeout latches only failed / security_assessment_timeout", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();
  const worker = new SyntheticWorker();
  const promise = pdfWorkerBoundaryTestables.runPdfAssessorWorkerBoundaryWithTestControls(syntheticPdfBytes(), {
    createWorker() {
      return worker;
    },
    timeoutMs: 1,
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(worker.terminateCalls, 1);
  worker.finishTermination();

  assert.deepEqual(await promise, {
    status: "failed",
    category: "security_assessment_timeout",
  });
  assert.equal(PDF_ASSESSOR_PARENT_TIMEOUT_MS, 60_000);
});

test("P0-05 PDF worker boundary preserves caller-owned input after timeout", async () => {
  for (const { name, input, expectedBytes, forbiddenAdjacentBytes } of ownershipInputs()) {
    pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();
    const originalByteLength = input.byteLength;
    const originalBytes = Uint8Array.from(input);
    const worker = new SyntheticWorker();
    let transferredBytes = null;

    const promise = pdfWorkerBoundaryTestables.runPdfAssessorWorkerBoundaryWithTestControls(input, {
      createWorker(bytes) {
        transferredBytes = bytes;
        return worker;
      },
      timeoutMs: 1,
    });

    assertFreshVisibleRangeCopy({
      input,
      transferredBytes,
      expectedBytes,
      forbiddenAdjacentBytes,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    worker.finishTermination();

    assert.deepEqual(await promise, {
      status: "failed",
      category: "security_assessment_timeout",
    }, name);
    assert.equal(input.byteLength, originalByteLength, name);
    assertReadableAndUnchanged(input, originalBytes);
    assert.equal(pdfWorkerBoundaryTestables.getPdfAssessorWorkerState().active, 0, name);
  }
});

test("P0-05 PDF worker boundary rejects late worker messages after timeout", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();
  const worker = new SyntheticWorker();
  let lateMessagesRejected = 0;
  const promise = pdfWorkerBoundaryTestables.runPdfAssessorWorkerBoundaryWithTestControls(syntheticPdfBytes(), {
    createWorker() {
      setTimeout(() => {
        worker.emit("message", {
          type: "kai_pdf_worker_liveness_ok",
          category: "late_worker_success",
          policy: "late_policy",
        });
      }, 5);
      return worker;
    },
    onLateWorkerMessageRejectedForTest() {
      lateMessagesRejected += 1;
    },
    timeoutMs: 1,
  });

  await new Promise((resolve) => setTimeout(resolve, 15));
  worker.finishTermination();

  assert.deepEqual(await promise, {
    status: "failed",
    category: "security_assessment_timeout",
  });
  assert.equal(lateMessagesRejected, 1);
});

test("P0-05 PDF worker boundary terminates the worker and completes exit cleanup", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();
  const worker = new SyntheticWorker();
  const promise = pdfWorkerBoundaryTestables.runPdfAssessorWorkerBoundaryWithTestControls(syntheticPdfBytes(), {
    createWorker() {
      return worker;
    },
  });

  worker.emit("message", {
    type: "kai_pdf_worker_liveness_ok",
    liveness_operation: "Document.countPages",
    handles_destroyed: true,
  });
  assert.equal(worker.terminateCalls, 1);
  worker.finishTermination();

  assert.equal(await promise, undefined);
  assert.equal(worker.listenerCount("message"), 0);
  assert.equal(worker.listenerCount("error"), 0);
  assert.equal(worker.listenerCount("exit"), 0);
  assert.equal(pdfWorkerBoundaryTestables.getPdfAssessorWorkerState().active, 0);
});

test("P0-05 PDF worker boundary permits at most one active worker", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();
  const firstWorker = new SyntheticWorker();
  let workerCreations = 0;
  const first = pdfWorkerBoundaryTestables.runPdfAssessorWorkerBoundaryWithTestControls(syntheticPdfBytes(), {
    createWorker() {
      workerCreations += 1;
      return firstWorker;
    },
  });
  const second = await pdfWorkerBoundaryTestables.runPdfAssessorWorkerBoundaryWithTestControls(syntheticPdfBytes(), {
    createWorker() {
      workerCreations += 1;
      return new SyntheticWorker();
    },
  });

  assert.equal(MAXIMUM_CONCURRENT_PDF_ASSESSOR_WORKERS, 1);
  assert.deepEqual(second, {
    status: "failed",
    category: "maximum_concurrent_pdf_assessor_workers_exceeded",
  });
  assert.equal(workerCreations, 1);
  assert.deepEqual(pdfWorkerBoundaryTestables.getPdfAssessorWorkerState(), {
    active: 1,
    maxObserved: 1,
    configuredMaximum: 1,
  });

  firstWorker.emit("message", {
    type: "kai_pdf_worker_liveness_ok",
    liveness_operation: "Document.countPages",
    handles_destroyed: true,
  });
  firstWorker.finishTermination();
  assert.equal(await first, undefined);
  assert.equal(pdfWorkerBoundaryTestables.getPdfAssessorWorkerState().active, 0);
});

test("P0-05 PDF worker boundary releases the concurrency permit after success and timeout", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();
  const successWorker = new SyntheticWorker();
  const success = pdfWorkerBoundaryTestables.runPdfAssessorWorkerBoundaryWithTestControls(syntheticPdfBytes(), {
    createWorker() {
      return successWorker;
    },
  });
  successWorker.emit("message", {
    type: "kai_pdf_worker_liveness_ok",
    liveness_operation: "Document.countPages",
    handles_destroyed: true,
  });
  successWorker.finishTermination();
  await success;
  assert.equal(pdfWorkerBoundaryTestables.getPdfAssessorWorkerState().active, 0);

  const timeoutWorker = new SyntheticWorker();
  const timeout = pdfWorkerBoundaryTestables.runPdfAssessorWorkerBoundaryWithTestControls(syntheticPdfBytes(), {
    createWorker() {
      return timeoutWorker;
    },
    timeoutMs: 1,
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  timeoutWorker.finishTermination();
  await timeout;
  assert.equal(pdfWorkerBoundaryTestables.getPdfAssessorWorkerState().active, 0);
});

test("P0-05 PDF worker boundary prohibits main-thread MuPDF import", () => {
  assert.doesNotMatch(mainSource, /from\s+["']mupdf["']/);
  assert.doesNotMatch(mainSource, /import\(\s*["']mupdf["']\s*\)/);
  assert.match(workerSource, /await import\("mupdf"\)/);
  assert.match(workerSource, /!isMainThread && parentPort/);
});

test("P0-05 PDF worker boundary uses no data-URL or eval worker", () => {
  assert.equal(pdfWorkerBoundaryTestables.getDefaultWorkerUrlProtocol(), "file:");
  assert.doesNotMatch(mainSource, /new Worker\(\s*["'`]data:/);
  assert.doesNotMatch(mainSource, /eval\s*:\s*true/);
});

test("P0-05 PDF worker boundary omits raw bytes, PDF content, and private paths from results, errors, and logs", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();
  const logs = [];
  const originalConsole = {
    error: console.error,
    log: console.log,
    warn: console.warn,
  };
  console.error = (...args) => logs.push(args.join(" "));
  console.log = (...args) => logs.push(args.join(" "));
  console.warn = (...args) => logs.push(args.join(" "));

  try {
    const privatePath = "/Users/mikewoz/Get-Kinder-Full-Stack-Deploy/private.pdf";
    const rawContent = "%PDF-1.4 secret client content";
    const worker = new SyntheticWorker();
    const promise = pdfWorkerBoundaryTestables.runPdfAssessorWorkerBoundaryWithTestControls(encodeAscii(rawContent), {
      createWorker() {
        return worker;
      },
    });
    worker.emit("message", {
      type: "kai_pdf_worker_liveness_failed",
      rawContent,
      privatePath,
      bytes: [0x25, 0x50, 0x44, 0x46],
    });
    worker.finishTermination();
    await assert.rejects(promise, /PDF assessor worker failed\./);

    const oversizeResult = await runPdfAssessorWorkerBoundary(
      new Uint8Array(PDF_ASSESSOR_PRE_PARSE_INPUT_GATE_BYTES + 1),
    );
    const combined = JSON.stringify({
      oversizeResult,
      logs,
    });
    assert.equal(combined.includes(rawContent), false);
    assert.equal(combined.includes("secret client content"), false);
    assert.equal(combined.includes(privatePath), false);
    assert.equal(combined.includes("%PDF"), false);
  } finally {
    console.error = originalConsole.error;
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
  }
});
