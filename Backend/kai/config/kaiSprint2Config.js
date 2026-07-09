import { featureDisabled } from "../errors/kaiErrors.js";

export function isKaiSprint2Enabled(env = process.env) {
  const value = String(env.KAI_SPRINT2_ENABLED || "").trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes" || value === "on";
}

export function requireKaiSprint2Enabled(req, res, next) {
  if (isKaiSprint2Enabled()) return next();

  return res.status(403).json(featureDisabled({
    data: null,
    blockers: [],
    warnings: [],
  }));
}
