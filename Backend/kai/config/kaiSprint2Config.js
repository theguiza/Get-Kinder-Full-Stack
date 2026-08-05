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

/**
 * KAI_SOURCE_PROMOTION_ENABLED (P1-08 owner decision): added here with default
 * false (any unset/non-truthy value returns false via isEnabledValue), following
 * the exact `isKaiFileUploadEnabled`/`areKaiSprint2UploadFeaturesEnabled`
 * composition idiom already established in this file. Neither flag is enabled by
 * this package.
 */
export function isKaiSourcePromotionEnabled(env = process.env) {
  return isEnabledValue(env.KAI_SOURCE_PROMOTION_ENABLED);
}

export function areKaiSprint2SourcePromotionFeaturesEnabled(env = process.env) {
  return isKaiSprint2Enabled(env) && isKaiSourcePromotionEnabled(env);
}

/**
 * KAI_EVIDENCE_LINEAGE_ENABLED (P2-01 owner decision): added here with default
 * false (any unset/non-truthy value returns false via isEnabledValue), following
 * the exact `isKaiSourcePromotionEnabled`/`areKaiSprint2SourcePromotionFeaturesEnabled`
 * composition idiom already established in this file. Neither flag is enabled by
 * this package.
 */
export function isKaiEvidenceLineageEnabled(env = process.env) {
  return isEnabledValue(env.KAI_EVIDENCE_LINEAGE_ENABLED);
}

export function areKaiSprint2EvidenceLineageFeaturesEnabled(env = process.env) {
  return isKaiSprint2Enabled(env) && isKaiEvidenceLineageEnabled(env);
}

export function requireKaiSprint2Enabled(req, res, next) {
  if (isKaiSprint2Enabled()) return next();

  return res.status(403).json(featureDisabled({
    data: null,
    blockers: [],
    warnings: [],
  }));
}
