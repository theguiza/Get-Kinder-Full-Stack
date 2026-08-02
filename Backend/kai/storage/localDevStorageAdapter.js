import { StorageAdapter } from "./storageAdapter.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rm, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

const OBJECT_VERSION_ID_PATTERN = /^ov_[a-f0-9]{32}$/u;

function safeError(code, message, status) {
  return buildKaiError(code, { message, status });
}

function isFilesystemRoot(directoryPath) {
  return path.parse(directoryPath).root === directoryPath;
}

function isStrictDescendant(parentDirectory, childDirectory) {
  const relative = path.relative(parentDirectory, childDirectory);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isSameOrDescendant(parentDirectory, childDirectory) {
  const relative = path.relative(parentDirectory, childDirectory);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeRootDirectory(rootDirectory) {
  if (typeof rootDirectory !== "string" || !rootDirectory.trim()) {
    return { ok: false, error_code: "storage_root_not_configured" };
  }
  const root = path.resolve(rootDirectory);
  if (isFilesystemRoot(root)) {
    return { ok: false, error_code: "storage_root_invalid" };
  }
  return { ok: true, root };
}

function normalizeGeneratedObjectVersionId(value) {
  if (typeof value !== "string") {
    return { ok: false };
  }
  const id = value.trim().toLowerCase();
  if (!OBJECT_VERSION_ID_PATTERN.test(id)) {
    return { ok: false };
  }
  return { ok: true, objectVersionId: id };
}

function defaultObjectVersionIdFactory() {
  return `ov_${randomUUID().replaceAll("-", "")}`;
}

function objectsDirectory(canonicalRootDirectory) {
  return path.join(canonicalRootDirectory, "objects");
}

function objectVersionPath(canonicalObjectsDirectory, objectVersionId) {
  return path.join(canonicalObjectsDirectory, `${objectVersionId}.bin`);
}

function copyByteChunk(chunk) {
  if (Buffer.isBuffer(chunk)) return Buffer.from(chunk);
  if (chunk instanceof ArrayBuffer) return Buffer.from(new Uint8Array(chunk));
  if (ArrayBuffer.isView(chunk)) {
    return Buffer.from(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
  }
  throw new TypeError("storage_bytes_must_be_binary");
}

async function* byteChunksFromInput({ bytes, byteSource }) {
  if (bytes !== undefined && byteSource !== undefined) {
    throw new TypeError("storage_bytes_source_ambiguous");
  }
  if (byteSource !== undefined) {
    for await (const chunk of byteSource) {
      yield copyByteChunk(chunk);
    }
    return;
  }
  yield copyByteChunk(bytes);
}

async function rejectSymlink(targetPath) {
  const stat = await lstat(targetPath);
  return stat.isSymbolicLink() ? { ok: false } : { ok: true, stat };
}

async function ensureDirectoryWithoutSymlinkComponents(directoryPath) {
  const resolved = path.resolve(directoryPath);
  const { root } = path.parse(resolved);
  let current = root;

  for (const part of path.relative(root, resolved).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let stat = null;
    try {
      stat = await lstat(current);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        return { ok: false };
      }
      try {
        await mkdir(current, { mode: 0o700 });
        stat = await lstat(current);
      } catch {
        return { ok: false };
      }
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      return { ok: false };
    }
  }

  return { ok: true };
}

async function canonicalExistingDirectoryWithoutSymlinkComponents(directoryPath) {
  const resolved = path.resolve(directoryPath);
  const { root } = path.parse(resolved);
  let current = root;

  for (const part of path.relative(root, resolved).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let stat = null;
    try {
      stat = await lstat(current);
    } catch {
      return { ok: false };
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      return { ok: false };
    }
  }

  try {
    return { ok: true, directory: await realpath(resolved) };
  } catch {
    return { ok: false };
  }
}

async function canonicalizeStorageRoot(configuredRootDirectory) {
  const created = await ensureDirectoryWithoutSymlinkComponents(configuredRootDirectory);
  if (!created.ok) {
    return { ok: false };
  }

  const canonicalResult = await canonicalExistingDirectoryWithoutSymlinkComponents(configuredRootDirectory);
  if (!canonicalResult.ok || isFilesystemRoot(canonicalResult.directory)) {
    return { ok: false };
  }

  let canonicalCwd = null;
  try {
    canonicalCwd = await realpath(process.cwd());
  } catch {
    return { ok: false };
  }
  if (isSameOrDescendant(canonicalCwd, canonicalResult.directory)) {
    return { ok: false, error_code: "storage_root_inside_webroot" };
  }

  return { ok: true, root: canonicalResult.directory };
}

async function canonicalizeObjectsDirectory(canonicalRootDirectory) {
  const configuredObjectsDirectory = objectsDirectory(canonicalRootDirectory);
  const created = await ensureDirectoryWithoutSymlinkComponents(configuredObjectsDirectory);
  if (!created.ok) {
    return { ok: false };
  }

  const canonicalResult = await canonicalExistingDirectoryWithoutSymlinkComponents(configuredObjectsDirectory);
  if (!canonicalResult.ok || !isStrictDescendant(canonicalRootDirectory, canonicalResult.directory)) {
    return { ok: false };
  }

  return { ok: true, objectsDirectory: canonicalResult.directory };
}

function normalizeNoFollowFlag(value) {
  if (!Number.isInteger(value) || value === 0) {
    return { ok: false };
  }
  return { ok: true, flag: value };
}

async function writeCompleteChunk(handle, chunk) {
  let offset = 0;
  while (offset < chunk.length) {
    const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset);
    if (!Number.isInteger(bytesWritten) || bytesWritten <= 0) {
      throw new Error("storage_incomplete_write");
    }
    offset += bytesWritten;
  }
  return offset;
}

async function closeHandleSafely(handle) {
  try {
    await handle.close();
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

function createOpenHandleByteSource(handle, { signal } = {}) {
  const chunkSize = 64 * 1024;
  let position = 0;
  let closed = false;
  let closePromise = null;

  let onAbort = null;
  const closeOnce = async () => {
    if (!closePromise) {
      closed = true;
      if (signal && onAbort) {
        signal.removeEventListener("abort", onAbort);
        onAbort = null;
      }
      closePromise = closeHandleSafely(handle);
    }
    await closePromise;
  };

  if (signal) {
    onAbort = () => {
      void closeOnce();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      void closeOnce();
    }
  }

  return {
    [Symbol.asyncIterator]() {
      return this;
    },

    async next() {
      if (signal?.aborted) {
        await closeOnce();
        throw new DOMException("storage_read_aborted", "AbortError");
      }
      if (closed) {
        return { done: true, value: undefined };
      }

      const buffer = Buffer.allocUnsafe(chunkSize);
      let bytesRead = 0;
      try {
        const readResult = await handle.read(buffer, 0, buffer.length, position);
        bytesRead = readResult?.bytesRead;
      } catch {
        await closeOnce();
        throw new Error("storage_read_failed");
      }
      if (!Number.isInteger(bytesRead) || bytesRead < 0) {
        await closeOnce();
        throw new Error("storage_read_failed");
      }
      if (signal?.aborted) {
        await closeOnce();
        throw new DOMException("storage_read_aborted", "AbortError");
      }
      if (closed) {
        return { done: true, value: undefined };
      }
      if (bytesRead === 0) {
        await closeOnce();
        return { done: true, value: undefined };
      }
      position += bytesRead;
      return { done: false, value: Buffer.from(buffer.subarray(0, bytesRead)) };
    },

    async return() {
      await closeOnce();
      return { done: true, value: undefined };
    },

    async throw(error) {
      await closeOnce();
      throw error;
    },

    async close() {
      await closeOnce();
    },
  };
}

export class LocalDevStorageAdapter extends StorageAdapter {
  constructor(options = {}) {
    super({ provider: "local_dev", ...options });
    const rootResult = normalizeRootDirectory(options.rootDirectory);
    const noFollowResult = normalizeNoFollowFlag(
      Object.hasOwn(options, "noFollowFlagForTest") ? options.noFollowFlagForTest : constants.O_NOFOLLOW,
    );
    this.enabled = rootResult.ok && noFollowResult.ok;
    this.rootDirectory = rootResult.ok ? rootResult.root : null;
    this.objectsDirectory = null;
    this.rootErrorCode = rootResult.ok ? null : rootResult.error_code;
    this.noFollowError = noFollowResult.ok ? null : "storage_no_follow_unavailable";
    this.noFollowFlag = noFollowResult.ok ? noFollowResult.flag : null;
    this.objectVersionIdFactory = options.objectVersionIdFactory || defaultObjectVersionIdFactory;
    this.allowTestTeardown = options.allowTestTeardown === true;
    this.openFile = options.openFileForTest || open;
  }

  async ensureReady() {
    if (this.rootErrorCode === "storage_root_invalid") {
      return safeError("invalid_request", "Local test storage root is invalid.", 400);
    }
    if (!this.rootDirectory) {
      return safeError("storage_provider_not_configured", "Local test storage root is not configured.", 503);
    }
    if (this.noFollowError) {
      return safeError("storage_provider_not_configured", "Local test storage adapter is unavailable on this platform.", 503);
    }

    const rootResult = await canonicalizeStorageRoot(this.rootDirectory);
    if (!rootResult.ok) {
      return safeError("invalid_request", "Local test storage root is invalid.", 400);
    }
    this.rootDirectory = rootResult.root;

    const rootLinkResult = await rejectSymlink(this.rootDirectory);
    if (!rootLinkResult.ok || !rootLinkResult.stat.isDirectory()) {
      return safeError("invalid_request", "Local test storage root is invalid.", 400);
    }

    const objectsResult = await canonicalizeObjectsDirectory(this.rootDirectory);
    if (!objectsResult.ok) {
      return safeError("invalid_request", "Local test storage root is invalid.", 400);
    }
    this.objectsDirectory = objectsResult.objectsDirectory;

    return { ok: true };
  }

  async createObjectVersion({ bytes, byteSource, signal } = {}) {
    const ready = await this.ensureReady();
    if (!ready.ok) return ready;

    const idResult = normalizeGeneratedObjectVersionId(this.objectVersionIdFactory());
    if (!idResult.ok) {
      return safeError("system_error", "Local test storage generated an invalid object version.", 500);
    }

    const objectVersionId = idResult.objectVersionId;
    const objectPath = objectVersionPath(this.objectsDirectory, objectVersionId);
    let handle = null;
    let opened = false;
    let sizeBytes = 0;

    try {
      if (signal?.aborted) throw new DOMException("storage_write_aborted", "AbortError");
      handle = await this.openFile(
        objectPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | this.noFollowFlag,
        0o600,
      );
      opened = true;

      for await (const chunk of byteChunksFromInput({ bytes, byteSource })) {
        if (signal?.aborted) throw new DOMException("storage_write_aborted", "AbortError");
        if (chunk.length === 0) continue;
        sizeBytes += await writeCompleteChunk(handle, chunk);
      }

      await handle.close();
      handle = null;
      return {
        ok: true,
        data: {
          object_version_id: objectVersionId,
          size_bytes: sizeBytes,
        },
      };
    } catch (error) {
      if (handle) {
        await handle.close().catch(() => {});
      }
      if (opened) {
        await unlink(objectPath).catch(() => {});
      }
      if (error?.code === "EEXIST") {
        return safeError("conflict", "Object version already exists.", 409);
      }
      if (error?.name === "AbortError") {
        return safeError("invalid_request", "Object version write was aborted.", 400);
      }
      if (error?.code === "request_too_large") {
        return safeError("request_too_large", "Request body is too large.", 413);
      }
      if (error instanceof TypeError) {
        return safeError("invalid_request", "Object version bytes must be binary.", 400);
      }
      return safeError("system_error", "Local test storage write failed.", 500);
    }
  }

  async statObjectVersion({ objectVersionId } = {}) {
    const ready = await this.ensureReady();
    if (!ready.ok) return ready;

    const idResult = normalizeGeneratedObjectVersionId(objectVersionId);
    if (!idResult.ok) {
      return safeError("invalid_request", "Invalid object version.", 400);
    }

    try {
      const objectPath = objectVersionPath(this.objectsDirectory, idResult.objectVersionId);
      const stat = await lstat(objectPath);
      if (stat.isSymbolicLink()) {
        return safeError("invalid_request", "Invalid object version.", 400);
      }
      if (!stat.isFile()) {
        return safeError("not_found", "Object version not found.", 404);
      }
      return {
        ok: true,
        data: {
          object_version_id: idResult.objectVersionId,
          size_bytes: stat.size,
        },
      };
    } catch (error) {
      if (error?.code === "ENOENT") {
        return safeError("not_found", "Object version not found.", 404);
      }
      return safeError("system_error", "Local test storage stat failed.", 500);
    }
  }

  async readObjectVersion({ objectVersionId } = {}) {
    const statResult = await this.statObjectVersion({ objectVersionId });
    if (!statResult.ok) return statResult;

    let handle = null;
    try {
      const objectPath = objectVersionPath(this.objectsDirectory, statResult.data.object_version_id);
      handle = await this.openFile(objectPath, constants.O_RDONLY | this.noFollowFlag);
      const handleStat = await handle.stat();
      if (!handleStat.isFile()) {
        return safeError("not_found", "Object version not found.", 404);
      }
      const bytes = await handle.readFile();
      await handle.close();
      handle = null;
      return {
        ok: true,
        data: {
          object_version_id: statResult.data.object_version_id,
          size_bytes: bytes.length,
          bytes: Buffer.from(bytes),
        },
      };
    } catch (error) {
      if (error?.code === "ELOOP") {
        return safeError("invalid_request", "Invalid object version.", 400);
      }
      if (error?.code === "ENOENT") {
        return safeError("not_found", "Object version not found.", 404);
      }
      return safeError("system_error", "Local test storage read failed.", 500);
    } finally {
      if (handle) {
        await handle.close().catch(() => {});
      }
    }
  }

  async openObjectVersionReadStream({ objectVersionId, signal } = {}) {
    const idResult = normalizeGeneratedObjectVersionId(objectVersionId);
    if (!idResult.ok) {
      return safeError("invalid_request", "Invalid object version.", 400);
    }

    const ready = await this.ensureReady();
    if (!ready.ok) return ready;

    if (signal?.aborted) {
      return safeError("invalid_request", "Object version read was aborted.", 400);
    }

    let handle = null;
    try {
      const objectPath = objectVersionPath(this.objectsDirectory, idResult.objectVersionId);
      handle = await this.openFile(objectPath, constants.O_RDONLY | this.noFollowFlag);
    } catch (error) {
      if (error?.code === "ELOOP") {
        return safeError("invalid_request", "Invalid object version.", 400);
      }
      if (error?.code === "ENOENT") {
        return safeError("not_found", "Object version not found.", 404);
      }
      return safeError("system_error", "Local test storage open failed.", 500);
    }

    try {
      const stat = await handle.stat();
      if (!stat.isFile()) {
        await closeHandleSafely(handle);
        return safeError("not_found", "Object version not found.", 404);
      }
      if (!Number.isSafeInteger(stat.size) || stat.size < 0) {
        await closeHandleSafely(handle);
        return safeError("system_error", "Local test storage stat failed.", 500);
      }

      return {
        ok: true,
        data: {
          object_version_id: idResult.objectVersionId,
          size_bytes: stat.size,
          byte_source: createOpenHandleByteSource(handle, { signal }),
        },
      };
    } catch {
      if (handle) {
        await closeHandleSafely(handle);
      }
      return safeError("system_error", "Local test storage stat failed.", 500);
    }
  }

  async teardownTestStorage() {
    if (!this.allowTestTeardown || !this.rootDirectory) {
      return safeError("operation_not_enabled", "Local test storage teardown is not enabled.", 422);
    }
    const rootResult = await canonicalExistingDirectoryWithoutSymlinkComponents(this.rootDirectory);
    if (!rootResult.ok) {
      return safeError("operation_not_enabled", "Local test storage teardown is not enabled.", 422);
    }
    const canonicalTmp = await realpath(tmpdir());
    const tmpResult = await canonicalExistingDirectoryWithoutSymlinkComponents(canonicalTmp);
    if (!tmpResult.ok || !isStrictDescendant(tmpResult.directory, rootResult.directory)) {
      return safeError("operation_not_enabled", "Local test storage teardown is not enabled.", 422);
    }
    await rm(rootResult.directory, { recursive: true, force: true });
    return { ok: true };
  }
}
