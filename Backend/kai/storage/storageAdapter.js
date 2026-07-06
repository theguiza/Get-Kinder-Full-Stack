export class StorageAdapter {
  constructor({ provider = "unconfigured" } = {}) {
    this.provider = provider;
  }

  async requestUploadUrl() {
    return {
      ok: false,
      error_code: "storage_provider_not_configured",
      message: "Live raw-file upload is disabled for KAI Sprint 2 P0 Pass 1.",
    };
  }

  async requestReadUrl() {
    return {
      ok: false,
      error_code: "storage_provider_not_configured",
      message: "Signed read URLs are disabled for KAI Sprint 2 P0 Pass 1.",
    };
  }
}
