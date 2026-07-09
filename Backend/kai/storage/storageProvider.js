import { buildKaiError } from "../errors/kaiErrors.js";

export const DISABLED_STORAGE_PROVIDER_CONTRACT = "p0_pass1f_disabled_storage_provider_boundary";

function disabledStorageData(operation, provider) {
  return {
    operation,
    provider,
    contract: DISABLED_STORAGE_PROVIDER_CONTRACT,
    storage_provider_enabled: false,
    raw_upload_enabled: false,
    signed_upload_enabled: false,
    signed_read_enabled: false,
    upload_confirmation_enabled: false,
  };
}

export class DisabledStorageProvider {
  constructor({ provider = "disabled", reason = "storage_disabled_in_p0_pass1f" } = {}) {
    this.provider = provider;
    this.enabled = false;
    this.reason = reason;
  }

  blocked(operation) {
    return buildKaiError("operation_not_enabled", {
      message: "KAI Sprint 2 storage operations are disabled for P0 Pass 1F.",
      data: disabledStorageData(operation, this.provider),
    });
  }

  async requestUploadUrl() {
    return this.blocked("request_upload_url");
  }

  async requestReadUrl() {
    return this.blocked("request_read_url");
  }

  async confirmUpload() {
    return this.blocked("confirm_upload");
  }

  async uploadFile() {
    return this.blocked("upload_file");
  }

  async downloadFile() {
    return this.blocked("download_file");
  }

  async deleteFile() {
    return this.blocked("delete_file");
  }
}

export function createDisabledStorageProvider(options = {}) {
  return new DisabledStorageProvider(options);
}

export const defaultStorageProvider = createDisabledStorageProvider();
