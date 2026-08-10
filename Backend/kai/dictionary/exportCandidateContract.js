export const LIMITATION_SNAPSHOT_ALLOWED_ROLES = Object.freeze(["gk_reviewer", "gk_admin"]);
export const EXPORT_CANDIDATE_ALLOWED_ROLES = Object.freeze(["gk_admin"]);

export const LIMITATION_CODE_PATTERN = /^[a-z][a-z0-9_.:-]{0,95}$/;
export const LIMITATION_CODES_MAX_COUNT = 32;

export const EXPORT_CANDIDATE_CONTENT_TYPE = "evidence_summary";
export const EXPORT_CANDIDATE_AUDIENCES = Object.freeze(["internal", "funder", "public"]);
export const EXPORT_CANDIDATE_FINGERPRINT_CONTRACT_VERSION = "kai-sprint2-p3-16-export-candidate-fingerprint-v1";

export const LIMITATION_SNAPSHOT_AUDIT_OPERATION = "limitation_snapshot_confirmed";
export const LIMITATION_SNAPSHOT_AUDIT_CONTRACT = "p3_16_limitation_snapshot_v1";

export const EXPORT_CANDIDATE_AUDIT_OPERATION = "export_candidate_created";
export const EXPORT_CANDIDATE_AUDIT_CONTRACT = "p3_16_export_candidate_v1";

export function isLimitationCodeSet(codes) {
  if (!Array.isArray(codes)) return false;
  if (codes.length > LIMITATION_CODES_MAX_COUNT) return false;
  if (!codes.every((code) => typeof code === "string" && LIMITATION_CODE_PATTERN.test(code))) return false;
  return codes.length === new Set(codes).size;
}
