import { StorageAdapter } from "./storageAdapter.js";

export class LocalDevStorageAdapter extends StorageAdapter {
  constructor(options = {}) {
    super({ provider: "local_dev", ...options });
  }
}
