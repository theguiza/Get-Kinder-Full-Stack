import { createHash } from "node:crypto";

const PROVIDER_NEUTRAL_OBJECT_VERSION_ID_RE = /^ov_[a-f0-9]{32}$/u;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/u;
const ALLOWED_INPUT_KEYS = Object.freeze(new Set([
  "objectVersionId",
  "expectedChecksum",
  "expectedSize",
  "storageAdapter",
  "signal",
]));

export const ASSESSMENT_READ_INTEGRITY_MAX_BYTES = 25 * 1024 * 1024;

export const ASSESSMENT_READ_INTEGRITY_FAILURE_TYPE = "assessment_read_integrity_failure";

export const ASSESSMENT_READ_INTEGRITY_FAILURE_KINDS = Object.freeze({
  invalid_input: "invalid_input",
  exact_version_unavailable: "exact_version_unavailable",
  read_failed: "read_failed",
  size_mismatch: "size_mismatch",
  checksum_mismatch: "checksum_mismatch",
  size_limit_exceeded: "size_limit_exceeded",
  aborted: "aborted",
});

function integrityFailure(kind) {
  return {
    ok: false,
    integrity_failure: {
      type: ASSESSMENT_READ_INTEGRITY_FAILURE_TYPE,
      kind,
    },
  };
}

function validTrustedInput({
  objectVersionId,
  expectedChecksum,
  expectedSize,
  storageAdapter,
}) {
  return (
    typeof objectVersionId === "string" &&
    PROVIDER_NEUTRAL_OBJECT_VERSION_ID_RE.test(objectVersionId) &&
    typeof expectedChecksum === "string" &&
    SHA256_HEX_RE.test(expectedChecksum) &&
    Number.isSafeInteger(expectedSize) &&
    expectedSize >= 0 &&
    storageAdapter &&
    typeof storageAdapter.openObjectVersionReadStream === "function"
  );
}

function hasOnlyAllowedInputKeys(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  return Object.keys(input).every((key) => ALLOWED_INPUT_KEYS.has(key));
}

function validStorageSuccess(storage, objectVersionId) {
  const data = storage?.data;
  return (
    storage?.ok === true &&
    typeof data?.object_version_id === "string" &&
    data.object_version_id === objectVersionId &&
    Number.isSafeInteger(data.size_bytes) &&
    data.size_bytes >= 0 &&
    data.byte_source &&
    typeof data.byte_source[Symbol.asyncIterator] === "function" &&
    typeof data.byte_source.close === "function"
  );
}

async function closeByteSource(byteSource) {
  if (!byteSource || typeof byteSource.close !== "function") return;
  try {
    await byteSource.close();
  } catch {
    // Provider close diagnostics are intentionally hidden by the bridge.
  }
}

function byteLengthOf(chunk) {
  if (Buffer.isBuffer(chunk) || chunk instanceof Uint8Array) return chunk.byteLength;
  return null;
}

export async function readVerifiedAssessmentBytes(input = {}) {
  if (!hasOnlyAllowedInputKeys(input)) {
    return integrityFailure(ASSESSMENT_READ_INTEGRITY_FAILURE_KINDS.invalid_input);
  }
  const {
    objectVersionId,
    expectedChecksum,
    expectedSize,
    storageAdapter,
    signal,
  } = input;
  if (!validTrustedInput({ objectVersionId, expectedChecksum, expectedSize, storageAdapter })) {
    return integrityFailure(ASSESSMENT_READ_INTEGRITY_FAILURE_KINDS.invalid_input);
  }
  if (signal?.aborted) {
    return integrityFailure(ASSESSMENT_READ_INTEGRITY_FAILURE_KINDS.aborted);
  }

  let opened;
  try {
    opened = await storageAdapter.openObjectVersionReadStream({
      objectVersionId,
      ...(signal ? { signal } : {}),
    });
  } catch {
    return integrityFailure(signal?.aborted
      ? ASSESSMENT_READ_INTEGRITY_FAILURE_KINDS.aborted
      : ASSESSMENT_READ_INTEGRITY_FAILURE_KINDS.read_failed);
  }

  if (opened?.ok === false) {
    return integrityFailure(ASSESSMENT_READ_INTEGRITY_FAILURE_KINDS.exact_version_unavailable);
  }
  if (!validStorageSuccess(opened, objectVersionId)) {
    await closeByteSource(opened?.data?.byte_source);
    return integrityFailure(ASSESSMENT_READ_INTEGRITY_FAILURE_KINDS.exact_version_unavailable);
  }

  const byteSource = opened.data.byte_source;
  const storageSize = opened.data.size_bytes;
  const hash = createHash("sha256");
  const chunks = [];
  let countedBytes = 0;

  try {
    for await (const chunk of byteSource) {
      if (signal?.aborted) {
        return integrityFailure(ASSESSMENT_READ_INTEGRITY_FAILURE_KINDS.aborted);
      }

      const chunkLength = byteLengthOf(chunk);
      if (chunkLength === null || chunkLength > Number.MAX_SAFE_INTEGER - countedBytes) {
        return integrityFailure(ASSESSMENT_READ_INTEGRITY_FAILURE_KINDS.read_failed);
      }

      const nextCount = countedBytes + chunkLength;
      if (nextCount > ASSESSMENT_READ_INTEGRITY_MAX_BYTES) {
        return integrityFailure(ASSESSMENT_READ_INTEGRITY_FAILURE_KINDS.size_limit_exceeded);
      }

      countedBytes = nextCount;
      hash.update(chunk);
      chunks.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));

      if (signal?.aborted) {
        return integrityFailure(ASSESSMENT_READ_INTEGRITY_FAILURE_KINDS.aborted);
      }
    }

    if (countedBytes !== storageSize || countedBytes !== expectedSize) {
      return integrityFailure(ASSESSMENT_READ_INTEGRITY_FAILURE_KINDS.size_mismatch);
    }

    const computedChecksum = hash.digest("hex");
    if (computedChecksum !== expectedChecksum) {
      return integrityFailure(ASSESSMENT_READ_INTEGRITY_FAILURE_KINDS.checksum_mismatch);
    }

    return {
      ok: true,
      data: {
        bytes: Buffer.concat(chunks, countedBytes),
      },
      warnings: [],
    };
  } catch {
    return integrityFailure(signal?.aborted
      ? ASSESSMENT_READ_INTEGRITY_FAILURE_KINDS.aborted
      : ASSESSMENT_READ_INTEGRITY_FAILURE_KINDS.read_failed);
  } finally {
    await closeByteSource(byteSource);
  }
}
