// P3-19 export-manifest-foundation static contract constants. No DB access.

export const EXPORT_MANIFEST_FINGERPRINT_CONTRACT_VERSION = "kai-sprint2-p3-19-export-manifest-fingerprint-v1";
export const EXPORT_MANIFEST_CREATED_OPERATION = "export_manifest_created";
export const EXPORT_MANIFEST_AUDIT_CONTRACT = "p3_19_export_manifest_v1";
export const CREATE_EXPORT_MANIFEST_ALLOWED_ROLES = Object.freeze(new Set(["gk_admin"]));
export const CREATE_EXPORT_MANIFEST_OPERATION = "create_export_manifest";
export const EFFECTIVE_AUTHORITY_DECISION_TYPE = "export_authority_granted";
