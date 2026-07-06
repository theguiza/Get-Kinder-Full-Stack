import { buildKaiError } from "../errors/kaiErrors.js";
import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";

export async function requestUploadUrl(dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  return buildKaiError("storage_provider_not_configured");
}

export async function requestReadUrl(dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  return buildKaiError("storage_provider_not_configured");
}
