import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  ASSESSMENT_READ_INTEGRITY_FAILURE_KINDS,
  ASSESSMENT_READ_INTEGRITY_FAILURE_TYPE,
  ASSESSMENT_READ_INTEGRITY_MAX_BYTES,
  readVerifiedAssessmentBytes,
} from "../Backend/kai/security/assessmentReadIntegrityBridge.js";

const OBJECT_VERSION_ID = "ov_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function exactVersionByteSource(chunks, options = {}) {
  let index = 0;
  let closed = false;
  const source = {
    closeCount: 0,
    nextCount: 0,
    returned: false,
    [Symbol.asyncIterator]() {
      return this;
    },
    async next() {
      source.nextCount += 1;
      options.onBeforeNext?.(source);
      if (closed) return { done: true, value: undefined };
      if (options.throwAtIndex === index) {
        throw new Error("provider read failed for /private/tmp/secret.bin");
      }
      if (index >= chunks.length) {
        closed = true;
        await source.close();
        return { done: true, value: undefined };
      }
      const value = chunks[index];
      index += 1;
      options.onAfterChunk?.(source);
      return { done: false, value };
    },
    async return() {
      source.returned = true;
      await source.close();
      return { done: true, value: undefined };
    },
    async throw(error) {
      await source.close();
      throw error;
    },
    async close() {
      if (!closed) closed = true;
      if (source.closeCount === 0) {
        source.closeCount += 1;
        await options.onClose?.();
      }
    },
  };
  return source;
}

function storageAdapterFor({ source, objectVersionId = OBJECT_VERSION_ID, sizeBytes, onOpen } = {}) {
  const calls = [];
  return {
    calls,
    source,
    async openObjectVersionReadStream(input) {
      calls.push(input);
      if (onOpen) return onOpen(input);
      return {
        ok: true,
        data: {
          object_version_id: objectVersionId,
          size_bytes: sizeBytes,
          byte_source: source,
        },
      };
    },
  };
}

async function readBridge({ chunks, source, storageAdapter, expectedChecksum, expectedSize, signal } = {}) {
  const effectiveChunks = chunks ?? [Buffer.from("exact bytes")];
  const effectiveSource = source ?? exactVersionByteSource(effectiveChunks);
  const expected = Buffer.concat(effectiveChunks.map((chunk) => Buffer.from(chunk)));
  const effectiveStorageAdapter = storageAdapter ?? storageAdapterFor({
    source: effectiveSource,
    sizeBytes: expected.byteLength,
  });

  return readVerifiedAssessmentBytes({
    objectVersionId: OBJECT_VERSION_ID,
    expectedChecksum: expectedChecksum ?? sha256Hex(expected),
    expectedSize: expectedSize ?? expected.byteLength,
    storageAdapter: effectiveStorageAdapter,
    ...(signal ? { signal } : {}),
  });
}

function assertIntegrityFailure(result, kind) {
  assert.equal(result.ok, false);
  assert.deepEqual(result.integrity_failure, {
    type: ASSESSMENT_READ_INTEGRITY_FAILURE_TYPE,
    kind,
  });
  assert.equal("data" in result, false);
  assert.equal("policy" in result, false);
  assert.equal("status" in result, false);
  assert.doesNotMatch(JSON.stringify(result), /private|bucket|storage_uri|signed_url|object\.bin|secret|raw bytes|ov_aaaaaaaa/i);
}

test("assessment read-integrity bridge opens the requested exact version and returns assessor-compatible bytes", async () => {
  const chunks = [Buffer.from("exact "), new Uint8Array(Buffer.from("version")), Buffer.from(" bytes")];
  const source = exactVersionByteSource(chunks);
  const storageAdapter = storageAdapterFor({
    source,
    sizeBytes: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).byteLength,
  });
  const result = await readBridge({ chunks, source, storageAdapter });

  assert.equal(result.ok, true);
  assert.deepEqual(storageAdapter.calls, [{ objectVersionId: OBJECT_VERSION_ID }]);
  assert.equal(source.nextCount > 1, true);
  assert.equal(source.closeCount, 1);
  assert.equal(result.data.bytes instanceof Uint8Array, true);
  assert.deepEqual(result.data.bytes, Buffer.from("exact version bytes"));
  assert.deepEqual(Object.keys(result.data), ["bytes"]);
  assert.doesNotMatch(JSON.stringify(result), /bucket|storage_uri|signed_url|path|object_key|provider_private/i);
});

test("assessment read-integrity bridge rejects checksum mismatch without returning bytes", async () => {
  const source = exactVersionByteSource([Buffer.from("exact bytes")]);
  const result = await readBridge({
    source,
    expectedChecksum: "b".repeat(64),
  });

  assertIntegrityFailure(result, ASSESSMENT_READ_INTEGRITY_FAILURE_KINDS.checksum_mismatch);
  assert.equal(source.closeCount, 1);
});

test("assessment read-integrity bridge rejects expected-size mismatch without returning bytes", async () => {
  const source = exactVersionByteSource([Buffer.from("exact bytes")]);
  const result = await readBridge({
    source,
    expectedSize: "exact bytes".length + 1,
  });

  assertIntegrityFailure(result, ASSESSMENT_READ_INTEGRITY_FAILURE_KINDS.size_mismatch);
  assert.equal(source.closeCount, 1);
});

test("assessment read-integrity bridge fails closed for missing, changed, or caller-private exact-version inputs", async () => {
  const missing = await readBridge({
    storageAdapter: storageAdapterFor({
      onOpen: async () => ({ ok: false, error: { code: "not_found", message: "/private/tmp/missing.bin" } }),
    }),
  });
  assertIntegrityFailure(missing, ASSESSMENT_READ_INTEGRITY_FAILURE_KINDS.exact_version_unavailable);

  const changedSource = exactVersionByteSource([Buffer.from("replacement bytes")]);
  const changed = await readBridge({
    source: changedSource,
    storageAdapter: storageAdapterFor({
      source: changedSource,
      objectVersionId: "ov_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      sizeBytes: "replacement bytes".length,
    }),
  });
  assertIntegrityFailure(changed, ASSESSMENT_READ_INTEGRITY_FAILURE_KINDS.exact_version_unavailable);
  assert.equal(changedSource.closeCount, 1);

  for (const forbidden of ["path", "bucket", "objectKey", "uri", "signedUrl", "filename", "mime", "extension"]) {
    const storageAdapter = storageAdapterFor({ source: exactVersionByteSource([Buffer.from("not opened")]), sizeBytes: 10 });
    const result = await readVerifiedAssessmentBytes({
      objectVersionId: OBJECT_VERSION_ID,
      expectedChecksum: "a".repeat(64),
      expectedSize: 10,
      storageAdapter,
      [forbidden]: "caller-private-value",
    });
    assertIntegrityFailure(result, ASSESSMENT_READ_INTEGRITY_FAILURE_KINDS.invalid_input);
    assert.deepEqual(storageAdapter.calls, []);
  }
});

test("assessment read-integrity bridge enforces the committed 25 MB byte limit incrementally", async () => {
  const atLimit = Buffer.alloc(ASSESSMENT_READ_INTEGRITY_MAX_BYTES, 0x61);
  const source = exactVersionByteSource([atLimit, Buffer.from("x"), Buffer.from("must not be read")]);
  const storageAdapter = storageAdapterFor({
    source,
    sizeBytes: ASSESSMENT_READ_INTEGRITY_MAX_BYTES + 1,
  });

  const result = await readVerifiedAssessmentBytes({
    objectVersionId: OBJECT_VERSION_ID,
    expectedChecksum: "a".repeat(64),
    expectedSize: ASSESSMENT_READ_INTEGRITY_MAX_BYTES + 1,
    storageAdapter,
  });

  assertIntegrityFailure(result, ASSESSMENT_READ_INTEGRITY_FAILURE_KINDS.size_limit_exceeded);
  assert.equal(source.nextCount, 2);
  assert.equal(source.closeCount, 1);
});

test("assessment read-integrity bridge handles read failure, abort, and cancellation cleanup", async () => {
  const readFailureSource = exactVersionByteSource([Buffer.from("exact bytes")], { throwAtIndex: 0 });
  const readFailure = await readBridge({ source: readFailureSource });
  assertIntegrityFailure(readFailure, ASSESSMENT_READ_INTEGRITY_FAILURE_KINDS.read_failed);
  assert.equal(readFailureSource.closeCount, 1);

  const beforeController = new AbortController();
  beforeController.abort();
  const beforeStorage = storageAdapterFor({
    source: exactVersionByteSource([Buffer.from("not opened")]),
    sizeBytes: 10,
  });
  const beforeAbort = await readBridge({ storageAdapter: beforeStorage, signal: beforeController.signal });
  assertIntegrityFailure(beforeAbort, ASSESSMENT_READ_INTEGRITY_FAILURE_KINDS.aborted);
  assert.deepEqual(beforeStorage.calls, []);

  const duringController = new AbortController();
  const duringSource = exactVersionByteSource([Buffer.from("exact "), Buffer.from("bytes")], {
    onAfterChunk() {
      duringController.abort();
    },
  });
  const duringAbort = await readBridge({ source: duringSource, signal: duringController.signal });
  assertIntegrityFailure(duringAbort, ASSESSMENT_READ_INTEGRITY_FAILURE_KINDS.aborted);
  assert.equal(duringSource.closeCount, 1);
  assert.equal(duringSource.returned, true);

  const listenerController = new AbortController();
  let listenerBalance = 0;
  const originalAdd = listenerController.signal.addEventListener.bind(listenerController.signal);
  const originalRemove = listenerController.signal.removeEventListener.bind(listenerController.signal);
  listenerController.signal.addEventListener = (...args) => {
    if (args[0] === "abort") listenerBalance += 1;
    return originalAdd(...args);
  };
  listenerController.signal.removeEventListener = (...args) => {
    if (args[0] === "abort") listenerBalance -= 1;
    return originalRemove(...args);
  };
  const listenerSource = exactVersionByteSource([Buffer.from("exact bytes")]);
  const listenerStorage = {
    calls: [],
    async openObjectVersionReadStream(input) {
      listenerController.signal.addEventListener("abort", () => {}, { once: true });
      return storageAdapterFor({
        source: {
          ...listenerSource,
          async close() {
            listenerController.signal.removeEventListener("abort", () => {});
            await listenerSource.close();
          },
        },
        sizeBytes: "exact bytes".length,
      }).openObjectVersionReadStream(input);
    },
  };
  const listenerResult = await readBridge({ storageAdapter: listenerStorage, signal: listenerController.signal });
  assert.equal(listenerResult.ok, true);
  assert.equal(listenerSource.closeCount, 1);
  assert.equal(listenerBalance, 0);
});

test("assessment read-integrity bridge uses independent resources for sequential and concurrent calls", async () => {
  const alpha = Buffer.from("alpha bytes");
  const beta = Buffer.from("beta bytes");
  const sequentialAlphaSource = exactVersionByteSource([alpha]);

  const first = await readBridge({ chunks: [alpha], source: sequentialAlphaSource });
  const second = await readBridge({ chunks: [alpha], source: exactVersionByteSource([alpha]) });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(first.data.bytes, second.data.bytes);
  first.data.bytes[0] = 0x00;
  assert.notDeepEqual(first.data.bytes, second.data.bytes);

  const alphaSource = exactVersionByteSource([alpha]);
  const betaSource = exactVersionByteSource([beta]);
  const alphaStorage = storageAdapterFor({ source: alphaSource, sizeBytes: alpha.length });
  const betaStorage = storageAdapterFor({ source: betaSource, sizeBytes: beta.length });
  const [alphaResult, betaResult] = await Promise.all([
    readVerifiedAssessmentBytes({
      objectVersionId: OBJECT_VERSION_ID,
      expectedChecksum: sha256Hex(alpha),
      expectedSize: alpha.length,
      storageAdapter: alphaStorage,
    }),
    readVerifiedAssessmentBytes({
      objectVersionId: OBJECT_VERSION_ID,
      expectedChecksum: sha256Hex(beta),
      expectedSize: beta.length,
      storageAdapter: betaStorage,
    }),
  ]);

  assert.equal(alphaResult.ok, true);
  assert.equal(betaResult.ok, true);
  assert.deepEqual(alphaResult.data.bytes, alpha);
  assert.deepEqual(betaResult.data.bytes, beta);
  assert.equal(alphaSource.closeCount, 1);
  assert.equal(betaSource.closeCount, 1);
});

test("assessment read-integrity bridge remains unwired and isolated from protected surfaces", () => {
  const bridgeSource = readFileSync("Backend/kai/security/assessmentReadIntegrityBridge.js", "utf8");
  const backendIndexSource = readFileSync("Backend/kai/index.js", "utf8");
  const routeSource = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
  const compositionSource = readFileSync("index.js", "utf8");

  assert.doesNotMatch(bridgeSource, /syntheticSecurityAssessmentEnqueue|syntheticConfirmUploadAndEnqueue|internalSecurityAssessmentExecutor|boundedFileSecurityAssessor|detectP0|malware/i);
  assert.doesNotMatch(bridgeSource, /kaiDb|pool\.query|processing_status|parse_status|file_policy_status|upload_state|review_queue|audit/i);
  assert.doesNotMatch(backendIndexSource, /assessmentReadIntegrityBridge|readVerifiedAssessmentBytes/);
  assert.doesNotMatch(routeSource, /assessmentReadIntegrityBridge|readVerifiedAssessmentBytes/);
  assert.doesNotMatch(compositionSource, /assessmentReadIntegrityBridge|readVerifiedAssessmentBytes/);
});
