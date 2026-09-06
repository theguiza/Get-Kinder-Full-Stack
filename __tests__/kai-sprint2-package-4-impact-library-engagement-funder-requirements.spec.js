import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  getEngagementFunderRequirementsForImpactLibrary,
  __engagementFunderRequirementsCompositionServiceTestables,
} from "../Backend/kai/services/kaiEngagementFunderRequirementsCompositionService.js";

const ORG_A = "00000000-0000-4000-8000-00000000000a";
const ENGAGEMENT_A = "10000000-0000-4000-8000-00000000000a";
const ENGAGEMENT_B = "10000000-0000-4000-8000-00000000000b";
const REQUIREMENT_1 = "20000000-0000-4000-8000-000000000001";
const REQUIREMENT_2 = "20000000-0000-4000-8000-000000000002";
const REQUIREMENT_SET_ID = "30000000-0000-4000-8000-000000000001";

const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true" });

const gkReviewerActor = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  kaiRoles: [],
  organizationMemberships: [{ organization_id: ORG_A, membership_status: "active", role_name: "gk_reviewer" }],
});

function requirementSet({ requirementIds = [REQUIREMENT_1, REQUIREMENT_2], requirementSetId = REQUIREMENT_SET_ID } = {}) {
  return {
    requirement_set_id: requirementSetId,
    set_key: "annual_outcomes_v1",
    requirement_count: requirementIds.length,
    requirements: requirementIds.map((requirementId) => ({ requirement_id: requirementId, requirement_key: `key_${requirementId}` })),
    requirement_framework_version: {
      requirement_framework_version_id: "40000000-0000-4000-8000-000000000001",
      framework_code: "annual_outcomes_v1",
      version_label: "v1",
      framework_status: "active",
    },
    requirement_source: {
      requirement_source_id: "50000000-0000-4000-8000-000000000001",
      source_type: "funder",
      source_code: "city_impact_fund",
    },
  };
}

function classifyResult(overrides = {}) {
  return {
    ok: true,
    data: {
      state: "no_target_selected",
      engagement: { engagement_id: ENGAGEMENT_A, organization_id: ORG_A },
      target: {},
      authoritative_requirement_sets: [],
      applicability_rows: [],
      applicable_requirement_sets: [],
      not_confirmed_states: ["applicable_requirement_set_assessment_not_available"],
      ...overrides,
    },
    error: null,
  };
}

function applicableClassifyResult(overrides = {}) {
  return classifyResult({
    state: "applicable_requirement_set_assessment_not_available",
    applicability_conclusion: "CURRENT_APPLICABLE",
    not_confirmed_states: [],
    applicable_requirement_sets: [requirementSet()],
    ...overrides,
  });
}

function assessmentDto({ requirementId, engagementId = ENGAGEMENT_A, assessmentState = "satisfied" } = {}) {
  return {
    requirement: { requirement_id: requirementId },
    assessment: {
      requirement_assessment_id: `60000000-0000-4000-8000-00000000000${requirementId.slice(-1)}`,
      organization_id: ORG_A,
      engagement_id: engagementId,
      requirement_id: requirementId,
      assessment_state: assessmentState,
      assessment_explanation: "test",
      state_fingerprint: "a".repeat(64),
      created_at: "2026-09-05T12:00:00.000Z",
      replayed: false,
    },
  };
}

function baseInput(overrides = {}) {
  return {
    organizationId: ORG_A,
    engagementId: ENGAGEMENT_A,
    actorContext: gkReviewerActor,
    ...overrides,
  };
}

test("Package 4: no_target_selected passes through unchanged, and never attempts an assessment read", async () => {
  const readCalls = [];
  const deps = {
    env: enabledEnv,
    async classifyEngagementFunderRequirementsState() {
      return classifyResult();
    },
    async getEngagementRequirementAssessment(input) {
      readCalls.push(input);
      return { ok: false, error: { code: "not_found", status: 404 } };
    },
  };
  const result = await getEngagementFunderRequirementsForImpactLibrary(baseInput(), deps);
  assert.equal(result.ok, true);
  assert.equal(result.data.state, "no_target_selected");
  assert.deepEqual(result.data.applicable_requirement_sets, []);
  assert.equal(readCalls.length, 0);
});

test("Package 4: target_selected_no_authoritative_requirement_set passes through unchanged", async () => {
  const deps = {
    env: enabledEnv,
    async classifyEngagementFunderRequirementsState() {
      return classifyResult({ state: "target_selected_no_authoritative_requirement_set" });
    },
    async getEngagementRequirementAssessment() {
      throw new Error("must not be called");
    },
  };
  const result = await getEngagementFunderRequirementsForImpactLibrary(baseInput(), deps);
  assert.equal(result.ok, true);
  assert.equal(result.data.state, "target_selected_no_authoritative_requirement_set");
});

test("Package 4: authoritative_requirement_set_not_applicable passes through unchanged", async () => {
  const deps = {
    env: enabledEnv,
    async classifyEngagementFunderRequirementsState() {
      return classifyResult({ state: "authoritative_requirement_set_not_applicable" });
    },
    async getEngagementRequirementAssessment() {
      throw new Error("must not be called");
    },
  };
  const result = await getEngagementFunderRequirementsForImpactLibrary(baseInput(), deps);
  assert.equal(result.ok, true);
  assert.equal(result.data.state, "authoritative_requirement_set_not_applicable");
});

test("Package 4: applicable_requirement_set_assessment_not_available resolves each requirement's CURRENT engagement-scope assessment via the Package 3B read", async () => {
  const readCalls = [];
  const deps = {
    env: enabledEnv,
    async classifyEngagementFunderRequirementsState() {
      return applicableClassifyResult();
    },
    async getEngagementRequirementAssessment(input) {
      readCalls.push(input);
      if (input.requirementId === REQUIREMENT_1) {
        return { ok: true, data: assessmentDto({ requirementId: REQUIREMENT_1 }), error: null };
      }
      return { ok: false, error: { code: "not_found", status: 404 } };
    },
  };
  const result = await getEngagementFunderRequirementsForImpactLibrary(baseInput(), deps);
  assert.equal(result.ok, true);
  assert.equal(result.data.state, "applicable_requirement_set_assessment_not_available");
  assert.equal(readCalls.length, 2);
  for (const call of readCalls) {
    assert.equal(call.organizationId, ORG_A);
    assert.equal(call.engagementId, ENGAGEMENT_A);
    assert.equal(call.actorContext, gkReviewerActor);
  }
  const [set] = result.data.applicable_requirement_sets;
  const req1 = set.requirements.find((requirement) => requirement.requirement_id === REQUIREMENT_1);
  const req2 = set.requirements.find((requirement) => requirement.requirement_id === REQUIREMENT_2);
  assert.equal(req1.current_assessment.assessment.assessment_state, "satisfied");
  assert.equal(req2.current_assessment, null);
});

test("Package 4: a requirement with no current assessment never falls back to the generic organization-scope (engagement_id IS NULL) assessment", async () => {
  const deps = {
    env: enabledEnv,
    async classifyEngagementFunderRequirementsState() {
      return applicableClassifyResult({ applicable_requirement_sets: [requirementSet({ requirementIds: [REQUIREMENT_1] })] });
    },
    async getEngagementRequirementAssessment(input) {
      assert.equal(input.engagementId, ENGAGEMENT_A, "must always pass the specific engagementId - never omit it to fall back generic");
      return { ok: false, error: { code: "not_found", status: 404 } };
    },
  };
  const result = await getEngagementFunderRequirementsForImpactLibrary(baseInput(), deps);
  assert.equal(result.ok, true);
  const [set] = result.data.applicable_requirement_sets;
  assert.equal(set.requirements[0].current_assessment, null);

  const sourceText = readFileSync(
    "Backend/kai/services/kaiEngagementFunderRequirementsCompositionService.js",
    "utf8",
  );
  assert.doesNotMatch(sourceText, /getOrganizationRequirementAssessment|readOrganizationRequirementAssessment/);
});

test("Package 4: a stale assessment (Package 3B gate no longer current) cannot appear as current - it resolves to null, not the stale row", async () => {
  const deps = {
    env: enabledEnv,
    async classifyEngagementFunderRequirementsState() {
      return applicableClassifyResult({ applicable_requirement_sets: [requirementSet({ requirementIds: [REQUIREMENT_1] })] });
    },
    async getEngagementRequirementAssessment() {
      // Package 3B's own read re-resolves the live applicability gate and
      // reports a superseded/no-longer-current assessment as the same
      // not_found the write path's absence reports - the composition must
      // treat that identically to "never assessed", never surface the row.
      return { ok: false, error: { code: "engagement_requirement_applicability_not_confirmed", status: 422 } };
    },
  };
  const result = await getEngagementFunderRequirementsForImpactLibrary(baseInput(), deps);
  assert.equal(result.ok, true);
  const [set] = result.data.applicable_requirement_sets;
  assert.equal(set.requirements[0].current_assessment, null);
});

test("Package 4: kai_standard is never presented as external funder authority - the composition invents no authority filtering of its own, it only relays the classifier's already-filtered result", async () => {
  const sourceText = readFileSync(
    "Backend/kai/services/kaiEngagementFunderRequirementsCompositionService.js",
    "utf8",
  );
  // The composition contains no authority-filtering logic of its own (no
  // source_type/EXTERNAL_REQUIREMENT_SOURCE_TYPES comparison) - any mention
  // of kai_standard in the file is documentation, not a second filter.
  assert.doesNotMatch(sourceText, /source_type\s*===/);
  assert.doesNotMatch(sourceText, /EXTERNAL_REQUIREMENT_SOURCE_TYPES/);

  const deps = {
    env: enabledEnv,
    async classifyEngagementFunderRequirementsState() {
      // The classifier itself is Package 1B/2A's authority - kai_standard is
      // already excluded before this composition ever runs; there is
      // nothing left in applicable_requirement_sets for a kai_standard set.
      return applicableClassifyResult();
    },
    async getEngagementRequirementAssessment() {
      return { ok: false, error: { code: "not_found", status: 404 } };
    },
  };
  const result = await getEngagementFunderRequirementsForImpactLibrary(baseInput(), deps);
  for (const set of result.data.applicable_requirement_sets) {
    assert.notEqual(set.requirement_source.source_type, "kai_standard");
  }
});

test("Package 4: a classify-level authorization/tenant failure fails the whole composition closed - never a partial result", async () => {
  const deps = {
    env: enabledEnv,
    async classifyEngagementFunderRequirementsState() {
      return { ok: false, error: { code: "authorization_denied", status: 403 } };
    },
    async getEngagementRequirementAssessment() {
      throw new Error("must not be called");
    },
  };
  const result = await getEngagementFunderRequirementsForImpactLibrary(baseInput(), deps);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("Package 4: a per-requirement assessment-read authorization failure fails the whole composition closed, not just that one requirement", async () => {
  let calls = 0;
  const deps = {
    env: enabledEnv,
    async classifyEngagementFunderRequirementsState() {
      return applicableClassifyResult();
    },
    async getEngagementRequirementAssessment(input) {
      calls += 1;
      if (input.requirementId === REQUIREMENT_1) {
        return { ok: true, data: assessmentDto({ requirementId: REQUIREMENT_1 }), error: null };
      }
      return { ok: false, error: { code: "authorization_denied", status: 403 } };
    },
  };
  const result = await getEngagementFunderRequirementsForImpactLibrary(baseInput(), deps);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
  assert.equal(calls, 2);
});

test("Package 4: switching the selected engagement replaces the previous engagement's projection completely - no leaked assessment data across engagements", async () => {
  const deps = {
    env: enabledEnv,
    async classifyEngagementFunderRequirementsState(input) {
      return applicableClassifyResult({
        engagement: { engagement_id: input.engagementId, organization_id: input.organizationId },
        applicable_requirement_sets: [requirementSet({ requirementIds: [REQUIREMENT_1] })],
      });
    },
    async getEngagementRequirementAssessment(input) {
      if (input.engagementId === ENGAGEMENT_A) {
        return { ok: true, data: assessmentDto({ requirementId: REQUIREMENT_1, engagementId: ENGAGEMENT_A, assessmentState: "satisfied" }), error: null };
      }
      return { ok: false, error: { code: "not_found", status: 404 } };
    },
  };

  const resultA = await getEngagementFunderRequirementsForImpactLibrary(baseInput({ engagementId: ENGAGEMENT_A }), deps);
  const resultB = await getEngagementFunderRequirementsForImpactLibrary(baseInput({ engagementId: ENGAGEMENT_B }), deps);

  assert.equal(resultA.data.applicable_requirement_sets[0].requirements[0].current_assessment.assessment.assessment_state, "satisfied");
  assert.equal(resultB.data.engagement.engagement_id, ENGAGEMENT_B);
  assert.equal(resultB.data.applicable_requirement_sets[0].requirements[0].current_assessment, null);
});

test("Package 4: cross-tenant/cross-engagement isolation is delegated to, never bypassed around, the classifier's own tenant check", async () => {
  const deps = {
    env: enabledEnv,
    async classifyEngagementFunderRequirementsState(input) {
      assert.equal(input.organizationId, ORG_A);
      return { ok: false, error: { code: "tenant_boundary_violation", status: 403 } };
    },
    async getEngagementRequirementAssessment() {
      throw new Error("must not be called");
    },
  };
  const result = await getEngagementFunderRequirementsForImpactLibrary(baseInput(), deps);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "tenant_boundary_violation");
});

test("Package 4: validation_blocker on missing identifiers, before any classify/assessment call", async () => {
  const deps = {
    env: enabledEnv,
    async classifyEngagementFunderRequirementsState() {
      throw new Error("must not be called");
    },
    async getEngagementRequirementAssessment() {
      throw new Error("must not be called");
    },
  };
  const result = await getEngagementFunderRequirementsForImpactLibrary({ organizationId: "", engagementId: ENGAGEMENT_A, actorContext: gkReviewerActor }, deps);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
});

test("Package 4: feature flag off is a hard stop before any read", async () => {
  const deps = {
    env: {},
    async classifyEngagementFunderRequirementsState() {
      throw new Error("must not be called");
    },
  };
  const result = await getEngagementFunderRequirementsForImpactLibrary(baseInput(), deps);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "feature_disabled");
});

test("Package 4: an applicable state with zero applicable_requirement_sets does not attempt any assessment read", async () => {
  const deps = {
    env: enabledEnv,
    async classifyEngagementFunderRequirementsState() {
      return applicableClassifyResult({ applicable_requirement_sets: [] });
    },
    async getEngagementRequirementAssessment() {
      throw new Error("must not be called");
    },
  };
  const result = await getEngagementFunderRequirementsForImpactLibrary(baseInput(), deps);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.applicable_requirement_sets, []);
});

test("Package 4: testables expose the exact applicable-state constant and absent-assessment error-code set used, for regression protection", () => {
  assert.equal(
    __engagementFunderRequirementsCompositionServiceTestables.APPLICABLE_STATE,
    "applicable_requirement_set_assessment_not_available",
  );
  assert.deepEqual(
    [...__engagementFunderRequirementsCompositionServiceTestables.ASSESSMENT_ABSENT_ERROR_CODES].sort(),
    ["engagement_requirement_applicability_not_confirmed", "not_found"],
  );
});
