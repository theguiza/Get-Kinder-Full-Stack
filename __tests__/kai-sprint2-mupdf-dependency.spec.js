import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  MAXIMUM_CONCURRENT_PDF_ASSESSOR_WORKERS,
  MUPDF_DEPENDENCY_VERSION,
  MUPDF_PARENT_TIMEOUT_MS,
  MUPDF_PRE_PARSE_INPUT_GATE_BYTES,
  SYNTHETIC_PDF_BUFFER_SOURCE,
  assessSyntheticPdfWithFileBackedMupdfWorker,
  createSecurityAssessmentTimeoutLatchForTest,
  createSyntheticOversizeBytesForMupdfDependencyTest,
  createSyntheticPdfBytesForMupdfDependencyTest,
  getMupdfWorkerConcurrencyForTest,
  resetMupdfWorkerConcurrencyForTest,
} from "./support/kaiSprint2MupdfDependencyWorker.js";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const packageLock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const mupdfPackage = JSON.parse(readFileSync("node_modules/mupdf/package.json", "utf8"));
const workerSupportSource = readFileSync(
  "__tests__/support/kaiSprint2MupdfDependencyWorker.js",
  "utf8",
);

test("mupdf dependency is exactly pinned to 1.28.0 with the recorded license", () => {
  assert.equal(MUPDF_DEPENDENCY_VERSION, "1.28.0");
  assert.equal(packageJson.dependencies.mupdf, "1.28.0");
  assert.equal(packageLock.packages[""].dependencies.mupdf, "1.28.0");
  assert.equal(packageLock.packages["node_modules/mupdf"].version, "1.28.0");
  assert.equal(mupdfPackage.version, "1.28.0");
  assert.equal(mupdfPackage.license, "AGPL-3.0-or-later");
});

test("current local synthetic runtime imports and executes MuPDF only inside a file-backed worker", async () => {
  resetMupdfWorkerConcurrencyForTest();
  assert.equal(globalThis.$libmupdf_log_error, undefined);
  assert.equal(globalThis.$libmupdf_log_warning, undefined);

  const result = await assessSyntheticPdfWithFileBackedMupdfWorker({
    bytes: createSyntheticPdfBytesForMupdfDependencyTest(),
  });

  assert.equal(result.status, "passed");
  assert.equal(result.category, "mupdf_dependency_verified");
  assert.equal(result.import_succeeded, true);
  assert.equal(result.document_is_pdf, true);
  assert.equal(result.page_count, 1);
  assert.equal(result.worker_created, true);
  assert.equal(result.file_backed_worker_url_protocol, "file:");
  assert.equal(result.input_source, SYNTHETIC_PDF_BUFFER_SOURCE);
  assert.equal(globalThis.$libmupdf_log_error, undefined);
  assert.equal(globalThis.$libmupdf_log_warning, undefined);
});

test("input over 25 MiB is rejected before worker creation", async () => {
  resetMupdfWorkerConcurrencyForTest();
  const result = await assessSyntheticPdfWithFileBackedMupdfWorker({
    bytes: createSyntheticOversizeBytesForMupdfDependencyTest(),
  });

  assert.equal(MUPDF_PRE_PARSE_INPUT_GATE_BYTES, 25 * 1024 * 1024);
  assert.equal(result.status, "failed");
  assert.equal(result.category, "input_size_exceeds_pre_parse_gate");
  assert.equal(result.input_gate_bytes, 25 * 1024 * 1024);
  assert.equal(result.input_size_bytes, 25 * 1024 * 1024 + 1);
  assert.equal(result.worker_created, false);
  assert.equal(result.input_source, SYNTHETIC_PDF_BUFFER_SOURCE);
  assert.deepEqual(getMupdfWorkerConcurrencyForTest(), {
    active: 0,
    maxObserved: 0,
    configuredMaximum: 1,
  });
});

test("parent timeout latches failed / security_assessment_timeout and terminates the worker", async () => {
  resetMupdfWorkerConcurrencyForTest();
  const result = await assessSyntheticPdfWithFileBackedMupdfWorker({
    bytes: createSyntheticPdfBytesForMupdfDependencyTest(),
    timeoutMs: 25,
    workerMode: "mupdf-tight-loop",
    workerLoopMs: 2_000,
    startTimeoutAfterWorkerStartForTest: true,
  });

  assert.equal(MUPDF_PARENT_TIMEOUT_MS, 60_000);
  assert.equal(result.status, "failed");
  assert.equal(result.category, "security_assessment_timeout");
  assert.equal(result.timeout_ms, 25);
  assert.equal(result.worker_created, true);
  assert.equal(result.mupdf_started_before_timeout, true);
  assert.equal(result.worker_terminated, true);
  assert.equal(result.worker_termination_ms >= 0, true);
  assert.equal(result.file_backed_worker_url_protocol, "file:");
  assert.equal(getMupdfWorkerConcurrencyForTest().active, 0);
});

test("late worker messages cannot replace the timeout result", () => {
  const latch = createSecurityAssessmentTimeoutLatchForTest();
  const timeoutResult = latch.timeout();
  const lateAcceptedResult = latch.workerMessage({
    status: "passed",
    category: "late_worker_success",
  });

  assert.deepEqual(timeoutResult, {
    status: "failed",
    category: "security_assessment_timeout",
  });
  assert.strictEqual(lateAcceptedResult, timeoutResult);
  assert.deepEqual(latch.result(), timeoutResult);
  assert.equal(latch.lateMessageRejected(), true);
});

test("worker concurrency is capped at one", async () => {
  resetMupdfWorkerConcurrencyForTest();
  const first = assessSyntheticPdfWithFileBackedMupdfWorker({
    bytes: createSyntheticPdfBytesForMupdfDependencyTest(),
    workerMode: "delayed-success",
    workerDelayMs: 75,
  });
  const second = await assessSyntheticPdfWithFileBackedMupdfWorker({
    bytes: createSyntheticPdfBytesForMupdfDependencyTest(),
  });
  const firstResult = await first;

  assert.equal(MAXIMUM_CONCURRENT_PDF_ASSESSOR_WORKERS, 1);
  assert.equal(second.status, "failed");
  assert.equal(second.category, "maximum_concurrent_pdf_assessor_workers_exceeded");
  assert.equal(second.configured_maximum, 1);
  assert.equal(second.worker_created, false);
  assert.equal(firstResult.status, "passed");
  assert.equal(firstResult.category, "delayed_worker_success");
  assert.equal(getMupdfWorkerConcurrencyForTest().maxObserved, 1);
  assert.equal(getMupdfWorkerConcurrencyForTest().active, 0);
});

test("main-thread MuPDF import, data-URL workers, and non-synthetic buffers are absent", async () => {
  assert.doesNotMatch(workerSupportSource, /new Worker\(\s*["'`]data:/);
  assert.doesNotMatch(workerSupportSource, /from\s+["']mupdf["']/);
  assert.match(workerSupportSource, /await import\("mupdf"\)/);

  const result = await assessSyntheticPdfWithFileBackedMupdfWorker({
    bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
  });

  assert.equal(result.status, "failed");
  assert.equal(result.category, "non_synthetic_input_rejected");
  assert.equal(result.worker_created, false);
  assert.equal(result.input_source, "not_synthetic_test_buffer");
});
