import { KAI_SPRINT2_MAX_FILE_SIZE_BYTES } from "./kaiSprint2P0Contract.js";
import { createGoogleCloudStorageProvider } from "../storage/googleCloudStorageProvider.js";

// Gate C-1: smallest non-secret configuration-key definitions and a dormant
// provider-selection/factory seam. Nothing in this file enables the GCS
// provider for the running application - it only ever returns a provider
// object; selecting that object as the application's active storage adapter
// remains explicitly out of scope for this package.
export const KAI_GATE_C1_GCS_DEFAULTS = Object.freeze({
  signedUploadExpirySeconds: 15 * 60,
  maxUploadSizeBytes: KAI_SPRINT2_MAX_FILE_SIZE_BYTES,
});

const SAFE_BUCKET_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/;

function isEnabledValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
}

// Missing or malformed configuration fails closed: returns { ok: false }
// rather than throwing, so a misconfigured environment never crashes
// request handling - it simply leaves the provider disabled.
export function readKaiGateC1GcsConfig(env = process.env) {
  const bucketName = env.KAI_GATE_C1_GCS_BUCKET_NAME;
  if (typeof bucketName !== "string" || !SAFE_BUCKET_NAME_PATTERN.test(bucketName)) {
    return { ok: false, reason: "missing_or_malformed_bucket_name" };
  }
  return {
    ok: true,
    bucketName,
    signedUploadExpirySeconds: KAI_GATE_C1_GCS_DEFAULTS.signedUploadExpirySeconds,
    maxUploadSizeBytes: KAI_GATE_C1_GCS_DEFAULTS.maxUploadSizeBytes,
  };
}

// KAI_GATE_C1_GCS_PROVIDER_ENABLED is a second, independent gate on top of
// configuration validity - this package sets no default that turns it on,
// and nothing in this repository's startup composition reads this factory.
export function isKaiGateC1GcsProviderEnabled(env = process.env) {
  return isEnabledValue(env.KAI_GATE_C1_GCS_PROVIDER_ENABLED);
}

export function createConfiguredGoogleCloudStorageProvider(env = process.env) {
  const config = readKaiGateC1GcsConfig(env);
  if (!config.ok) {
    return createGoogleCloudStorageProvider({ enabled: false });
  }
  return createGoogleCloudStorageProvider({
    ...config,
    enabled: isKaiGateC1GcsProviderEnabled(env),
  });
}
