import { buildKaiError } from "../errors/kaiErrors.js";
import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";

export async function createDraftDataDictionary(dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  return buildKaiError("storage_provider_not_configured", {
    message: "Data dictionary creation is stubbed until deterministic profile facts are confirmed.",
  });
}
