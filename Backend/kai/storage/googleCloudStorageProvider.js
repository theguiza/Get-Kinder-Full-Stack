import { StorageAdapter } from "./storageAdapter.js";

export class GoogleCloudStorageProvider extends StorageAdapter {
  constructor(options = {}) {
    super({ provider: "gcs", ...options });
  }
}

export function createGoogleCloudStorageProvider(options = {}) {
  return new GoogleCloudStorageProvider(options);
}
