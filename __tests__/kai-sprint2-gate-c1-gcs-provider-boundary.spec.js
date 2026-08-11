import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";

import { createGoogleCloudStorageProvider } from "../Backend/kai/storage/googleCloudStorageProvider.js";
import {
  readKaiGateC1GcsConfig,
  isKaiGateC1GcsProviderEnabled,
  createConfiguredGoogleCloudStorageProvider,
} from "../Backend/kai/config/kaiSprint2GcsConfig.js";
import { KAI_SPRINT2_MAX_FILE_SIZE_BYTES } from "../Backend/kai/config/kaiSprint2P0Contract.js";

function createMockStorage(overrides = {}) {
  const calls = {
    bucketName: null,
    fileConstruct: [],
    sign: [],
    getMetadata: [],
    createReadStream: [],
  };
  const storage = {
    _kaiGcsSigningPrincipal: "gate-c1-test-signer@example.invalid",
    _kaiGcsSigner: {
      async sign(stringToSign) {
        calls.sign.push(stringToSign);
        if (overrides.sign) return overrides.sign(stringToSign);
        return { signedBlob: Buffer.from("mock-signature").toString("base64") };
      },
    },
    bucket(bucketName) {
      calls.bucketName = bucketName;
      return {
        file(objectKey, opts) {
          calls.fileConstruct.push({ objectKey, opts });
          return {
            async getMetadata() {
              calls.getMetadata.push(opts);
              if (overrides.getMetadata) return overrides.getMetadata(opts);
              return [{ generation: "1700000000000001", size: "12345" }];
            },
            createReadStream(options) {
              calls.createReadStream.push(options);
              if (overrides.createReadStream) return overrides.createReadStream(options);
              const stream = new PassThrough();
              process.nextTick(() => stream.end());
              return stream;
            },
          };
        },
      };
    },
  };
  return { storage, calls };
}

function enabledProvider(overrides = {}, providerOptions = {}) {
  const mock = createMockStorage(overrides);
  const provider = createGoogleCloudStorageProvider({
    bucketName: "kai-gate-c1-synthetic-bucket",
    enabled: true,
    maxUploadSizeBytes: KAI_SPRINT2_MAX_FILE_SIZE_BYTES,
    storageClientFactory: () => mock.storage,
    ...providerOptions,
  });
  return { provider, calls: mock.calls };
}

test("Gate C-1 provider is disabled by default and never constructs an SDK client", async () => {
  const provider = createGoogleCloudStorageProvider({
    storageClientFactory: () => {
      throw new Error("must not be constructed while disabled");
    },
  });
  assert.equal(provider.enabled, false);
  const result = await provider.createSignedUploadUrl({ objectKey: "k", contentType: "text/plain" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "operation_not_enabled");
});

test("Gate C-1 provider requires both an explicit enabled flag and a bucket name", () => {
  assert.equal(createGoogleCloudStorageProvider({ bucketName: "x" }).enabled, false);
  assert.equal(createGoogleCloudStorageProvider({ enabled: true }).enabled, false);
  assert.equal(createGoogleCloudStorageProvider({ enabled: true, bucketName: "x" }).enabled, true);
});

test("Gate C-1 config fails closed on missing or malformed bucket name", () => {
  assert.equal(readKaiGateC1GcsConfig({}).ok, false);
  assert.equal(readKaiGateC1GcsConfig({ KAI_GATE_C1_GCS_BUCKET_NAME: "UPPERCASE-NOT-ALLOWED" }).ok, false);
  assert.equal(readKaiGateC1GcsConfig({ KAI_GATE_C1_GCS_BUCKET_NAME: "../not-a-bucket" }).ok, false);
  const good = readKaiGateC1GcsConfig({ KAI_GATE_C1_GCS_BUCKET_NAME: "valid-bucket-name" });
  assert.equal(good.ok, true);
  assert.equal(good.bucketName, "valid-bucket-name");
});

test("Gate C-1 provider-selection seam stays dormant even with valid config unless separately enabled", () => {
  const env = {
    KAI_GATE_C1_GCS_BUCKET_NAME: "valid-bucket-name",
    KAI_GATE_B1_GCS_UPLOAD_SIGNER_TARGET_PRINCIPAL: "upload-signing@example.invalid",
  };
  assert.equal(isKaiGateC1GcsProviderEnabled(env), false);
  const provider = createConfiguredGoogleCloudStorageProvider(env);
  assert.equal(provider.enabled, false);

  const explicitlyEnabledEnv = { ...env, KAI_GATE_C1_GCS_PROVIDER_ENABLED: "true" };
  assert.equal(isKaiGateC1GcsProviderEnabled(explicitlyEnabledEnv), true);
  assert.equal(createConfiguredGoogleCloudStorageProvider(explicitlyEnabledEnv).enabled, true);
});

test("Gate C-1 runtime config reuses Gate B bucket and requires the Gate B upload-signing principal", () => {
  const env = {
    KAI_GATE_B1_GCS_BUCKET_NAME: "valid-gate-b-bucket",
  };
  const config = readKaiGateC1GcsConfig(env);
  assert.equal(config.ok, true);
  assert.equal(config.bucketName, "valid-gate-b-bucket");
  assert.equal(isKaiGateC1GcsProviderEnabled(env), false);

  const missingPrincipal = createConfiguredGoogleCloudStorageProvider(env);
  assert.equal(missingPrincipal.enabled, false);

  const gateBOnlyEnv = {
    ...env,
    KAI_GATE_B1_GCS_UPLOAD_SIGNER_TARGET_PRINCIPAL: "upload-signing@example.invalid",
  };
  assert.equal(gateBOnlyEnv.KAI_GATE_C1_GCS_PROVIDER_ENABLED, undefined);
  assert.equal(gateBOnlyEnv.KAI_GATE_C1_GCS_BUCKET_NAME, undefined);
  assert.equal(isKaiGateC1GcsProviderEnabled(gateBOnlyEnv), true);
  const enabled = createConfiguredGoogleCloudStorageProvider(gateBOnlyEnv);
  assert.equal(enabled.enabled, true);
});

test("Gate C-1 signed PUT construction includes every required signed header", async () => {
  const { provider, calls } = enabledProvider();
  const result = await provider.createSignedUploadUrl({
    objectKey: "kai/org/o1/intake/b1/f1/safe.pdf",
    contentType: "application/pdf",
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.method, "PUT");
  assert.equal(calls.sign.length, 1);
  assert.equal(result.data.headers["Content-Type"], "application/pdf");
  assert.equal(result.data.headers["x-goog-content-length-range"], `0,${KAI_SPRINT2_MAX_FILE_SIZE_BYTES}`);
  assert.equal(result.data.headers["x-goog-if-generation-match"], "0");
  assert.equal(typeof result.data.expires_in_seconds, "number");
  assert.ok(result.data.expires_in_seconds > 0 && result.data.expires_in_seconds <= 900);

  const url = new URL(result.data.url);
  assert.equal(url.searchParams.get("X-Goog-Algorithm"), "GOOG4-RSA-SHA256");
  assert.ok(url.searchParams.has("X-Goog-Signature"));
  const signedHeaders = new Set((url.searchParams.get("X-Goog-SignedHeaders") || "").split(";").filter(Boolean));
  for (const header of ["content-type", "host", "x-goog-content-length-range", "x-goog-if-generation-match"]) {
    assert.ok(signedHeaders.has(header), `${header} was not in V4 signed headers`);
  }
});

test("Gate C-1 signed PUT fails closed and sanitized when a signing context is unavailable", async () => {
  const provider = createGoogleCloudStorageProvider({
    bucketName: "kai-gate-c1-synthetic-bucket",
    enabled: true,
    maxUploadSizeBytes: KAI_SPRINT2_MAX_FILE_SIZE_BYTES,
    storageClientFactory: () => ({ bucket: () => ({ file: () => ({}) }) }),
  });
  const result = await provider.createSignedUploadUrl({
    objectKey: "kai/org/o1/intake/b1/f1/safe.pdf",
    contentType: "application/pdf",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "system_error");
  assert.equal(result.data.failure_phase, "resolve_signing_context");
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /kai-gate-c1-synthetic-bucket/);
  assert.doesNotMatch(serialized, /safe\.pdf/);
});

test("Gate C-1 signed PUT reports only a safe failure phase when signing fails", async () => {
  const { provider } = enabledProvider({
    sign() {
      throw new Error("raw iamcredentials.googleapis.com failure with secret principal");
    },
  });
  const result = await provider.createSignedUploadUrl({
    objectKey: "kai/org/o1/intake/b1/f1/private.pdf",
    contentType: "application/pdf",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "system_error");
  assert.equal(result.data.failure_phase, "sign_v4_string");
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /iamcredentials|secret principal|private\.pdf|kai-gate-c1-synthetic-bucket/);
});

test("Gate C-1 signed PUT fails closed without a configured upload-size bound", async () => {
  const { provider } = enabledProvider({}, { maxUploadSizeBytes: null });
  const result = await provider.createSignedUploadUrl({ objectKey: "k", contentType: "application/pdf" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "storage_provider_not_configured");
});

test("Gate C-1 signed PUT validates required inputs before calling the SDK", async () => {
  const { provider, calls } = enabledProvider();
  const missingKey = await provider.createSignedUploadUrl({ contentType: "application/pdf" });
  assert.equal(missingKey.error.code, "validation_blocker");
  const missingType = await provider.createSignedUploadUrl({ objectKey: "k" });
  assert.equal(missingType.error.code, "validation_blocker");
  assert.equal(calls.sign.length, 0);
});

test("Gate C-1 statExactGeneration pins the exact caller-supplied generation", async () => {
  const { provider, calls } = enabledProvider();
  const result = await provider.statExactGeneration({
    objectKey: "kai/org/o1/intake/b1/f1/safe.pdf",
    gcsGeneration: "1700000000000001",
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.size_bytes, 12345);
  assert.equal(calls.fileConstruct[0].opts.generation, 1700000000000001);
});

test("Gate C-1 statExactGeneration rejects a later/mismatched generation instead of silently resolving latest", async () => {
  const { provider } = enabledProvider({
    getMetadata: async () => [{ generation: "1700000000000099", size: "999" }],
  });
  const result = await provider.statExactGeneration({
    objectKey: "kai/org/o1/intake/b1/f1/safe.pdf",
    gcsGeneration: "1700000000000001",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict");
});

test("Gate C-1 statExactGeneration surfaces a sanitized not_found for a 404", async () => {
  const { provider } = enabledProvider({
    getMetadata: async () => {
      const error = new Error("real GCS message with bucket and object detail");
      error.code = 404;
      throw error;
    },
  });
  const result = await provider.statExactGeneration({
    objectKey: "kai/org/o1/intake/b1/f1/safe.pdf",
    gcsGeneration: "1700000000000001",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
  assert.doesNotMatch(JSON.stringify(result), /real GCS message/);
});

test("Gate C-1 exact-generation calls reject a malformed generation before any SDK call", async () => {
  const { provider, calls } = enabledProvider();
  for (const malformed of ["0", "-1", "abc", "", "01", "9007199254740993"]) {
    const result = await provider.statExactGeneration({ objectKey: "k", gcsGeneration: malformed });
    assert.equal(result.ok, false, `expected rejection for ${JSON.stringify(malformed)}`);
    assert.equal(result.error.code, "validation_blocker");
  }
  assert.equal(calls.fileConstruct.length, 0);
});

test("Gate C-1 openExactGenerationReadStream requests SDK-native CRC32C validation on every call", async () => {
  const { provider, calls } = enabledProvider();
  const result = await provider.openExactGenerationReadStream({
    objectKey: "kai/org/o1/intake/b1/f1/safe.pdf",
    gcsGeneration: "1700000000000001",
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.size_bytes, 12345);
  assert.equal(calls.createReadStream.length, 1);
  assert.equal(calls.createReadStream[0].validation, "crc32c");
});

test("Gate C-1 openExactGenerationReadStream never returns a stream when the generation does not match", async () => {
  const { provider, calls } = enabledProvider({
    getMetadata: async () => [{ generation: "1700000000000099", size: "999" }],
  });
  const result = await provider.openExactGenerationReadStream({
    objectKey: "kai/org/o1/intake/b1/f1/safe.pdf",
    gcsGeneration: "1700000000000001",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict");
  assert.equal(calls.createReadStream.length, 0);
});

test("Gate C-1 openExactGenerationReadStream destroys the stream when the caller's signal aborts", async () => {
  const { provider, calls } = enabledProvider({
    createReadStream: () => new PassThrough(),
  });
  const controller = new AbortController();
  const result = await provider.openExactGenerationReadStream({
    objectKey: "kai/org/o1/intake/b1/f1/safe.pdf",
    gcsGeneration: "1700000000000001",
    signal: controller.signal,
  });
  assert.equal(result.ok, true);
  result.data.byte_source.on("error", () => {});
  controller.abort();
  assert.equal(result.data.byte_source.destroyed, true);
  assert.equal(calls.createReadStream.length, 1);
});

test("Gate C-1 provider errors are sanitized: no bucket, object key, generation, or raw message leaks", async () => {
  const { provider } = enabledProvider({
    getMetadata: async () => {
      throw new Error("internal detail: bucket=kai-gate-c1-synthetic-bucket object=secret.pdf");
    },
  });
  const result = await provider.statExactGeneration({
    objectKey: "kai/org/o1/intake/b1/f1/secret.pdf",
    gcsGeneration: "1700000000000001",
  });
  assert.equal(result.ok, false);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /kai-gate-c1-synthetic-bucket/);
  assert.doesNotMatch(serialized, /secret\.pdf/);
  assert.doesNotMatch(serialized, /internal detail/);
  assert.deepEqual(Object.keys(result.data).sort(), ["contract", "operation", "provider"]);
});

test("Gate C-1 provider never touches SQL or a database client", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("Backend/kai/storage/googleCloudStorageProvider.js", "utf8");
  assert.doesNotMatch(source, /from\s+["'][^"']*(?:kaiDb|db\/pg|pg|kaiQueries|kaiIntakeQueries)\.js["']/);
  assert.doesNotMatch(source, /\bnew\s+Pool\b|\bpool\.query\b/);
});
