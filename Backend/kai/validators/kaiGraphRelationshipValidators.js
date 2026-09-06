const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const GRAPH_RELATIONSHIP_TYPES = Object.freeze([
  "claim_supported_by_evidence",
  "evidence_located_by_source_locator",
  "evidence_from_source_version",
  "source_version_of_source",
  "source_version_from_candidate",
  "candidate_governed_by_data_dictionary",
  "candidate_governed_by_sensitivity_profile",
  "evidence_review_queue",
  "claim_review_queue",
]);

const GRAPH_ENDPOINT_TYPES = new Set([
  "claim",
  "evidence_item",
  "source_locator",
  "source_version",
  "source",
  "intake_source_candidate",
  "data_dictionary",
  "intake_sensitivity_profile",
  "review_queue_item",
]);

const GRAPH_RELATIONSHIP_ENDPOINTS = Object.freeze({
  claim_supported_by_evidence: ["claim", "evidence_item"],
  evidence_located_by_source_locator: ["evidence_item", "source_locator"],
  evidence_from_source_version: ["evidence_item", "source_version"],
  source_version_of_source: ["source_version", "source"],
  source_version_from_candidate: ["source_version", "intake_source_candidate"],
  candidate_governed_by_data_dictionary: ["intake_source_candidate", "data_dictionary"],
  candidate_governed_by_sensitivity_profile: ["intake_source_candidate", "intake_sensitivity_profile"],
  evidence_review_queue: ["evidence_item", "review_queue_item"],
  claim_review_queue: ["claim", "review_queue_item"],
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonicalUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

function graphRelationship({
  relationshipType,
  fromObjectType,
  fromObjectId,
  toObjectType,
  toObjectId,
}) {
  return {
    relationship_type: relationshipType,
    from_object_type: fromObjectType,
    from_object_id: fromObjectId,
    to_object_type: toObjectType,
    to_object_id: toObjectId,
  };
}

export function composeClaimTraceabilityGraphRelationships({
  claimRow,
  claimEvidenceLinkRow,
  evidenceItemRow,
  locatorRow,
  sourceRow,
  sourceVersionRow,
  candidateRow,
  dictionaryRow,
  profileRow,
  evidenceReviewQueueItemRow,
  claimReviewQueueItemRow,
} = {}) {
  return [
    graphRelationship({
      relationshipType: "claim_supported_by_evidence",
      fromObjectType: "claim",
      fromObjectId: claimEvidenceLinkRow?.claim_id || claimRow?.claim_id,
      toObjectType: "evidence_item",
      toObjectId: claimEvidenceLinkRow?.evidence_item_id || evidenceItemRow?.evidence_item_id,
    }),
    graphRelationship({
      relationshipType: "evidence_located_by_source_locator",
      fromObjectType: "evidence_item",
      fromObjectId: evidenceItemRow?.evidence_item_id,
      toObjectType: "source_locator",
      toObjectId: locatorRow?.source_locator_id,
    }),
    graphRelationship({
      relationshipType: "evidence_from_source_version",
      fromObjectType: "evidence_item",
      fromObjectId: evidenceItemRow?.evidence_item_id,
      toObjectType: "source_version",
      toObjectId: sourceVersionRow?.source_version_id,
    }),
    graphRelationship({
      relationshipType: "source_version_of_source",
      fromObjectType: "source_version",
      fromObjectId: sourceVersionRow?.source_version_id,
      toObjectType: "source",
      toObjectId: sourceRow?.source_id,
    }),
    graphRelationship({
      relationshipType: "source_version_from_candidate",
      fromObjectType: "source_version",
      fromObjectId: sourceVersionRow?.source_version_id,
      toObjectType: "intake_source_candidate",
      toObjectId: candidateRow?.intake_source_candidate_id,
    }),
    graphRelationship({
      relationshipType: "candidate_governed_by_data_dictionary",
      fromObjectType: "intake_source_candidate",
      fromObjectId: candidateRow?.intake_source_candidate_id,
      toObjectType: "data_dictionary",
      toObjectId: dictionaryRow?.data_dictionary_id,
    }),
    graphRelationship({
      relationshipType: "candidate_governed_by_sensitivity_profile",
      fromObjectType: "intake_source_candidate",
      fromObjectId: candidateRow?.intake_source_candidate_id,
      toObjectType: "intake_sensitivity_profile",
      toObjectId: profileRow?.intake_sensitivity_profile_id,
    }),
    graphRelationship({
      relationshipType: "evidence_review_queue",
      fromObjectType: "evidence_item",
      fromObjectId: evidenceItemRow?.evidence_item_id,
      toObjectType: "review_queue_item",
      toObjectId: evidenceReviewQueueItemRow?.review_queue_item_id,
    }),
    graphRelationship({
      relationshipType: "claim_review_queue",
      fromObjectType: "claim",
      fromObjectId: claimRow?.claim_id,
      toObjectType: "review_queue_item",
      toObjectId: claimReviewQueueItemRow?.review_queue_item_id,
    }),
  ];
}

export function validateGraphRelationshipEndpoints(relationship) {
  if (!isPlainObject(relationship)) return false;
  const expected = GRAPH_RELATIONSHIP_ENDPOINTS[relationship.relationship_type];
  if (!expected) return false;
  return (
    relationship.from_object_type === expected[0] &&
    relationship.to_object_type === expected[1] &&
    GRAPH_ENDPOINT_TYPES.has(relationship.from_object_type) &&
    GRAPH_ENDPOINT_TYPES.has(relationship.to_object_type) &&
    canonicalUuid(relationship.from_object_id) &&
    canonicalUuid(relationship.to_object_id)
  );
}

export function validateGraphTraceCompleteness(relationships) {
  const invalidRelationshipCount = Array.isArray(relationships)
    ? relationships.filter((relationship) => !validateGraphRelationshipEndpoints(relationship)).length
    : 1;
  const presentTypes = new Set(
    Array.isArray(relationships)
      ? relationships
        .filter(validateGraphRelationshipEndpoints)
        .map((relationship) => relationship.relationship_type)
      : [],
  );
  const missingRelationshipTypes = GRAPH_RELATIONSHIP_TYPES.filter((type) => !presentTypes.has(type));
  return {
    complete: invalidRelationshipCount === 0 && missingRelationshipTypes.length === 0,
    missing_relationship_types: missingRelationshipTypes,
    invalid_relationship_count: invalidRelationshipCount,
  };
}

export const __graphRelationshipContract = Object.freeze({
  GRAPH_RELATIONSHIP_TYPES,
  GRAPH_RELATIONSHIP_ENDPOINTS,
});
