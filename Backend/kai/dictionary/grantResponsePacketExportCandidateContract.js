// P14-03 grant-response-packet-export-candidate-foundation static contract
// constants. No DB access. Mirrors the P3-16/P3-19 contract-file convention
// (see exportCandidateContract.js / exportManifestContract.js) - one small,
// dependency-free module of names and versions shared by the repository, the
// fingerprint composer, and the metadata-only audit adapter, so none of them
// hardcode a string the others must independently agree with.

export const GRANT_RESPONSE_PACKET_AUDIENCE = "funder";

export const GRANT_RESPONSE_PACKET_EXPORT_CANDIDATE_FINGERPRINT_CONTRACT_VERSION =
  "kai-sprint2-p14-03-grant-response-packet-export-candidate-fingerprint-v1";

export const GRANT_RESPONSE_PACKET_EXPORT_CANDIDATE_CREATED_OPERATION =
  "grant_response_packet_export_candidate_created";

export const GRANT_RESPONSE_PACKET_EXPORT_CANDIDATE_AUDIT_CONTRACT =
  "p14_03_grant_response_packet_export_candidate_v1";
