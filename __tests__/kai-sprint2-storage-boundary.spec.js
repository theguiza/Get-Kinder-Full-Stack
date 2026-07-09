import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DISABLED_STORAGE_PROVIDER_CONTRACT,
  createDisabledStorageProvider,
  defaultStorageProvider,
} from "../Backend/kai/storage/storageProvider.js";
import { createGoogleCloudStorageProvider } from "../Backend/kai/storage/googleCloudStorageProvider.js";
import {
  storage_provider_disabled_in_p0,
  upload_url_request_blocked_in_p0,
} from "../Backend/kai/validators/storageValidators.js";

const storageProviderSource = readFileSync("Backend/kai/storage/storageProvider.js", "utf8");
const gcsProviderSource = readFileSync("Backend/kai/storage/googleCloudStorageProvider.js", "utf8");

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
