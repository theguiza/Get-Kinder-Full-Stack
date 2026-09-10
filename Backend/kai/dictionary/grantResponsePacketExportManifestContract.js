// P14-08A grant-response-packet-export-manifest-foundation static contract
// constants. No DB access.

export const GRANT_RESPONSE_PACKET_EXPORT_MANIFEST_FINGERPRINT_CONTRACT_VERSION =
  "kai-sprint2-p14-08a-grant-response-packet-export-manifest-fingerprint-v1";
export const GRANT_RESPONSE_PACKET_EXPORT_MANIFEST_CREATED_OPERATION =
  "grant_response_packet_export_manifest_created";
export const GRANT_RESPONSE_PACKET_EXPORT_MANIFEST_AUDIT_CONTRACT = "p14_08a_grant_response_packet_export_manifest_v1";
export const CREATE_GRANT_RESPONSE_PACKET_EXPORT_MANIFEST_ALLOWED_ROLES = Object.freeze(new Set(["gk_admin"]));
export const CREATE_GRANT_RESPONSE_PACKET_EXPORT_MANIFEST_OPERATION = "create_grant_response_packet_export_manifest";
export const GRANT_RESPONSE_PACKET_EXPORT_MANIFEST_EFFECTIVE_AUTHORITY_DECISION_TYPE = "export_authority_granted";
