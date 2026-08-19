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

export function isKaiGenerationEnabled(env = process.env) {
  return isEnabledValue(env.KAI_GENERATION_ENABLED);
}

export function areKaiSprint2GenerationFeaturesEnabled(env = process.env) {
  return isKaiSprint2Enabled(env) && isKaiGenerationEnabled(env);
}

export function isKaiPublicExportEnabled(env = process.env) {
  return isEnabledValue(env.KAI_PUBLIC_EXPORT_ENABLED);
}

export function areKaiSprint2PublicExportFeaturesEnabled(env = process.env) {
  return isKaiSprint2Enabled(env) && isKaiGenerationEnabled(env) && isKaiPublicExportEnabled(env);
}

/**
 * KAI_WORKER_ENABLED (P1 runtime composition): added here with default false
 * (any unset/non-truthy value returns false via isEnabledValue), following the
 * exact `isKaiFileUploadEnabled`/`areKaiSprint2UploadFeaturesEnabled`
 * composition idiom already established in this file. Does not change any
 * existing flag's default.
 */
export function isKaiWorkerEnabled(env = process.env) {
  return isEnabledValue(env.KAI_WORKER_ENABLED);
}

export function areKaiSprint2WorkerFeaturesEnabled(env = process.env) {
  return isKaiSprint2Enabled(env) && isKaiWorkerEnabled(env);
}

/**
 * KAI_P1_WORKER_SYNTHETIC_ORGANIZATION_ID: the smallest explicit
 * tenant/organization-scoped configuration for the P1 worker's first
 * synthetic-only production execution. Fails closed (returns null) when
 * absent, blank, or padded with whitespace: absence of this configuration
 * means the worker never sweeps any organization.
 */
export function getKaiP1WorkerSyntheticOrganizationId(env = process.env) {
  const value = env.KAI_P1_WORKER_SYNTHETIC_ORGANIZATION_ID;
  return typeof value === "string" && value.length > 0 && value === value.trim()
    ? value
    : null;
}

export function requireKaiSprint2Enabled(req, res, next) {
  if (isKaiSprint2Enabled()) return next();

  return res.status(403).json(featureDisabled({
    data: null,
    blockers: [],
    warnings: [],
  }));
}
