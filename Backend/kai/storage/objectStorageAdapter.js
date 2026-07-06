import { StorageAdapter } from "./storageAdapter.js";

export class ObjectStorageAdapter extends StorageAdapter {
  constructor(options = {}) {
    super({ provider: options.provider || "object_storage_stub" });
  }
}
