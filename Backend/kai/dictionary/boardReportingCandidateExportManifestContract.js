// Board Reporting candidate export-manifest-foundation static contract
// constants. No DB access. The Board-scoped analogue of the existing P3-19
// exportManifestContract.js (member-level) and P14-08A
// grantResponsePacketExportManifestContract.js (packet-level) - same shape,
// bound instead to kai.board_reporting_candidate_export_manifests.

export const BOARD_REPORTING_CANDIDATE_EXPORT_MANIFEST_FINGERPRINT_CONTRACT_VERSION =
  "kai-sprint2-board-reporting-candidate-export-manifest-fingerprint-v1";
export const BOARD_REPORTING_CANDIDATE_EXPORT_MANIFEST_CREATED_OPERATION =
  "board_reporting_candidate_export_manifest_created";
export const BOARD_REPORTING_CANDIDATE_EXPORT_MANIFEST_AUDIT_CONTRACT =
  "board_reporting_candidate_export_manifest_v1";
export const CREATE_BOARD_REPORTING_CANDIDATE_EXPORT_MANIFEST_ALLOWED_ROLES = Object.freeze(new Set(["gk_admin"]));
export const CREATE_BOARD_REPORTING_CANDIDATE_EXPORT_MANIFEST_OPERATION =
  "create_board_reporting_candidate_export_manifest";
export const BOARD_REPORTING_CANDIDATE_EXPORT_MANIFEST_EFFECTIVE_AUTHORITY_DECISION_TYPE = "export_authority_granted";
