import test from "node:test";
import assert from "node:assert/strict";
import { constants, existsSync, readFileSync } from "node:fs";
import { lstat, mkdir, mkdtemp, open, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  DISABLED_STORAGE_PROVIDER_CONTRACT,
  createDisabledStorageProvider,
  defaultStorageProvider,
} from "../Backend/kai/storage/storageProvider.js";
import { createGoogleCloudStorageProvider } from "../Backend/kai/storage/googleCloudStorageProvider.js";
import { LocalDevStorageAdapter } from "../Backend/kai/storage/localDevStorageAdapter.js";
import {
  storage_provider_disabled_in_p0,
  upload_url_request_blocked_in_p0,
} from "../Backend/kai/validators/storageValidators.js";
import { KAI_SPRINT2_MAX_FILE_SIZE_BYTES } from "../Backend/kai/config/kaiSprint2P0Contract.js";

const storageProviderSource = readFileSync("Backend/kai/storage/storageProvider.js", "utf8");
const gcsProviderSource = readFileSync("Backend/kai/storage/googleCloudStorageProvider.js", "utf8");
const backendIndexSource = readFileSync("Backend/kai/index.js", "utf8");

function isSameOrDescendant(parentDirectory, childDirectory) {
  const relative = path.relative(parentDirectory, childDirectory);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function makeLocalStorageRoot(testName) {
  const canonicalTmp = await realpath(tmpdir());
  return mkdtemp(path.join(canonicalTmp, `kai-local-test-storage-${testName}-`));
}

async function makeDirectoryOutsideCanonicalTmp(testName) {
  const canonicalTmp = await realpath(tmpdir());
  for (const candidate of ["/private/tmp", path.dirname(canonicalTmp)]) {
    try {
      const canonicalCandidate = await realpath(candidate);
      if (!isSameOrDescendant(canonicalTmp, canonicalCandidate)) {
        return mkdtemp(path.join(canonicalCandidate, `kai-local-test-storage-${testName}-`));
      }
    } catch {
      // Try the next host-specific temporary parent candidate.
    }
  }
  return null;
}

async function withLocalStorage(testName, callback, options = {}) {
  const rootDirectory = await makeLocalStorageRoot(testName);
  const adapter = new LocalDevStorageAdapter({
    rootDirectory,
    allowTestTeardown: true,
    ...options,
  });
  try {
    return await callback({ adapter, rootDirectory });
  } finally {
    await adapter.teardownTestStorage();
  }
}

function objectPath(rootDirectory, objectVersionId) {
  return path.join(rootDirectory, "objects", `${objectVersionId}.bin`);
}

function assertSafeStorageResultBoundary(result) {
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /rootDirectory|objectsDirectory|\.bin|storage_object_key|bucket|signed_url|provider_private/i);
  assert.equal("bytes" in (result.data || {}), false);
}

async function collectByteSource(byteSource) {
  const chunks = [];
  for await (const chunk of byteSource) {
    chunks.push(Buffer.from(chunk));
  }
  return { chunks, bytes: Buffer.concat(chunks) };
}

function isWriteOpen(flags) {
  return (flags & constants.O_WRONLY) === constants.O_WRONLY;
}

function generatedStorageChunks(byteLength) {
  const chunks = [];
  const chunkSize = 8 * 1024 * 1024;
  let remaining = byteLength;
  while (remaining > 0) {
    const next = Math.min(chunkSize, remaining);
    chunks.push(Buffer.alloc(next, 0x61));
    remaining -= next;
  }
  return chunks;
}

function tooLargeStorageSource(chunks) {
  let index = 0;
  let closed = false;
  const source = {
    nextCount: 0,
    returnCount: 0,
    [Symbol.asyncIterator]() {
      return this;
    },
    async next() {
      source.nextCount += 1;
      if (closed) return { done: true, value: undefined };
      if (index >= chunks.length) {
        closed = true;
        return { done: true, value: undefined };
      }
      const value = chunks[index];
      index += 1;
      return { done: false, value };
    },
    async return() {
      source.returnCount += 1;
      closed = true;
      return { done: true, value: undefined };
    },
  };
  return source;
}

async function openCountingReadHandle(filePath, flags, modeValue, counters, overrides = {}) {
  const handle = await open(filePath, flags, modeValue);
  if (isWriteOpen(flags)) return handle;
  counters.open += 1;
  return {
    stat: overrides.stat || (() => handle.stat()),
    read: overrides.read || ((...args) => handle.read(...args)),
    async close() {
      counters.close += 1;
      return handle.close();
    },
  };
}

test("default storage provider boundary is disabled", async () => {
  assert.equal(DISABLED_STORAGE_PROVIDER_CONTRACT, "p0_pass1f_disabled_storage_provider_boundary");
  assert.equal(defaultStorageProvider.enabled, false);

  const result = await defaultStorageProvider.requestUploadUrl();
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "operation_not_enabled");
  assert.equal(result.data.storage_provider_enabled, false);
  assert.equal(result.data.raw_upload_enabled, false);
  assert.equal(result.data.signed_upload_enabled, false);
});

test("raw upload, signed URL, read, and deletion operations are blocked", async () => {
  const provider = createDisabledStorageProvider({ provider: "gcs" });

  for (const operation of [
    provider.requestUploadUrl(),
    provider.requestReadUrl(),
    provider.confirmUpload(),
    provider.uploadFile(),
    provider.downloadFile(),
    provider.deleteFile(),
  ]) {
    const result = await operation;
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "operation_not_enabled");
    assert.equal(result.data.storage_provider_enabled, false);
  }
});

test("Google Cloud Storage provider is disabled by default construction", async () => {
  const provider = createGoogleCloudStorageProvider();
  const result = await provider.createSignedUploadUrl({ objectKey: "kai/org/x/intake/y/z/f.pdf", contentType: "application/pdf" });

  assert.equal(provider.enabled, false);
  assert.equal(provider.provider, "gcs");
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "operation_not_enabled");
});

test("storage validators fail closed for provider and upload URL execution", () => {
  assert.equal(storage_provider_disabled_in_p0({ storageProvider: "gcs" }).blocking_reason, "storage_provider_disabled_in_p0");
  assert.equal(upload_url_request_blocked_in_p0({ storageProvider: "gcs" }).blocking_reason, "upload_url_request_blocked_in_p0");
});

test("storage boundary source contains no direct SQL/database access", () => {
  // Gate C-1 authorizes a real SDK-backed GoogleCloudStorageProvider, so the
  // prior "no @google-cloud/storage import" assertion is intentionally
  // removed here; storageProvider.js (DisabledStorageProvider) itself still
  // imports no SDK. Both files must still never touch SQL/kai.* directly.
  const combinedSource = `${storageProviderSource}\n${gcsProviderSource}`;
  assert.doesNotMatch(combinedSource, /from\s+["'][^"']*(?:kaiDb|db\/pg|pg|kaiQueries|kaiIntakeQueries)\.js["']/);
  assert.doesNotMatch(combinedSource, /\bnew\s+Pool\b|\bpool\.query\b|\bconnect\s*\(/);
});

test("local dev storage adapter rejects filesystem root configuration", async () => {
  const adapter = new LocalDevStorageAdapter({
    rootDirectory: path.parse(process.cwd()).root,
    allowTestTeardown: true,
  });
  const result = await adapter.createObjectVersion({ bytes: Buffer.from("not stored") });

  assert.equal(adapter.enabled, false);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_request");
  assertSafeStorageResultBoundary(result);
});

test("local dev storage adapter rejects roots beneath symlinked ancestors before creating escaped paths", async () => {
  const baseDirectory = await makeLocalStorageRoot("symlink-ancestor-base");
  const outsideDirectory = await makeLocalStorageRoot("symlink-ancestor-outside");
  try {
    const symlinkAncestor = path.join(baseDirectory, "linked-parent");
    await symlink(outsideDirectory, symlinkAncestor);

    const adapter = new LocalDevStorageAdapter({
      rootDirectory: path.join(symlinkAncestor, "escaped-root"),
      allowTestTeardown: true,
    });
    const result = await adapter.createObjectVersion({ bytes: Buffer.from("not stored") });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "invalid_request");
    assert.equal(existsSync(path.join(outsideDirectory, "escaped-root")), false);
    assertSafeStorageResultBoundary(result);
  } finally {
    await rm(baseDirectory, { recursive: true, force: true });
    await rm(outsideDirectory, { recursive: true, force: true });
  }
});

test("local dev storage adapter rejects symlinked object directories", async () => {
  const rootDirectory = await makeLocalStorageRoot("object-directory-symlink");
  const outsideDirectory = await makeLocalStorageRoot("object-directory-outside");
  const objectVersionId = "ov_55555555555555555555555555555555";
  try {
    await symlink(outsideDirectory, path.join(rootDirectory, "objects"));

    const adapter = new LocalDevStorageAdapter({
      rootDirectory,
      allowTestTeardown: true,
      objectVersionIdFactory: () => objectVersionId,
    });
    const result = await adapter.createObjectVersion({ bytes: Buffer.from("not stored") });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "invalid_request");
    assert.equal(existsSync(path.join(outsideDirectory, `${objectVersionId}.bin`)), false);
    assertSafeStorageResultBoundary(result);
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
    await rm(outsideDirectory, { recursive: true, force: true });
  }
});

test("local dev storage adapter creates one immutable generated object version", async () => {
  await withLocalStorage("create-once", async ({ adapter }) => {
    const source = Buffer.from("first bytes");
    const result = await adapter.createObjectVersion({ bytes: source });
    source.fill(0);

    assert.equal(result.ok, true);
    assert.match(result.data.object_version_id, /^ov_[a-f0-9]{32}$/);
    assert.equal(result.data.size_bytes, "first bytes".length);
    assert.doesNotMatch(result.data.object_version_id, /gcs|local|path|bucket|provider/i);
    assertSafeStorageResultBoundary(result);

    const statResult = await adapter.statObjectVersion({ objectVersionId: result.data.object_version_id });
    assert.equal(statResult.ok, true);
    assert.equal(statResult.data.object_version_id, result.data.object_version_id);
    assert.equal(statResult.data.size_bytes, "first bytes".length);
    assertSafeStorageResultBoundary(statResult);

    const readResult = await adapter.readObjectVersion({ objectVersionId: result.data.object_version_id });
    assert.equal(readResult.ok, true);
    assert.equal(readResult.data.object_version_id, result.data.object_version_id);
    assert.equal(readResult.data.size_bytes, "first bytes".length);
    assert.equal(readResult.data.bytes.toString("utf8"), "first bytes");
  });
});

test("local dev storage adapter maps oversized bounded upload failure to safe 413 and removes incomplete object", async () => {
  const objectVersionId = "ov_99999999999999999999999999999999";
  await withLocalStorage("oversized-bounded-source-cleanup", async ({ adapter, rootDirectory }) => {
    const source = tooLargeStorageSource([
      ...generatedStorageChunks(KAI_SPRINT2_MAX_FILE_SIZE_BYTES),
      Buffer.from("x"),
      Buffer.from("must not be requested"),
    ]);
    const result = await adapter.createObjectVersion({
      byteSource: {
        async *[Symbol.asyncIterator]() {
          let countedBytes = 0;
          for await (const chunk of source) {
            const nextCount = countedBytes + chunk.byteLength;
            if (nextCount > KAI_SPRINT2_MAX_FILE_SIZE_BYTES) {
              const error = new Error("too large");
              error.code = "request_too_large";
              error.status = 413;
              throw error;
            }
            countedBytes = nextCount;
            yield chunk;
          }
        },
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "request_too_large");
    assert.equal(result.error.status, 413);
    assert.equal(existsSync(objectPath(rootDirectory, objectVersionId)), false);
    assert.equal(source.nextCount, 5);
    assert.equal(source.returnCount, 1);
    assertSafeStorageResultBoundary(result);
  }, {
    objectVersionIdFactory: () => objectVersionId,
  });
});

test("local dev storage adapter opens exact object-version byte stream", async () => {
  await withLocalStorage("open-stream", async ({ adapter }) => {
    const expected = Buffer.from("streamed exact version bytes");
    const createResult = await adapter.createObjectVersion({ bytes: expected });
    const streamResult = await adapter.openObjectVersionReadStream({
      objectVersionId: createResult.data.object_version_id,
    });

    assert.equal(streamResult.ok, true);
    assert.equal(streamResult.data.object_version_id, createResult.data.object_version_id);
    assert.equal(streamResult.data.size_bytes, expected.length);
    assert.equal(Buffer.isBuffer(streamResult.data.byte_source), false);
    assertSafeStorageResultBoundary(streamResult);

    const collected = await collectByteSource(streamResult.data.byte_source);
    assert.deepEqual(collected.bytes, expected);
  });
});

test("local dev storage adapter streams sufficiently large objects in multiple chunks", async () => {
  await withLocalStorage("open-stream-chunks", async ({ adapter }) => {
    const expected = Buffer.alloc(150000, "x");
    const createResult = await adapter.createObjectVersion({ bytes: expected });
    const streamResult = await adapter.openObjectVersionReadStream({
      objectVersionId: createResult.data.object_version_id,
    });

    assert.equal(streamResult.ok, true);
    const collected = await collectByteSource(streamResult.data.byte_source);
    assert.equal(collected.bytes.length, streamResult.data.size_bytes);
    assert.deepEqual(collected.bytes, expected);
    assert.equal(collected.chunks.length > 1, true);
  });
});

test("local dev storage adapter streamed read missing and malformed versions fail safely", async () => {
  let openCalls = 0;
  await withLocalStorage(
    "open-stream-failures",
    async ({ adapter }) => {
      const missingResult = await adapter.openObjectVersionReadStream({
        objectVersionId: "ov_77777777777777777777777777777777",
      });
      assert.equal(missingResult.ok, false);
      assert.equal(missingResult.error.code, "not_found");
      assertSafeStorageResultBoundary(missingResult);

      const malformedResult = await adapter.openObjectVersionReadStream({
        objectVersionId: "bad-version",
      });
      assert.equal(malformedResult.ok, false);
      assert.equal(malformedResult.error.code, "invalid_request");
      assertSafeStorageResultBoundary(malformedResult);
      assert.equal(openCalls, 1);
    },
    {
      openFileForTest(filePath, flags, modeValue) {
        openCalls += 1;
        return open(filePath, flags, modeValue);
      },
    },
  );
});

test("local dev storage adapter byte_source close before first next closes the handle", async () => {
  const counters = { open: 0, close: 0 };
  await withLocalStorage(
    "open-stream-close-before-next",
    async ({ adapter }) => {
      const createResult = await adapter.createObjectVersion({ bytes: Buffer.from("close before next") });
      const streamResult = await adapter.openObjectVersionReadStream({
        objectVersionId: createResult.data.object_version_id,
      });

      assert.equal(streamResult.ok, true);
      assert.equal(typeof streamResult.data.byte_source.close, "function");
      await streamResult.data.byte_source.close();
      assert.equal(counters.close, 1);
      assert.deepEqual(await streamResult.data.byte_source.next(), { done: true, value: undefined });
      await streamResult.data.byte_source.close();
      assert.equal(counters.close, 1);
    },
    {
      openFileForTest: (filePath, flags, modeValue) => openCountingReadHandle(filePath, flags, modeValue, counters),
    },
  );
});

test("local dev storage adapter byte_source return before first next closes the handle", async () => {
  const counters = { open: 0, close: 0 };
  await withLocalStorage(
    "open-stream-return-before-next",
    async ({ adapter }) => {
      const createResult = await adapter.createObjectVersion({ bytes: Buffer.from("return before next") });
      const streamResult = await adapter.openObjectVersionReadStream({
        objectVersionId: createResult.data.object_version_id,
      });

      assert.equal(streamResult.ok, true);
      assert.deepEqual(await streamResult.data.byte_source.return(), { done: true, value: undefined });
      assert.equal(counters.close, 1);
      assert.deepEqual(await streamResult.data.byte_source.return(), { done: true, value: undefined });
      assert.equal(counters.close, 1);
    },
    {
      openFileForTest: (filePath, flags, modeValue) => openCountingReadHandle(filePath, flags, modeValue, counters),
    },
  );
});

test("local dev storage adapter abort after open before first next closes the handle", async () => {
  const counters = { open: 0, close: 0 };
  await withLocalStorage(
    "open-stream-abort-before-next",
    async ({ adapter }) => {
      const controller = new AbortController();
      const createResult = await adapter.createObjectVersion({ bytes: Buffer.from("abort before next") });
      const streamResult = await adapter.openObjectVersionReadStream({
        objectVersionId: createResult.data.object_version_id,
        signal: controller.signal,
      });

      assert.equal(streamResult.ok, true);
      controller.abort();
      await assert.rejects(() => streamResult.data.byte_source.next(), { name: "AbortError" });
      assert.equal(counters.close, 1);
      await streamResult.data.byte_source.close();
      assert.equal(counters.close, 1);
    },
    {
      openFileForTest: (filePath, flags, modeValue) => openCountingReadHandle(filePath, flags, modeValue, counters),
    },
  );
});

test("local dev storage adapter already-aborted signal does not leave a handle open", async () => {
  const controller = new AbortController();
  controller.abort();
  const counters = { open: 0, close: 0 };

  await withLocalStorage(
    "open-stream-already-aborted",
    async ({ adapter }) => {
      const createResult = await adapter.createObjectVersion({ bytes: Buffer.from("already aborted") });
      const streamResult = await adapter.openObjectVersionReadStream({
        objectVersionId: createResult.data.object_version_id,
        signal: controller.signal,
      });

      assert.equal(streamResult.ok, false);
      assert.equal(streamResult.error.code, "invalid_request");
      assert.equal(counters.open, 0);
      assert.equal(counters.close, 0);
      assertSafeStorageResultBoundary(streamResult);
    },
    {
      openFileForTest: (filePath, flags, modeValue) => openCountingReadHandle(filePath, flags, modeValue, counters),
    },
  );
});

test("local dev storage adapter abort during open result construction closes the handle", async () => {
  const controller = new AbortController();
  const counters = { open: 0, close: 0 };

  await withLocalStorage(
    "open-stream-abort-during-stat",
    async ({ adapter }) => {
      const createResult = await adapter.createObjectVersion({ bytes: Buffer.from("abort during stat") });
      const streamResult = await adapter.openObjectVersionReadStream({
        objectVersionId: createResult.data.object_version_id,
        signal: controller.signal,
      });

      assert.equal(streamResult.ok, true);
      await assert.rejects(() => streamResult.data.byte_source.next(), { name: "AbortError" });
      assert.equal(counters.close, 1);
    },
    {
      openFileForTest: (filePath, flags, modeValue) => openCountingReadHandle(filePath, flags, modeValue, counters, {
        async stat() {
          controller.abort();
          return { isFile: () => true, size: "abort during stat".length };
        },
      }),
    },
  );
});

test("local dev storage adapter byte_source throw closes and propagates consumer error", async () => {
  const counters = { open: 0, close: 0 };
  await withLocalStorage(
    "open-stream-throw-close",
    async ({ adapter }) => {
      const createResult = await adapter.createObjectVersion({ bytes: Buffer.from("throw close") });
      const streamResult = await adapter.openObjectVersionReadStream({
        objectVersionId: createResult.data.object_version_id,
      });

      assert.equal(streamResult.ok, true);
      const error = new Error("consumer_safe_error");
      await assert.rejects(() => streamResult.data.byte_source.throw(error), /consumer_safe_error/);
      assert.equal(counters.close, 1);
      await streamResult.data.byte_source.return();
      assert.equal(counters.close, 1);
    },
    {
      openFileForTest: (filePath, flags, modeValue) => openCountingReadHandle(filePath, flags, modeValue, counters),
    },
  );
});

test("local dev storage adapter read failure closes exactly once and hides native details", async () => {
  const counters = { open: 0, close: 0 };
  await withLocalStorage(
    "open-stream-read-failure",
    async ({ adapter }) => {
      const createResult = await adapter.createObjectVersion({ bytes: Buffer.from("read failure") });
      const streamResult = await adapter.openObjectVersionReadStream({
        objectVersionId: createResult.data.object_version_id,
      });

      assert.equal(streamResult.ok, true);
      await assert.rejects(
        () => streamResult.data.byte_source.next(),
        (error) => error?.message === "storage_read_failed" && !String(error?.message).includes("/private/"),
      );
      assert.equal(counters.close, 1);
      await streamResult.data.byte_source.close();
      assert.equal(counters.close, 1);
    },
    {
      openFileForTest: (filePath, flags, modeValue) => openCountingReadHandle(filePath, flags, modeValue, counters, {
        async read() {
          throw new Error("native read failure /private/tmp/provider-secret.bin");
        },
      }),
    },
  );
});

test("local dev storage adapter repeated close return and abort operations are idempotent", async () => {
  const counters = { open: 0, close: 0 };
  await withLocalStorage(
    "open-stream-idempotent-close",
    async ({ adapter }) => {
      const controller = new AbortController();
      const createResult = await adapter.createObjectVersion({ bytes: Buffer.from("idempotent") });
      const streamResult = await adapter.openObjectVersionReadStream({
        objectVersionId: createResult.data.object_version_id,
        signal: controller.signal,
      });

      assert.equal(streamResult.ok, true);
      await streamResult.data.byte_source.close();
      await streamResult.data.byte_source.return();
      controller.abort();
      await streamResult.data.byte_source.close();
      assert.equal(counters.close, 1);
    },
    {
      openFileForTest: (filePath, flags, modeValue) => openCountingReadHandle(filePath, flags, modeValue, counters),
    },
  );
});

test("local dev storage adapter removes abort listener when byte_source closes", async () => {
  const controller = new AbortController();
  let listenerBalance = 0;
  const originalAdd = controller.signal.addEventListener.bind(controller.signal);
  const originalRemove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.addEventListener = (...args) => {
    if (args[0] === "abort") listenerBalance += 1;
    return originalAdd(...args);
  };
  controller.signal.removeEventListener = (...args) => {
    if (args[0] === "abort") listenerBalance -= 1;
    return originalRemove(...args);
  };

  await withLocalStorage("open-stream-abort-listener-remove", async ({ adapter }) => {
    const createResult = await adapter.createObjectVersion({ bytes: Buffer.from("listener") });
    const streamResult = await adapter.openObjectVersionReadStream({
      objectVersionId: createResult.data.object_version_id,
      signal: controller.signal,
    });

    assert.equal(streamResult.ok, true);
    assert.equal(listenerBalance, 1);
    await streamResult.data.byte_source.close();
    assert.equal(listenerBalance, 0);
    controller.abort();
    assert.equal(listenerBalance, 0);
  });
});

test("local dev storage adapter streamed read abort and cancellation close the handle", async () => {
  for (const mode of ["abort", "cancel"]) {
    let closeCount = 0;
    await withLocalStorage(
      `open-stream-${mode}`,
      async ({ adapter }) => {
        const createResult = await adapter.createObjectVersion({ bytes: Buffer.alloc(200000, "a") });
        const controller = new AbortController();
        const streamResult = await adapter.openObjectVersionReadStream({
          objectVersionId: createResult.data.object_version_id,
          signal: controller.signal,
        });

        assert.equal(streamResult.ok, true);
        const iterator = streamResult.data.byte_source[Symbol.asyncIterator]();
        const first = await iterator.next();
        assert.equal(first.done, false);
        if (mode === "abort") {
          controller.abort();
          await assert.rejects(() => iterator.next(), { name: "AbortError" });
        } else {
          await iterator.return();
        }
        assert.equal(closeCount, 1);
      },
      {
        openFileForTest: async (filePath, flags, modeValue) => {
          const handle = await open(filePath, flags, modeValue);
          if ((flags & constants.O_WRONLY) === constants.O_WRONLY) return handle;
          return {
            stat: () => handle.stat(),
            read: (...args) => handle.read(...args),
            async close() {
              closeCount += 1;
              return handle.close();
            },
          };
        },
      },
    );
  }
});

test("local dev storage adapter streamed read normal completion closes the handle", async () => {
  let closeCount = 0;
  await withLocalStorage(
    "open-stream-complete-close",
    async ({ adapter }) => {
      const expected = Buffer.from("complete close");
      const createResult = await adapter.createObjectVersion({ bytes: expected });
      const streamResult = await adapter.openObjectVersionReadStream({
        objectVersionId: createResult.data.object_version_id,
      });

      assert.equal(streamResult.ok, true);
      const collected = await collectByteSource(streamResult.data.byte_source);
      assert.deepEqual(collected.bytes, expected);
      assert.equal(closeCount, 1);
    },
    {
      openFileForTest: async (filePath, flags, modeValue) => {
        const handle = await open(filePath, flags, modeValue);
        if ((flags & constants.O_WRONLY) === constants.O_WRONLY) return handle;
        return {
          stat: () => handle.stat(),
          read: (...args) => handle.read(...args),
          async close() {
            closeCount += 1;
            return handle.close();
          },
        };
      },
    },
  );
});

test("local dev storage adapter streamed read binds stat and bytes to one open handle", async () => {
  const objectVersionId = "ov_88888888888888888888888888888888";
  const expected = Buffer.from("same handle data");
  const calls = [];

  await withLocalStorage(
    "open-stream-same-handle",
    async ({ adapter }) => {
      const streamResult = await adapter.openObjectVersionReadStream({ objectVersionId });

      assert.equal(streamResult.ok, true);
      assert.equal(streamResult.data.size_bytes, expected.length);
      const collected = await collectByteSource(streamResult.data.byte_source);
      assert.deepEqual(collected.bytes, expected);
      assert.deepEqual(calls, ["open", "stat", "read", "read", "close"]);
    },
    {
      openFileForTest: async () => {
        let position = 0;
        calls.push("open");
        return {
          async stat() {
            calls.push("stat");
            return { isFile: () => true, size: expected.length };
          },
          async read(buffer, offset, length) {
            calls.push("read");
            const slice = expected.subarray(position, position + length);
            slice.copy(buffer, offset);
            position += slice.length;
            return { bytesRead: slice.length };
          },
          async close() {
            calls.push("close");
          },
        };
      },
    },
  );
});

test("local dev storage adapter streamed read stays on opened object after path replacement", async () => {
  await withLocalStorage("open-stream-path-replace", async ({ adapter, rootDirectory }) => {
    const original = Buffer.alloc(150000, "o");
    const replacement = Buffer.alloc(150000, "r");
    const createResult = await adapter.createObjectVersion({ bytes: original });
    const streamResult = await adapter.openObjectVersionReadStream({
      objectVersionId: createResult.data.object_version_id,
    });
    assert.equal(streamResult.ok, true);

    const openedObjectPath = objectPath(rootDirectory, createResult.data.object_version_id);
    const renamedObjectPath = path.join(rootDirectory, "objects", "renamed-open-object.bin");
    await rename(openedObjectPath, renamedObjectPath);
    await writeFile(openedObjectPath, replacement);

    const collected = await collectByteSource(streamResult.data.byte_source);
    assert.deepEqual(collected.bytes, original);
    assert.notDeepEqual(collected.bytes, replacement);
  });
});

test("local dev storage adapter rejects repeated generated object-version writes", async () => {
  await withLocalStorage(
    "repeat-reject",
    async ({ adapter }) => {
      const first = await adapter.createObjectVersion({ bytes: Buffer.from("first") });
      const second = await adapter.createObjectVersion({ bytes: Buffer.from("second raw bytes") });

      assert.equal(first.ok, true);
      assert.equal(second.ok, false);
      assert.equal(second.error.code, "conflict");
      assertSafeStorageResultBoundary(second);
      assert.doesNotMatch(JSON.stringify(second), /second raw bytes/);

      const readResult = await adapter.readObjectVersion({ objectVersionId: first.data.object_version_id });
      assert.equal(readResult.ok, true);
      assert.equal(readResult.data.bytes.toString("utf8"), "first");
    },
    { objectVersionIdFactory: () => "ov_11111111111111111111111111111111" },
  );
});

test("local dev storage adapter stores multi-chunk byte sources with complete partial writes", async () => {
  const objectVersionId = "ov_66666666666666666666666666666666";
  const expected = Buffer.concat([Buffer.from("alpha"), Buffer.from("beta"), Buffer.from("gamma")]);
  const writeLengths = [];
  let createFlags = 0;

  await withLocalStorage(
    "multi-chunk-complete-writes",
    async ({ adapter }) => {
      async function* source() {
        yield Buffer.from("alpha");
        yield new Uint8Array(Buffer.from("beta"));
        yield Buffer.from("");
        yield Buffer.from("gamma");
      }

      const createResult = await adapter.createObjectVersion({ byteSource: source() });
      assert.equal(createResult.ok, true);
      assert.equal(createResult.data.object_version_id, objectVersionId);
      assert.equal(createResult.data.size_bytes, expected.length);
      assert.equal((createFlags & constants.O_EXCL) === constants.O_EXCL, true);
      assert.equal((createFlags & constants.O_NOFOLLOW) === constants.O_NOFOLLOW, true);
      assert.equal(writeLengths.some((length) => length < 5), true);

      const statResult = await adapter.statObjectVersion({ objectVersionId });
      assert.equal(statResult.ok, true);
      assert.equal(statResult.data.size_bytes, expected.length);

      const readResult = await adapter.readObjectVersion({ objectVersionId });
      assert.equal(readResult.ok, true);
      assert.equal(readResult.data.size_bytes, expected.length);
      assert.deepEqual(readResult.data.bytes, expected);
    },
    {
      objectVersionIdFactory: () => objectVersionId,
      openFileForTest: async (filePath, flags, mode) => {
        if ((flags & constants.O_WRONLY) !== constants.O_WRONLY) {
          return open(filePath, flags, mode);
        }
        createFlags = flags;
        const handle = await open(filePath, flags, mode);
        return {
          async write(buffer, offset, length) {
            const requestedLength = Math.min(length, 2);
            const result = await handle.write(buffer, offset, requestedLength);
            writeLengths.push(result.bytesWritten);
            return result;
          },
          close: () => handle.close(),
        };
      },
    },
  );
});

test("local dev storage adapter removes incomplete writes after source failure", async () => {
  await withLocalStorage(
    "source-failure",
    async ({ adapter, rootDirectory }) => {
      async function* failingSource() {
        yield Buffer.from("partial");
        throw new Error("source failed with raw bytes");
      }

      const result = await adapter.createObjectVersion({ byteSource: failingSource() });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "system_error");
      assertSafeStorageResultBoundary(result);
      assert.doesNotMatch(JSON.stringify(result), /partial|raw bytes/);
      assert.equal(existsSync(objectPath(rootDirectory, "ov_22222222222222222222222222222222")), false);

      const retry = await adapter.createObjectVersion({ bytes: Buffer.from("complete") });
      assert.equal(retry.ok, true);
      assert.equal(retry.data.object_version_id, "ov_22222222222222222222222222222222");
      const readResult = await adapter.readObjectVersion({ objectVersionId: retry.data.object_version_id });
      assert.equal(readResult.data.bytes.toString("utf8"), "complete");
    },
    { objectVersionIdFactory: () => "ov_22222222222222222222222222222222" },
  );
});

test("local dev storage adapter removes incomplete writes after abort", async () => {
  await withLocalStorage(
    "abort-cleanup",
    async ({ adapter, rootDirectory }) => {
      const controller = new AbortController();
      async function* abortingSource() {
        yield Buffer.from("partial");
        controller.abort();
        yield Buffer.from("unwritten");
      }

      const result = await adapter.createObjectVersion({
        byteSource: abortingSource(),
        signal: controller.signal,
      });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "invalid_request");
      assert.equal(existsSync(objectPath(rootDirectory, "ov_33333333333333333333333333333333")), false);
      assertSafeStorageResultBoundary(result);
    },
    { objectVersionIdFactory: () => "ov_33333333333333333333333333333333" },
  );
});

test("local dev storage adapter blocks symlink object versions", async () => {
  await withLocalStorage(
    "symlink",
    async ({ adapter, rootDirectory }) => {
      const objectsDirectory = path.join(rootDirectory, "objects");
      await mkdir(objectsDirectory, { recursive: true });
      const outsideFile = path.join(rootDirectory, "outside-secret.bin");
      await writeFile(outsideFile, Buffer.from("outside"));
      await symlink(outsideFile, objectPath(rootDirectory, "ov_44444444444444444444444444444444"));

      const statResult = await adapter.statObjectVersion({ objectVersionId: "ov_44444444444444444444444444444444" });
      const readResult = await adapter.readObjectVersion({ objectVersionId: "ov_44444444444444444444444444444444" });

      assert.equal(statResult.ok, false);
      assert.equal(statResult.error.code, "invalid_request");
      assert.equal(readResult.ok, false);
      assert.equal(readResult.error.code, "invalid_request");
      assertSafeStorageResultBoundary(statResult);
      assertSafeStorageResultBoundary(readResult);
    },
  );
});

test("local dev storage adapter does not silently degrade when no-follow protection is unavailable", async () => {
  const rootDirectory = await makeLocalStorageRoot("nofollow-unavailable");
  const adapter = new LocalDevStorageAdapter({
    rootDirectory,
    allowTestTeardown: true,
    noFollowFlagForTest: undefined,
  });
  try {
    const result = await adapter.createObjectVersion({ bytes: Buffer.from("not stored") });

    assert.equal(adapter.enabled, false);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "storage_provider_not_configured");
    assert.doesNotMatch(JSON.stringify(result), /O_NOFOLLOW|noFollowFlag|rootDirectory|objectsDirectory|\.bin/i);
    assertSafeStorageResultBoundary(result);
  } finally {
    await adapter.teardownTestStorage();
  }
});

test("local dev storage adapter uses private test roots and test-scoped teardown", async () => {
  const rootDirectory = await makeLocalStorageRoot("teardown");
  const adapter = new LocalDevStorageAdapter({ rootDirectory, allowTestTeardown: true });
  const createResult = await adapter.createObjectVersion({ bytes: Buffer.from("teardown") });

  assert.equal(adapter.enabled, true);
  assert.equal(createResult.ok, true);
  assert.equal(path.relative(process.cwd(), rootDirectory).startsWith(".."), true);
  assert.equal((await lstat(rootDirectory)).isSymbolicLink(), false);

  const teardownResult = await adapter.teardownTestStorage();
  assert.equal(teardownResult.ok, true);
  assert.equal(existsSync(rootDirectory), false);
});

test("local dev storage adapter teardown rejects symlinked ancestor escape from canonical temp", async (t) => {
  const canonicalTmp = await realpath(tmpdir());
  const baseDirectory = await makeLocalStorageRoot("teardown-symlink-base");
  const outsideDirectory = await makeDirectoryOutsideCanonicalTmp("teardown-symlink-outside");
  if (!outsideDirectory) {
    await rm(baseDirectory, { recursive: true, force: true });
    t.skip("No writable directory outside canonical OS temp root is available.");
    return;
  }

  const escapedRoot = path.join(outsideDirectory, "escaped-root");
  const markerPath = path.join(escapedRoot, "marker.txt");
  try {
    assert.equal(isSameOrDescendant(canonicalTmp, await realpath(outsideDirectory)), false);
    await mkdir(escapedRoot, { recursive: true });
    await writeFile(markerPath, Buffer.from("do not delete"));
    const symlinkAncestor = path.join(baseDirectory, "linked-parent");
    await symlink(outsideDirectory, symlinkAncestor);

    const adapter = new LocalDevStorageAdapter({
      rootDirectory: path.join(symlinkAncestor, "escaped-root"),
      allowTestTeardown: true,
    });
    const teardownResult = await adapter.teardownTestStorage();

    assert.equal(teardownResult.ok, false);
    assert.equal(teardownResult.error.code, "operation_not_enabled");
    assert.equal(existsSync(markerPath), true);
    assertSafeStorageResultBoundary(teardownResult);
  } finally {
    await rm(baseDirectory, { recursive: true, force: true });
    await rm(outsideDirectory, { recursive: true, force: true });
  }
});

test("local dev storage adapter fails closed without an injected private root", async () => {
  const adapter = new LocalDevStorageAdapter();
  const result = await adapter.createObjectVersion({ bytes: Buffer.from("not stored") });

  assert.equal(adapter.enabled, false);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "storage_provider_not_configured");
  assertSafeStorageResultBoundary(result);
});

test("production storage selection remains disabled and fail closed", () => {
  assert.equal(defaultStorageProvider.enabled, false);
  assert.equal("LocalDevStorageAdapter" in defaultStorageProvider, false);
  assert.doesNotMatch(backendIndexSource, /localDevStorageAdapter|LocalDevStorageAdapter/);
});
