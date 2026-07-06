import { buildKaiError } from "../errors/kaiErrors.js";
import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";

export async function queueParserProfileJob(dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  return buildKaiError("storage_provider_not_configured", {
    message: "Parser jobs are disabled for KAI Sprint 2 P0 Pass 1.",
  });
}
