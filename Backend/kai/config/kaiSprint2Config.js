import { featureDisabled } from "../errors/kaiErrors.js";

function isEnabledValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
}

export function isKaiSprint2Enabled(env = process.env) {
  return isEnabledValue(env.KAI_SPRINT2_ENABLED);
}

export function isKaiFileUploadEnabled(env = process.env) {
  return isEnabledValue(env.KAI_FILE_UPLOAD_ENABLED);
}

export function areKaiSprint2UploadFeaturesEnabled(env = process.env) {
  return isKaiSprint2Enabled(env) && isKaiFileUploadEnabled(env);
}

export function requireKaiSprint2Enabled(req, res, next) {
  if (isKaiSprint2Enabled()) return next();

  return res.status(403).json(featureDisabled({
    data: null,
    blockers: [],
    warnings: [],
  }));
}
