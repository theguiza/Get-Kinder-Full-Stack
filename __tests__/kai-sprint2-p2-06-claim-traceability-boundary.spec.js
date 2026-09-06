import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getClaimTraceabilitySummary } from "../Backend/kai/services/kaiClaimTraceabilityService.js";
import { __claimTraceabilityRepositoryContract } from "../Backend/kai/dictionary/postgresClaimTraceabilityRepository.js";
import {
  composeClaimTraceabilityGraphRelationships,
  validateGraphRelationshipEndpoints,
  validateGraphTraceCompleteness,
  __graphRelationshipContract,
} from "../Backend/kai/validators/kaiGraphRelationshipValidators.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const CLAIM = "00000000-0000-4000-8000-000000000101";
const actorContext = {
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  organizationMemberships: [
    { organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" },
  ],
};

function input(overrides = {}) {
  return { organizationId: ORG, claimId: CLAIM, requestedAudience: "internal", actorContext, ...overrides };
}

test("P2-06 service: disabled, invalid, and unauthorized calls do not load or call a repository", async () => {
  let calls = 0;
  const repository = { async getClaimTraceabilitySummary() { calls += 1; throw new Error("must not call"); } };

  assert.equal((await getClaimTraceabilitySummary(input(), { env: {}, claimTraceabilityRepository: repository })).error.code, "feature_disabled");
  assert.equal((await getClaimTraceabilitySummary({ ...input(), extra: true }, { env: { KAI_SPRINT2_ENABLED: "true" }, claimTraceabilityRepository: repository })).error.code, "validation_blocker");
  assert.equal((await getClaimTraceabilitySummary(input({ requestedAudience: "partner" }), { env: { KAI_SPRINT2_ENABLED: "true" }, claimTraceabilityRepository: repository })).error.code, "validation_blocker");
  assert.equal((await getClaimTraceabilitySummary(input({ actorContext: { actorType: "system", actorUserId: actorContext.actorUserId } }), { env: { KAI_SPRINT2_ENABLED: "true" }, claimTraceabilityRepository: repository })).error.code, "authorization_denied");
  assert.equal((await getClaimTraceabilitySummary(input({ actorContext: { ...actorContext, organizationMemberships: [] } }), { env: { KAI_SPRINT2_ENABLED: "true" }, claimTraceabilityRepository: repository })).error.code, "authorization_denied");
  assert.equal(calls, 0);
});

test("P2-06 service: forwards exactly organizationId, claimId, and requestedAudience to the repository", async () => {
  const seen = [];
  const repository = {
    async getClaimTraceabilitySummary(payload) {
      seen.push(payload);
      return { ok: true, data: { eligible: false, blockerCodes: [] }, error: null };
    },
  };
  const result = await getClaimTraceabilitySummary(input({ requestedAudience: "public" }), {
    env: { KAI_SPRINT2_ENABLED: "true" },
    claimTraceabilityRepository: repository,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(seen, [{ organizationId: ORG, claimId: CLAIM, requestedAudience: "public" }]);
});

test("P2-06 service: preserves only allowlisted traceability conflict reasons", async () => {
  const repository = {
    async getClaimTraceabilitySummary() {
      return {
        ok: false,
        data: null,
        error: {
          code: "conflict_current_state_changed",
          status: 409,
          reason: "source_version_not_current",
        },
      };
    },
  };
  const result = await getClaimTraceabilitySummary(input(), {
    env: { KAI_SPRINT2_ENABLED: "true" },
    claimTraceabilityRepository: repository,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict_current_state_changed");
  assert.deepEqual(result.data, { traceability_conflict_reason: "source_version_not_current" });

  const unsafeRepository = {
    async getClaimTraceabilitySummary() {
      return {
        ok: false,
        data: null,
        error: {
          code: "conflict_current_state_changed",
          status: 409,
          reason: "unsafe_detail",
        },
      };
    },
  };
  const unsafeResult = await getClaimTraceabilitySummary(input(), {
    env: { KAI_SPRINT2_ENABLED: "true" },
    claimTraceabilityRepository: unsafeRepository,
  });
  assert.equal(unsafeResult.ok, false);
  assert.equal(unsafeResult.error.code, "conflict_current_state_changed");
  assert.equal("data" in unsafeResult, false);
});

test("P2-06 service lazy-loads the database-capable repository only after the feature gate", () => {
  const source = readFileSync(new URL("../Backend/kai/services/kaiClaimTraceabilityService.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /^import .*postgresClaimTraceabilityRepository/m);
  assert.match(source, /await import\(\s*"\.\.\/dictionary\/postgresClaimTraceabilityRepository\.js"\s*\)/);
  assert.ok(source.indexOf("isKaiSprint2Enabled") < source.indexOf("createDefaultClaimTraceabilityRepository"));
});

test("P2-06 repository contract fixes blocker ordering and exposes potential groups without confirmed-conflict vocabulary", () => {
  assert.deepEqual(__claimTraceabilityRepositoryContract.BLOCKER_ORDER, [
    "claim_not_approved_for_requested_audience",
    "audience_gate_closed",
    "claim_review_unresolved",
    "evidence_review_unresolved",
    "support_strength_unassessed",
    "coverage_dimension_unresolved",
    "client_followup_unresolved",
    "potential_conflict_review_unresolved",
    "requirement_authority_absent",
    "traceability_incomplete",
  ]);
  const source = readFileSync(new URL("../Backend/kai/dictionary/postgresClaimTraceabilityRepository.js", import.meta.url), "utf8");
  assert.match(source, /potential_conflict_groups/);
  assert.doesNotMatch(source, /confirmed_conflict|proven_conflict|conflict_exists/);
  assert.doesNotMatch(source, /\bINSERT\b|\bUPDATE\b|\bDELETE\b|prepareMetadataOnlyAudit|upload_lifecycle_audit/);
});

test("KAI B1A-3B: the traceability DTO's candidate object exposes intake_sensitivity_profile_id (server-grounded identity for the Impact Evidence Library's Phase-5 review entry point)", () => {
  const source = readFileSync(new URL("../Backend/kai/dictionary/postgresClaimTraceabilityRepository.js", import.meta.url), "utf8");
  assert.match(
    source,
    /candidate:\s*\{\s*\n\s*intake_source_candidate_id:\s*candidateRow\.intake_source_candidate_id,\s*\n\s*intake_sensitivity_profile_id:\s*candidateRow\.intake_sensitivity_profile_id,/,
  );
});

test("P2-06 graph relationships: canonical relational edges compose into endpoint-validated graph relationship DTOs", () => {
  const rows = {
    claimRow: { claim_id: "10000000-0000-4000-8000-000000000001" },
    claimEvidenceLinkRow: {
      claim_id: "10000000-0000-4000-8000-000000000001",
      evidence_item_id: "20000000-0000-4000-8000-000000000001",
    },
    evidenceItemRow: {
      evidence_item_id: "20000000-0000-4000-8000-000000000001",
    },
    locatorRow: { source_locator_id: "30000000-0000-4000-8000-000000000001" },
    sourceRow: { source_id: "40000000-0000-4000-8000-000000000001" },
    sourceVersionRow: { source_version_id: "50000000-0000-4000-8000-000000000001" },
    candidateRow: {
      intake_source_candidate_id: "60000000-0000-4000-8000-000000000001",
    },
    dictionaryRow: { data_dictionary_id: "70000000-0000-4000-8000-000000000001" },
    profileRow: { intake_sensitivity_profile_id: "80000000-0000-4000-8000-000000000001" },
    evidenceReviewQueueItemRow: { review_queue_item_id: "90000000-0000-4000-8000-000000000001" },
    claimReviewQueueItemRow: { review_queue_item_id: "90000000-0000-4000-8000-000000000002" },
  };

  const relationships = composeClaimTraceabilityGraphRelationships(rows);

  assert.deepEqual(
    relationships.map((relationship) => relationship.relationship_type),
    __graphRelationshipContract.GRAPH_RELATIONSHIP_TYPES,
  );
  assert.equal(relationships.every(validateGraphRelationshipEndpoints), true);
  assert.deepEqual(validateGraphTraceCompleteness(relationships), {
    complete: true,
    missing_relationship_types: [],
    invalid_relationship_count: 0,
  });
});

test("P2-06 graph validation fails closed on endpoint-type mismatch, missing relationship type, or non-canonical endpoint id", () => {
  const valid = __graphRelationshipContract.GRAPH_RELATIONSHIP_TYPES.map((type) => {
    const [fromObjectType, toObjectType] = __graphRelationshipContract.GRAPH_RELATIONSHIP_ENDPOINTS[type];
    return {
      relationship_type: type,
      from_object_type: fromObjectType,
      from_object_id: "10000000-0000-4000-8000-000000000001",
      to_object_type: toObjectType,
      to_object_id: "20000000-0000-4000-8000-000000000001",
    };
  });

  assert.equal(validateGraphRelationshipEndpoints({
    ...valid[0],
    to_object_type: "source",
  }), false);
  assert.equal(validateGraphRelationshipEndpoints({
    ...valid[0],
    from_object_id: "NOT-A-UUID",
  }), false);

  const incomplete = validateGraphTraceCompleteness(valid.slice(1));
  assert.equal(incomplete.complete, false);
  assert.deepEqual(incomplete.missing_relationship_types, ["claim_supported_by_evidence"]);
  assert.equal(incomplete.invalid_relationship_count, 0);

  const invalid = validateGraphTraceCompleteness([{ ...valid[0], to_object_id: "not-a-uuid" }, ...valid.slice(1)]);
  assert.equal(invalid.complete, false);
  assert.equal(invalid.invalid_relationship_count, 1);
});

test("P2-06 repository wires graph relationship endpoint and completeness validation into the traceability DTO", () => {
  const source = readFileSync(new URL("../Backend/kai/dictionary/postgresClaimTraceabilityRepository.js", import.meta.url), "utf8");
  assert.match(source, /composeClaimTraceabilityGraphRelationships/);
  assert.match(source, /validateGraphTraceCompleteness/);
  assert.match(source, /graph_relationships:\s*graphRelationships/);
  assert.match(source, /graph_trace_completeness:\s*graphTraceCompleteness/);
  assert.match(source, /if \(!graphTraceCompleteness\.complete\) addOrderedBlocker\(blockers, "traceability_incomplete"\)/);
});
