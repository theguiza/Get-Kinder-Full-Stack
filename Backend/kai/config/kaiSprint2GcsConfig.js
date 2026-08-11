import { KAI_SPRINT2_MAX_FILE_SIZE_BYTES } from "./kaiSprint2P0Contract.js";
import { createGoogleCloudStorageProvider } from "../storage/googleCloudStorageProvider.js";
import {
  createImpersonatedStorageClientFactory,
  isUsableGcsTargetPrincipal,
} from "../storage/gcsImpersonatedStorageClientFactory.js";

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

function hasCompleteGateBGcsUploadSigningConfig(env = process.env) {
  const bucketName = env.KAI_GATE_B1_GCS_BUCKET_NAME;
  return (
    typeof bucketName === "string"
    && SAFE_BUCKET_NAME_PATTERN.test(bucketName)
    && isUsableGcsTargetPrincipal(env.KAI_GATE_B1_GCS_UPLOAD_SIGNER_TARGET_PRINCIPAL)
  );
}

// Missing or malformed configuration fails closed: returns { ok: false }
// rather than throwing, so a misconfigured environment never crashes
// request handling - it simply leaves the provider disabled.
export function readKaiGateC1GcsConfig(env = process.env) {
  const bucketName = env.KAI_GATE_C1_GCS_BUCKET_NAME || env.KAI_GATE_B1_GCS_BUCKET_NAME;
  if (typeof bucketName !== "string" || !SAFE_BUCKET_NAME_PATTERN.test(bucketName)) {
    return { ok: false, reason: "missing_or_malformed_bucket_name" };
  }
  return {
    ok: true,
    bucketName,
    uploadSigningTargetPrincipal: env.KAI_GATE_B1_GCS_UPLOAD_SIGNER_TARGET_PRINCIPAL || null,
    signedUploadExpirySeconds: KAI_GATE_C1_GCS_DEFAULTS.signedUploadExpirySeconds,
    maxUploadSizeBytes: KAI_GATE_C1_GCS_DEFAULTS.maxUploadSizeBytes,
  };
}

// A complete Gate B upload-signing contract is enough to enable the mounted
// Gate C provider; the C1 flag remains supported for the older C1-only config
// path, but production does not need a second enablement variable.
export function isKaiGateC1GcsProviderEnabled(env = process.env) {
  return isEnabledValue(env.KAI_GATE_C1_GCS_PROVIDER_ENABLED) || hasCompleteGateBGcsUploadSigningConfig(env);
}

export function createConfiguredGoogleCloudStorageProvider(env = process.env, {
  createStorageClientFactory = createImpersonatedStorageClientFactory,
} = {}) {
  const config = readKaiGateC1GcsConfig(env);
  if (!config.ok) {
    return createGoogleCloudStorageProvider({ enabled: false });
  }
  if (!isUsableGcsTargetPrincipal(config.uploadSigningTargetPrincipal)) {
    return createGoogleCloudStorageProvider({ enabled: false });
  }
  return createGoogleCloudStorageProvider({
    bucketName: config.bucketName,
    signedUploadExpirySeconds: config.signedUploadExpirySeconds,
    maxUploadSizeBytes: config.maxUploadSizeBytes,
    enabled: isKaiGateC1GcsProviderEnabled(env),
    storageClientFactory: createStorageClientFactory({
      targetPrincipal: config.uploadSigningTargetPrincipal,
    }),
  });
}
