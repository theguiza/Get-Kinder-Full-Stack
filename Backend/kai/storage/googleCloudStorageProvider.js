import { DisabledStorageProvider } from "./storageProvider.js";

export class GoogleCloudStorageProvider extends DisabledStorageProvider {
  constructor(options = {}) {
    super({ provider: "gcs", reason: "gcs_disabled_in_p0_pass1f", ...options });
  }
}

export function createGoogleCloudStorageProvider(options = {}) {
  return new GoogleCloudStorageProvider(options);
}
