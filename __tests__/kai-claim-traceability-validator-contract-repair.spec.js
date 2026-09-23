import test from "node:test";
import assert from "node:assert/strict";

import { __generatedContentRepositoryTestables } from "../Backend/kai/dictionary/postgresGeneratedContentRepository.js";

const { validateTraceabilityData } = __generatedContentRepositoryTestables;

const CLAIM = "00000000-0000-4000-8000-000000000101";
const EVIDENCE = "00000000-0000-4000-8000-000000000201";
const SOURCE = "00000000-0000-4000-8000-000000000401";
const SOURCE_VERSION = "00000000-0000-4000-8000-000000000501";
const LOCATOR = "00000000-0000-4000-8000-000000000601";
const CANDIDATE = "00000000-0000-4000-8000-000000000701";
const PROFILE = "00000000-0000-4000-8000-000000000702";
const PROMOTION_DECISION = "00000000-0000-4000-8000-000000000801";
const CLAIM_REVIEW_QUEUE = "00000000-0000-4000-8000-000000000901";
const EVIDENCE_REVIEW_QUEUE = "00000000-0000-4000-8000-000000000902";
const EVIDENCE_REVIEW_DECISION = "00000000-0000-4000-8000-000000001001";
const CLAIM_REVIEW_DECISION = "00000000-0000-4000-8000-000000001002";

function validGraphRelationships() {
  return [
    { relationship_type: "claim_supported_by_evidence", from_object_type: "claim", from_object_id: CLAIM, to_object_type: "evidence_item", to_object_id: EVIDENCE },
    { relationship_type: "evidence_located_by_source_locator", from_object_type: "evidence_item", from_object_id: EVIDENCE, to_object_type: "source_locator", to_object_id: LOCATOR },
    { relationship_type: "evidence_from_source_version", from_object_type: "evidence_item", from_object_id: EVIDENCE, to_object_type: "source_version", to_object_id: SOURCE_VERSION },
    { relationship_type: "source_version_of_source", from_object_type: "source_version", from_object_id: SOURCE_VERSION, to_object_type: "source", to_object_id: SOURCE },
    { relationship_type: "source_version_from_candidate", from_object_type: "source_version", from_object_id: SOURCE_VERSION, to_object_type: "intake_source_candidate", to_object_id: CANDIDATE },
    { relationship_type: "candidate_governed_by_data_dictionary", from_object_type: "intake_source_candidate", from_object_id: CANDIDATE, to_object_type: "data_dictionary", to_object_id: PROFILE },
    { relationship_type: "candidate_governed_by_sensitivity_profile", from_object_type: "intake_source_candidate", from_object_id: CANDIDATE, to_object_type: "intake_sensitivity_profile", to_object_id: PROFILE },
    { relationship_type: "evidence_review_queue", from_object_type: "evidence_item", from_object_id: EVIDENCE, to_object_type: "review_queue_item", to_object_id: EVIDENCE_REVIEW_QUEUE },
    { relationship_type: "claim_review_queue", from_object_type: "claim", from_object_id: CLAIM, to_object_type: "review_queue_item", to_object_id: CLAIM_REVIEW_QUEUE },
  ];
}

function validTraceabilityDto(overrides = {}) {
  return {
    claim: {
      claim_id: CLAIM,
      claim_type: "quantitative",
      claim_status: "active",
      claim_review_status: "resolved",
      claim_strength: "reviewed_supported",
      statement: "Claim statement accepted by the traceability contract.",
      audience_gates: {
        internal_only: false,
        public_use_allowed: false,
        funder_use_allowed: true,
        export_ready: true,
      },
    },
    evidence: {
      evidence_item_id: EVIDENCE,
      evidence_review_status: "resolved",
      support_strength: "reviewed_supported",
      review_queue_item_id: EVIDENCE_REVIEW_QUEUE,
      review_queue_status: "resolved",
      review_status: "resolved",
      updated_at: "2026-08-06T09:00:00.000Z",
      sensitivity_level: "unknown",
      statement: "Evidence statement accepted by the traceability contract.",
    },
    locator: { source_locator_id: LOCATOR },
    source: { source_id: SOURCE, source_code: "SRC-1" },
    source_version: { source_version_id: SOURCE_VERSION, is_current: true },
    claim_review: {
      review_queue_item_id: CLAIM_REVIEW_QUEUE,
      queue_status: "resolved",
      review_status: "resolved",
      updated_at: "2026-08-06T09:00:00.000Z",
    },
    evidence_review_decision: {
      decision_id: EVIDENCE_REVIEW_DECISION,
      decision_outcome: "accepted",
    },
    claim_review_decision: {
      decision_id: CLAIM_REVIEW_DECISION,
      decision_outcome: "accepted",
      approved_audiences: ["internal", "funder"],
    },
    candidate: {
      intake_source_candidate_id: CANDIDATE,
      intake_sensitivity_profile_id: PROFILE,
    },
    promotion_decision: { intake_promotion_decision_id: PROMOTION_DECISION },
    dimensions: {},
    gap_items: [],
    client_followup_workflows: [],
    potential_conflict_groups: [],
    graph_relationships: validGraphRelationships(),
    graph_trace_completeness: {
      complete: true,
      missing_relationship_types: [],
      invalid_relationship_count: 0,
    },
    requestedAudience: "funder",
    eligible: true,
    blockerCodes: [],
    affectedDimensionKeys: [],
    affectedObjectIds: [],
    truncated: false,
    ...overrides,
  };
}

test("validateTraceabilityData accepts the current authoritative evaluator DTO shape", () => {
  const dto = validTraceabilityDto();
  assert.equal(validateTraceabilityData(dto, { claimId: CLAIM, requestedAudience: "funder" }), true);
});

test("validateTraceabilityData accepts governed claim/evidence statement fields from the current evaluator", () => {
  const dto = validTraceabilityDto({
    claim: {
      ...validTraceabilityDto().claim,
      statement: "Board reporting should not reject this claim text.",
    },
    evidence: {
      ...validTraceabilityDto().evidence,
      statement: "Board reporting should not reject this evidence text.",
    },
  });
  assert.equal(validateTraceabilityData(dto, { claimId: CLAIM, requestedAudience: "funder" }), true);
});

test("validateTraceabilityData rejects malformed governed statement fields when present", () => {
  const malformedClaimStatement = validTraceabilityDto({
    claim: { ...validTraceabilityDto().claim, statement: "" },
  });
  assert.equal(validateTraceabilityData(malformedClaimStatement, { claimId: CLAIM, requestedAudience: "funder" }), false);

  const malformedEvidenceStatement = validTraceabilityDto({
    evidence: { ...validTraceabilityDto().evidence, statement: "x".repeat(501) },
  });
  assert.equal(validateTraceabilityData(malformedEvidenceStatement, { claimId: CLAIM, requestedAudience: "funder" }), false);
});

test("validateTraceabilityData accepts null decision fields and an incomplete graph_trace_completeness", () => {
  const dto = validTraceabilityDto({
    evidence_review_decision: null,
    claim_review_decision: null,
    graph_trace_completeness: {
      complete: false,
      missing_relationship_types: ["claim_review_queue"],
      invalid_relationship_count: 1,
    },
  });
  assert.equal(validateTraceabilityData(dto, { claimId: CLAIM, requestedAudience: "funder" }), true);
});

test("validateTraceabilityData rejects a malformed claim_review_decision (non-UUID decision_id)", () => {
  const dto = validTraceabilityDto({
    claim_review_decision: {
      decision_id: "not-a-uuid",
      decision_outcome: "accepted",
      approved_audiences: ["internal"],
    },
  });
  assert.equal(validateTraceabilityData(dto, { claimId: CLAIM, requestedAudience: "funder" }), false);
});

test("validateTraceabilityData rejects a malformed graph_relationships entry (missing endpoint id)", () => {
  const relationships = validGraphRelationships();
  relationships[0] = { ...relationships[0], to_object_id: null };
  const dto = validTraceabilityDto({ graph_relationships: relationships });
  assert.equal(validateTraceabilityData(dto, { claimId: CLAIM, requestedAudience: "funder" }), false);
});

test("validateTraceabilityData rejects a malformed graph_trace_completeness (wrong types)", () => {
  const dto = validTraceabilityDto({
    graph_trace_completeness: {
      complete: "true",
      missing_relationship_types: [],
      invalid_relationship_count: 0,
    },
  });
  assert.equal(validateTraceabilityData(dto, { claimId: CLAIM, requestedAudience: "funder" }), false);
});

test("validateTraceabilityData rejects an unexpected root field even when all legitimate fields are present", () => {
  const dto = validTraceabilityDto({ unexpected_extra_field: "surprise" });
  assert.equal(validateTraceabilityData(dto, { claimId: CLAIM, requestedAudience: "funder" }), false);
});

test("validateTraceabilityData rejects a DTO missing one of the four newly-legitimate root fields", () => {
  const dto = validTraceabilityDto();
  delete dto.graph_relationships;
  assert.equal(validateTraceabilityData(dto, { claimId: CLAIM, requestedAudience: "funder" }), false);
});
