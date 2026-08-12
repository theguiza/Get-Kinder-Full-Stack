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
const SOURCE_CREDENTIAL_UNAVAILABLE_MESSAGES = new Set([
  "Could not load the default credentials. Browse to https://cloud.google.com/docs/authentication/getting-started for more information.",
  "Unable to find credentials in current environment. \nTo learn more about authentication and Google APIs, visit: \nhttps://cloud.google.com/docs/authentication/getting-started",
]);
const SAFE_DIAGNOSTIC_CODES = new Set([
  "source_credentials_unavailable",
  "source_credentials_rejected",
  "signing_unauthenticated",
  "signing_permission_denied",
  "signing_target_not_found",
  "provider_unavailable_rate_limited",
  "unclassified_signing_failure",
]);

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

function sanitizedGcsFailure(operation, code, message, data = {}) {
  return buildKaiError(code, {
    message,
    data: {
      operation,
      provider: "gcs",
      contract: GCS_PROVIDER_CONTRACT,
      ...data,
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

function providerStatus(error) {
  const value = error?.response?.data?.error?.status || error?.status;
  return typeof value === "string" && /^[A-Z_]{1,64}$/.test(value) ? value : null;
}

function providerHttpStatus(error) {
  for (const value of [error?.response?.status, error?.status, error?.code, error?.response?.data?.error?.code]) {
    if (Number.isSafeInteger(value) && value >= 100 && value <= 599) return value;
  }
  return null;
}

function diagnosticCodeForProviderError(error, failurePhase) {
  const explicitCode = error?._kaiGcsDiagnostic?.diagnostic_code;
  if (SAFE_DIAGNOSTIC_CODES.has(explicitCode)) return explicitCode;
  if (SOURCE_CREDENTIAL_UNAVAILABLE_MESSAGES.has(error?.message)) return "source_credentials_unavailable";

  const status = providerStatus(error);
  const httpStatus = providerHttpStatus(error);
  if (status === "UNAVAILABLE" || status === "RESOURCE_EXHAUSTED" || [429, 500, 502, 503, 504].includes(httpStatus)) {
    return "provider_unavailable_rate_limited";
  }
  if (failurePhase === "initialize_storage_client") {
    if (status === "UNAUTHENTICATED" || status === "PERMISSION_DENIED" || httpStatus === 401 || httpStatus === 403) {
      return "source_credentials_rejected";
    }
    return "unclassified_signing_failure";
  }
  if (status === "UNAUTHENTICATED" || httpStatus === 401) return "signing_unauthenticated";
  if (status === "PERMISSION_DENIED" || httpStatus === 403) return "signing_permission_denied";
  if (status === "NOT_FOUND" || httpStatus === 404) return "signing_target_not_found";
  return "unclassified_signing_failure";
}

function gcsFailureDiagnostic(error, failurePhase) {
  const data = {
    failure_phase: failurePhase,
    diagnostic_code: diagnosticCodeForProviderError(error, failurePhase),
  };
  const httpStatus = error?._kaiGcsDiagnostic?.provider_http_status || providerHttpStatus(error);
  const status = error?._kaiGcsDiagnostic?.provider_status || providerStatus(error);
  if (Number.isSafeInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599) {
    data.provider_http_status = httpStatus;
  }
  if (typeof status === "string" && /^[A-Z_]{1,64}$/.test(status)) {
    data.provider_status = status;
  }
  return data;
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

  async _ensureClient() {
    if (!this._client) {
      // Application Default Credentials only: no keyFilename, no embedded
      // key material. storageClientFactory lets tests and runtime composition
      // inject an already-authorized SDK client without changing provider
      // behavior.
      this._client = this._storageClientFactory
        ? await this._storageClientFactory()
        : new Storage(this._projectId ? { projectId: this._projectId } : {});
    }
    return this._client;
  }

  async _bucket() {
    return (await this._ensureClient()).bucket(this.bucketName);
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
    let failurePhase = "initialize_storage_client";
    try {
      const storageClient = await this._ensureClient();
      failurePhase = "resolve_signing_context";
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
      failurePhase = "sign_v4_string";
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
    } catch (error) {
      return sanitizedGcsFailure(
        "create_signed_upload_url",
        "system_error",
        "Unable to create a signed upload URL.",
        gcsFailureDiagnostic(error, failurePhase),
      );
    }
  }

  // Gate C-2A: metadata discovery only. Resolves to whatever generation is
  // currently live at objectKey - never pinned, never authoritative on its
  // own. The caller MUST immediately re-verify the returned candidate
  // generation through statExactGeneration/openExactGenerationReadStream
  // before treating it as the confirmed object.
  async headObject({ objectKey } = {}) {
    const guard = this._guardEnabledAndObjectKey("head_object", objectKey);
    if (guard) return guard;
    try {
      const file = (await this._bucket()).file(objectKey);
      const [metadata] = await file.getMetadata();
      const candidateGeneration = String(metadata?.generation ?? "");
      if (!isPrecisionSafeGcsGeneration(candidateGeneration)) {
        return sanitizedGcsFailure("head_object", "system_error", "Object metadata generation was not usable.");
      }
      const sizeBytes = Number(metadata.size);
      if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
        return sanitizedGcsFailure("head_object", "system_error", "Object metadata size was not usable.");
      }
      return {
        ok: true,
        data: {
          candidate_generation: candidateGeneration,
          size_bytes: sizeBytes,
        },
      };
    } catch (error) {
      if (error?.code === 404) {
        return sanitizedGcsFailure("head_object", "not_found", "Object was not found at the trusted key.");
      }
      return sanitizedGcsFailure("head_object", "system_error", "Unable to head the object.");
    }
  }

  // Exact-generation stat: pins the File to the caller-supplied generation
  // and never resolves "latest." A mismatched/later generation is a 404 to
  // GCS, not a silent fallback.
  async statExactGeneration({ objectKey, gcsGeneration } = {}) {
    const guard = this._guardExactGenerationCall("stat_exact_generation", objectKey, gcsGeneration);
    if (guard) return guard;
    try {
      const file = (await this._bucket()).file(objectKey, { generation: Number(gcsGeneration) });
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
      const file = (await this._bucket()).file(objectKey, { generation: Number(gcsGeneration) });
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
