import test from "node:test";
import assert from "node:assert/strict";
import { constants, existsSync, readFileSync } from "node:fs";
import { lstat, mkdir, mkdtemp, open, realpath, rm, symlink, writeFile } from "node:fs/promises";
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

test("Google Cloud Storage provider is a disabled stub and imports no SDK", async () => {
  const provider = createGoogleCloudStorageProvider();
  const result = await provider.requestUploadUrl();

  assert.equal(provider.enabled, false);
  assert.equal(provider.provider, "gcs");
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "operation_not_enabled");
  assert.doesNotMatch(gcsProviderSource, /@google-cloud\/storage/);
  assert.doesNotMatch(gcsProviderSource, /\bnew\s+Storage\b|\bgetSignedUrl\b|\bbucket\s*\(/);
});

test("storage validators fail closed for provider and upload URL execution", () => {
  assert.equal(storage_provider_disabled_in_p0({ storageProvider: "gcs" }).blocking_reason, "storage_provider_disabled_in_p0");
  assert.equal(upload_url_request_blocked_in_p0({ storageProvider: "gcs" }).blocking_reason, "upload_url_request_blocked_in_p0");
});

test("storage boundary source contains no SDK import or signed URL implementation", () => {
  const combinedSource = `${storageProviderSource}\n${gcsProviderSource}`;
  assert.doesNotMatch(combinedSource, /@google-cloud\/storage/);
  assert.doesNotMatch(combinedSource, /\bnew\s+Storage\b|\bgetSignedUrl\b|\bcreateSigned/i);
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
