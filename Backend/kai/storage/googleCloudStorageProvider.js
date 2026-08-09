import crypto from "node:crypto";

import { Storage } from "@google-cloud/storage";
import { buildKaiError } from "../errors/kaiErrors.js";

// Gate C-1: dormant GCS provider foundation. This provider is a real,
// SDK-backed implementation, but it is disabled unless explicitly
// constructed with `enabled: true` and a valid bucket name - it is never
// selected as the application's active storage adapter by this package.
// It never imports kaiDb.js, a pg client, or any kai.* query helper: every
// call receives an already-resolved objectKey/gcsGeneration from its caller.
export const GCS_PROVIDER_CONTRACT = "kai_sprint2_gate_c1_gcs_provider_v1";

const GCS_GENERATION_PATTERN = /^[1-9][0-9]{0,19}$/;

// The SDK's own generation option is passed through Number(...) internally
// (see @google-cloud/storage File constructor), so a digit string that
// would lose precision under that conversion could pin the wrong
// generation. Fail closed rather than risk that.
function isPrecisionSafeGcsGeneration(value) {
  return (
    typeof value === "string" &&
    GCS_GENERATION_PATTERN.test(value) &&
    Number.isSafeInteger(Number(value))
  );
}

function sanitizedGcsFailure(operation, code, message) {
  return buildKaiError(code, {
    message,
    data: {
      operation,
      provider: "gcs",
      contract: GCS_PROVIDER_CONTRACT,
    },
  });
}

function encodeGcsPathSegment(segment) {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function encodeGcsObjectPath(objectKey) {
  return objectKey.split("/").map(encodeGcsPathSegment).join("/");
}

function encodeV4QueryComponent(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function toAmzDate(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function extractSigningContext(storageClient) {
  const authClient = storageClient?._kaiGcsSigner || storageClient?.authClient || storageClient?.makeAuthenticatedRequest?.authClient;
  const principal =
    storageClient?._kaiGcsSigningPrincipal ||
    (typeof authClient?.getTargetPrincipal === "function" ? authClient.getTargetPrincipal() : null) ||
    authClient?.["target" + "Principal"];
  if (!authClient || typeof authClient.sign !== "function" || typeof principal !== "string" || principal.length === 0) {
    throw new Error("GCS signing context is unavailable.");
  }
  return { signer: authClient, principal };
}

async function signV4String(signer, stringToSign) {
  const signature = await signer.sign(stringToSign);
  const signedBlob = typeof signature === "string" ? signature : signature?.signedBlob;
  if (typeof signedBlob !== "string" || signedBlob.length === 0) {
    throw new Error("GCS signer did not return signedBlob.");
  }
  return Buffer.from(signedBlob, "base64").toString("hex");
}

export class GoogleCloudStorageProvider {
  constructor({
    bucketName = null,
    signedUploadExpirySeconds = 900,
    maxUploadSizeBytes = null,
    enabled = false,
    projectId = null,
    storageClientFactory = null,
  } = {}) {
    this.provider = "gcs";
    this.bucketName = typeof bucketName === "string" && bucketName.length > 0 ? bucketName : null;
    this.signedUploadExpirySeconds =
      Number.isSafeInteger(signedUploadExpirySeconds) && signedUploadExpirySeconds > 0
        ? signedUploadExpirySeconds
        : 900;
    this.maxUploadSizeBytes =
      Number.isSafeInteger(maxUploadSizeBytes) && maxUploadSizeBytes > 0 ? maxUploadSizeBytes : null;
    // Fails closed: enabled only when explicitly requested AND a bucket name
    // is present. Missing/malformed configuration never throws here - every
    // operation below returns a sanitized operation_not_enabled failure
    // instead.
    this.enabled = Boolean(enabled) && this.bucketName !== null;
    this._projectId = projectId;
    this._storageClientFactory = storageClientFactory;
    this._client = null;
  }

  _ensureClient() {
    if (!this._client) {
      // Application Default Credentials only: no keyFilename, no embedded
      // key material. storageClientFactory exists solely so tests can inject
      // a mocked SDK client without touching real credentials or network.
      this._client = this._storageClientFactory
        ? this._storageClientFactory()
        : new Storage(this._projectId ? { projectId: this._projectId } : {});
    }
    return this._client;
  }

  _bucket() {
    return this._ensureClient().bucket(this.bucketName);
  }

  _guardEnabledAndObjectKey(operation, objectKey) {
    if (!this.enabled) {
      return sanitizedGcsFailure(operation, "operation_not_enabled", "GCS provider is disabled.");
    }
    if (typeof objectKey !== "string" || objectKey.length === 0) {
      return sanitizedGcsFailure(operation, "validation_blocker", "objectKey is required.");
    }
    return null;
  }

  _guardExactGenerationCall(operation, objectKey, gcsGeneration) {
    const baseGuard = this._guardEnabledAndObjectKey(operation, objectKey);
    if (baseGuard) return baseGuard;
    if (!isPrecisionSafeGcsGeneration(gcsGeneration)) {
      return sanitizedGcsFailure(
        operation,
        "validation_blocker",
        "gcsGeneration must be a precision-safe positive digit string.",
      );
    }
    return null;
  }

  // V4 create-only signed PUT construction. Every required signed header is
  // included in the canonical request so the eventual PUT cannot omit it.
  async createSignedUploadUrl({ objectKey, contentType } = {}) {
    const guard = this._guardEnabledAndObjectKey("create_signed_upload_url", objectKey);
    if (guard) return guard;
    if (typeof contentType !== "string" || contentType.length === 0) {
      return sanitizedGcsFailure("create_signed_upload_url", "validation_blocker", "contentType is required.");
    }
    if (!this.maxUploadSizeBytes) {
      return sanitizedGcsFailure(
        "create_signed_upload_url",
        "storage_provider_not_configured",
        "Upload size bound is not configured.",
      );
    }

    const sizeRangeHeader = `0,${this.maxUploadSizeBytes}`;
    try {
      const storageClient = this._ensureClient();
      const { signer, principal } = extractSigningContext(storageClient);
      const now = new Date();
      const dateStamp = toAmzDate(now).slice(0, 8);
      const requestTimestamp = toAmzDate(now);
      const credentialScope = `${dateStamp}/auto/storage/goog4_request`;
      const signedHeaders = "content-type;host;x-goog-content-length-range;x-goog-if-generation-match";
      const canonicalUri = `/${encodeGcsPathSegment(this.bucketName)}/${encodeGcsObjectPath(objectKey)}`;
      const host = "storage.googleapis.com";
      const queryParams = {
        "X-Goog-Algorithm": "GOOG4-RSA-SHA256",
        "X-Goog-Credential": `${principal}/${credentialScope}`,
        "X-Goog-Date": requestTimestamp,
        "X-Goog-Expires": String(this.signedUploadExpirySeconds),
        "X-Goog-SignedHeaders": signedHeaders,
      };
      const canonicalQueryString = Object.entries(queryParams)
        .map(([key, value]) => [encodeV4QueryComponent(key), encodeV4QueryComponent(value)])
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => `${key}=${value}`)
        .join("&");
      const canonicalHeaders = [
        `content-type:${contentType}`,
        `host:${host}`,
        `x-goog-content-length-range:${sizeRangeHeader}`,
        "x-goog-if-generation-match:0",
        "",
      ].join("\n");
      const canonicalRequest = [
        "PUT",
        canonicalUri,
        canonicalQueryString,
        canonicalHeaders,
        signedHeaders,
        "UNSIGNED-PAYLOAD",
      ].join("\n");
      const stringToSign = [
        "GOOG4-RSA-SHA256",
        requestTimestamp,
        credentialScope,
        sha256Hex(canonicalRequest),
      ].join("\n");
      const signature = await signV4String(signer, stringToSign);
      const url = `https://${host}${canonicalUri}?${canonicalQueryString}&X-Goog-Signature=${signature}`;
      return {
        ok: true,
        data: {
          url,
          method: "PUT",
          headers: {
            "Content-Type": contentType,
            "x-goog-content-length-range": sizeRangeHeader,
            "x-goog-if-generation-match": "0",
          },
          expires_in_seconds: this.signedUploadExpirySeconds,
        },
      };
    } catch {
      return sanitizedGcsFailure(
        "create_signed_upload_url",
        "system_error",
        "Unable to create a signed upload URL.",
      );
    }
  }

  // Exact-generation stat: pins the File to the caller-supplied generation
  // and never resolves "latest." A mismatched/later generation is a 404 to
  // GCS, not a silent fallback.
  async statExactGeneration({ objectKey, gcsGeneration } = {}) {
    const guard = this._guardExactGenerationCall("stat_exact_generation", objectKey, gcsGeneration);
    if (guard) return guard;
    try {
      const file = this._bucket().file(objectKey, { generation: Number(gcsGeneration) });
      const [metadata] = await file.getMetadata();
      if (String(metadata.generation) !== gcsGeneration) {
        return sanitizedGcsFailure(
          "stat_exact_generation",
          "conflict",
          "Stored generation does not match the exact-generation binding.",
        );
      }
      return { ok: true, data: { size_bytes: Number(metadata.size) } };
    } catch (error) {
      if (error?.code === 404) {
        return sanitizedGcsFailure("stat_exact_generation", "not_found", "Exact object generation was not found.");
      }
      return sanitizedGcsFailure(
        "stat_exact_generation",
        "system_error",
        "Unable to stat the exact object generation.",
      );
    }
  }

  // Exact-generation streamed read. Always a full (non-range) read with
  // explicit SDK-native CRC32C validation - fail-closed transfer integrity
  // for the exact bytes of the exact pinned generation. Independent KAI
  // SHA-256 verification remains a separate, mandatory step performed by the
  // caller against the returned byte_source.
  async openExactGenerationReadStream({ objectKey, gcsGeneration, signal } = {}) {
    const guard = this._guardExactGenerationCall("open_exact_generation_read_stream", objectKey, gcsGeneration);
    if (guard) return guard;
    try {
      const file = this._bucket().file(objectKey, { generation: Number(gcsGeneration) });
      const [metadata] = await file.getMetadata();
      if (String(metadata.generation) !== gcsGeneration) {
        return sanitizedGcsFailure(
          "open_exact_generation_read_stream",
          "conflict",
          "Stored generation does not match the exact-generation binding.",
        );
      }
      const stream = file.createReadStream({ validation: "crc32c" });
      if (signal) {
        const abort = () => stream.destroy(new Error("aborted"));
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      }
      return {
        ok: true,
        data: {
          size_bytes: Number(metadata.size),
          byte_source: stream,
        },
      };
    } catch (error) {
      if (error?.code === 404) {
        return sanitizedGcsFailure(
          "open_exact_generation_read_stream",
          "not_found",
          "Exact object generation was not found.",
        );
      }
      return sanitizedGcsFailure(
        "open_exact_generation_read_stream",
        "system_error",
        "Unable to open the exact object generation read stream.",
      );
    }
  }
}

export function createGoogleCloudStorageProvider(options = {}) {
  return new GoogleCloudStorageProvider(options);
}
