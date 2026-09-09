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

// P14-05 packet export-review binding: this is the exact static
// review_queue_items row shape the P14-05 migration's widened
// review_queue_items_p14_05_export_review_contract_check admits for
// target_object_type = 'grant_response_packet_export_candidate' - the
// packet-level analogue of the existing single-draft
// EXPORT_REVIEW_QUEUE_STATIC_CONTRACT (exportReviewQueueContract.js). Reuses
// the one existing 'export_review' queue_type and its one existing
// open/needs_gk_review -> in_progress/needs_gk_review ->
// resolved/resolved lifecycle - never a new queue_type or a parallel
// lifecycle.
export const GRANT_RESPONSE_PACKET_EXPORT_REVIEW_QUEUE_STATIC_CONTRACT = Object.freeze({
  queueType: "export_review",
  targetObjectType: "grant_response_packet_export_candidate",
  priority: "medium",
  summary: "Grant Response Packet export candidate requires export review.",
  requiredAction: "Review packet membership, funder audience, and export authority before any export.",
  assignedTo: null,
  dueAt: null,
  createdByType: "system",
});

export const GRANT_RESPONSE_PACKET_EXPORT_REVIEW_REQUESTED_OPERATION =
  "grant_response_packet_export_review_requested";

export const GRANT_RESPONSE_PACKET_EXPORT_REVIEW_AUDIT_CONTRACT =
  "p14_05_grant_response_packet_export_review_v1";
