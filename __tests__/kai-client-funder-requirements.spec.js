import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express from "express";

import { resolveKaiActorContext } from "../Backend/kai/auth/kaiActorContext.js";
import { KAI_SPRINT2_P0_OPERATION_ROLES } from "../Backend/kai/config/kaiSprint2P0Contract.js";
import {
  getClientFunderRequirements,
  __clientFunderRequirementsServiceContract,
} from "../Backend/kai/services/kaiClientFunderRequirementsService.js";
import {
  classifyEngagementFunderRequirementsState,
  __engagementContextServiceContract,
} from "../Backend/kai/services/kaiEngagementContextService.js";
import {
  assessEngagementRequirement,
  getEngagementRequirementAssessment,
  __engagementRequirementAssessmentServiceContract,
} from "../Backend/kai/services/kaiEngagementRequirementAssessmentService.js";
import { getEngagementFunderRequirementsForImpactLibrary } from "../Backend/kai/services/kaiEngagementFunderRequirementsCompositionService.js";
import { __requirementAssessmentServiceContract } from "../Backend/kai/services/kaiRequirementAssessmentService.js";
import { REQUIREMENT_ASSESSMENT_STATES } from "../Backend/kai/validators/kaiRequirementAssessmentValidators.js";
import sprint2IntakeApiRouter, { __testables as routeTestables } from "../Backend/kai/routes/sprint2IntakeApi.js";
import {
  CLIENT_FUNDER_REQUIREMENTS_STATUSES,
  CLIENT_REQUIREMENT_READINESS,
  clientFunderRequirementsPath,
  projectClientFunderRequirements,
} from "../frontend/impactEvidenceLibraryLogic.js";

/**
 * Client-safe Funder Requirements. The real service, the real Package 1B
 * classifier core, the real Package 3B live applicability gate, and the real
 * projection run; only the lowest-level data reads (engagement row,
 * authority rows, applicability rows, catalogue labels, and the assessment
 * repository) are injected. The real-PostgreSQL path is proven by the
 * Package 4 runner.
 */

const ENV = Object.freeze({ KAI_SPRINT2_ENABLED: "true" });
const ORG = "11111111-2222-4333-8444-555555555555";
const OTHER_ORG = "99999999-8888-4777-8666-555555555555";
const ENGAGEMENT = "22222222-3333-4444-8555-666666666666";
const SET_ID = "33333333-4444-4555-8666-777777777777";
const REQ_MET = "44444444-5555-4666-8777-000000000001";
const REQ_REVIEW = "44444444-5555-4666-8777-000000000002";
const REQ_UNASSESSED = "44444444-5555-4666-8777-000000000003";
const GK_ORG = 77;

const TARGET = Object.freeze({
  target_funder_id: "city_impact_fund",
  target_framework: "annual_outcomes_v1",
  reporting_period_start: "2026-01-01",
  reporting_period_end: "2026-12-31",
});

// Everything below must never reach a client payload.
const HIDDEN = Object.freeze([
  "reviewer-user-secret",
  "gk_reviewer_role_secret",
  "2026-09-01T10:00:00.000Z",
  "ers-row-secret",
  "ers-superseded-secret",
  "assessment-row-secret",
  "fingerprint-secret",
  "GK EXPLANATION SECRET",
  "evidence-item-secret",
  "claim-secret",
  "decision-secret",
  "gap-secret",
  "outcome-context-secret",
  "ir_contrib_002",
  "applicability_rows",
  "missing_persistence",
  "not_confirmed_reason",
  "created_by_type",
  "target_context_identity",
]);

function engagementRow(target = TARGET, organizationId = ORG) {
  return {
    engagement_id: ENGAGEMENT,
    organization_id: organizationId,
    engagement_code: "Annual report",
    engagement_type: "reporting",
    engagement_status: "active",
    project_metadata: target ? { engagement_requirement_target: target } : {},
  };
}

function authorityRow(requirementIds = [REQ_MET, REQ_REVIEW, REQ_UNASSESSED]) {
  return {
    requirement_set_id: SET_ID,
    set_key: "annual_outcomes",
    set_name: "Annual Outcomes",
    requirement_framework_version_id: "fv-1",
    framework_code: "annual_outcomes_v1",
    framework_name: "Annual Outcomes",
    version_label: "v1",
    framework_status: "active",
    requirement_source_id: "src-1",
    source_type: "funder",
    source_code: "city_impact_fund",
    source_name: "City Impact Fund",
    requirement_count: requirementIds.length,
    requirements: requirementIds.map((requirement_id, index) => ({ requirement_id, requirement_key: `ir_key_${index}` })),
  };
}

function applicabilityRow(overrides = {}) {
  return {
    engagement_requirement_set_id: "ers-row-secret",
    organization_id: ORG,
    engagement_id: ENGAGEMENT,
    requirement_set_id: SET_ID,
    applicability_status: "confirmed",
    applicability_effective_state: "applicable",
    reviewed_by: "reviewer-user-secret",
    reviewed_by_role: "gk_reviewer_role_secret",
    reviewed_at: "2026-09-01T10:00:00.000Z",
    supersedes_engagement_requirement_set_id: null,
    superseded_by_engagement_requirement_set_id: null,
    target_context_identity: TARGET,
    created_by: "reviewer-user-secret",
    created_by_type: "human",
    created_at: "2026-09-01T10:00:00.000Z",
    set_key: "annual_outcomes",
    set_name: "Annual Outcomes",
    requirement_framework_version_id: "fv-1",
    framework_code: "annual_outcomes_v1",
    framework_name: "Annual Outcomes",
    version_label: "v1",
    framework_status: "active",
    requirement_source_id: "src-1",
    source_type: "funder",
    source_code: "city_impact_fund",
    source_name: "City Impact Fund",
    ...overrides,
  };
}

const LABELS = Object.freeze({
  [REQ_MET]: { label: "Intended outcomes are defined", description: "Each program states the change it intends." },
  [REQ_REVIEW]: { label: "Known limitations are documented", description: null },
  [REQ_UNASSESSED]: { label: "Data quality is documented", description: "Collection methods are described." },
});

function assessmentRecord(requirementId, state, variant = "a") {
  return {
    ok: true,
    data: {
      requirement: { requirement_id: requirementId, requirement_key: "ir_contrib_002", requirement_label: "x" },
      assessment: {
        requirement_assessment_id: `assessment-row-secret-${variant}`,
        organization_id: ORG,
        engagement_id: ENGAGEMENT,
        requirement_id: requirementId,
        assessment_state: state,
        assessment_explanation: `GK EXPLANATION SECRET ${variant}`,
        state_fingerprint: `fingerprint-secret-${variant}`,
        created_at: "2026-09-01T10:00:00.000Z",
        replayed: false,
      },
      evidence_item_ids: [`evidence-item-secret-${variant}`],
      claim_ids: [`claim-secret-${variant}`],
      evidence_review_decision_ids: [`decision-secret-${variant}`],
      claim_review_decision_ids: [],
      current_gap_log_item_ids: [`gap-secret-${variant}`],
      outcome_context_ids: [`outcome-context-secret-${variant}`],
      source_promotion_evidence_item_ids: [],
      conflict_resolution_pairs: [],
    },
  };
}

function dependencies({
  target = TARGET,
  engagementOrganizationId = ORG,
  authority = [authorityRow()],
  applicability = [applicabilityRow()],
  assessments = { [REQ_MET]: "satisfied", [REQ_REVIEW]: "needs_review" },
  variant = "a",
  calls = [],
  repositoryFailure = null,
} = {}) {
  return {
    env: ENV,
    getEngagementForOrganization: async ({ organizationId, engagementId }) => {
      calls.push("engagement");
      return organizationId === engagementOrganizationId && engagementId === ENGAGEMENT ? engagementRow(target, engagementOrganizationId) : null;
    },
    listExternalRequirementSetsForTarget: async () => {
      calls.push("authority");
      return authority;
    },
    listEngagementRequirementSetsForOrganization: async () => {
      calls.push("applicability");
      return applicability;
    },
    getRequirementSetIdForRequirement: async ({ requirementId }) => ({ requirement_id: requirementId, requirement_set_id: SET_ID }),
    getRequirementSetAuthority: async () => authorityRow(),
    listRequirementCatalogueLabels: async ({ requirementIds }) => {
      calls.push("labels");
      return requirementIds.map((requirement_id, index) => ({
        requirement_id,
        requirement_label: LABELS[requirement_id].label,
        requirement_description: LABELS[requirement_id].description,
        display_order: index,
        requirement_set_id: SET_ID,
        set_name: "Annual Outcomes",
        framework_name: "Annual Outcomes",
        version_label: "v1",
        source_name: "City Impact Fund",
      }));
    },
    requirementAssessmentRepository: {
      async readEngagementRequirementAssessment({ requirementId }) {
        calls.push(`assessment:${requirementId}`);
        if (repositoryFailure) return { ok: false, error: { code: repositoryFailure, status: 500 } };
        const state = assessments[requirementId];
        return state ? assessmentRecord(requirementId, state, variant) : { ok: false, error: { code: "not_found", status: 404 } };
      },
      async assessEngagementRequirement() {
        throw new Error("client read must never write an assessment");
      },
    },
  };
}

function memberActor(roleName, { organizationId = ORG, kaiRoles = [] } = {}) {
  return {
    actorType: "human",
    actorUserId: `user-${roleName}`,
    kaiRoles,
    platformSuperuser: false,
    organizationMemberships: [{ organization_id: organizationId, role_name: roleName, membership_status: "active" }],
  };
}

async function clientAdminActor(boundOrganizationId = ORG) {
  const result = await resolveKaiActorContext(
    { user: { id: 501, email: "admin@harbourline.test" } },
    {
      findOrCreateKaiUserByLegacyPublicUserdataId: async ({ legacyPublicUserdataId, email }) => ({
        user_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        legacy_identity_source: "public.userdata",
        legacy_public_userdata_id: legacyPublicUserdataId,
        status: "active",
        email,
      }),
      listKaiRolesForUser: async () => [],
      listOrganizationMembershipsForUser: async () => [],
      resolveOrgScopeForUserId: async () => ({ memberships: [{ orgId: GK_ORG, role: "admin", is_active: true }] }),
      listActiveGkOrganizationBindingsForGkOrganizationIds: async (ids) =>
        ids.includes(GK_ORG) ? [{ gk_organization_id: GK_ORG, kai_organization_id: boundOrganizationId, status: "active" }] : [],
    },
  );
  assert.equal(result.ok, true);
  return result.actorContext;
}

function assertNoHidden(value, label) {
  const serialized = JSON.stringify(value);
  for (const secret of HIDDEN) assert.ok(!serialized.includes(secret), `${label} leaked ${secret}`);
}

const EXPECTED_TARGET = Object.freeze({
  funderId: "city_impact_fund",
  framework: "annual_outcomes_v1",
  grantProgram: null,
  report: null,
  reportingTemplate: null,
  reportingPeriodStart: "2026-01-01",
  reportingPeriodEnd: "2026-12-31",
});

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

test("contract: client read admits the read_intake set; every GK classify/assess/read role set is unchanged", () => {
  assert.deepEqual(
    [...__clientFunderRequirementsServiceContract.CLIENT_FUNDER_REQUIREMENTS_ALLOWED_ROLES].sort(),
    [...KAI_SPRINT2_P0_OPERATION_ROLES.read_intake].sort(),
  );
  assert.deepEqual([...__engagementContextServiceContract.CLASSIFY_FUNDER_REQUIREMENTS_ALLOWED_ROLES].sort(), ["client_admin", "gk_admin", "gk_operator"]);
  assert.deepEqual([...__engagementContextServiceContract.UPDATE_ENGAGEMENT_TARGET_ALLOWED_ROLES].sort(), ["client_admin", "gk_admin", "gk_operator"]);
  assert.deepEqual([...__requirementAssessmentServiceContract.ASSESS_REQUIREMENT_ALLOWED_ROLES].sort(), ["gk_admin", "gk_reviewer"]);
  assert.deepEqual([...__requirementAssessmentServiceContract.READ_REQUIREMENT_ASSESSMENT_ALLOWED_ROLES].sort(), ["gk_admin", "gk_operator", "gk_reviewer"]);
  assert.deepEqual(
    [...__engagementRequirementAssessmentServiceContract.READ_ENGAGEMENT_REQUIREMENT_ASSESSMENT_ALLOWED_ROLES].sort(),
    ["gk_admin", "gk_operator", "gk_reviewer"],
  );
  // The readiness vocabulary maps exactly the governed assessment states.
  assert.deepEqual(
    Object.keys(__clientFunderRequirementsServiceContract.CLIENT_READINESS_BY_ASSESSMENT_STATE).sort(),
    [...REQUIREMENT_ASSESSMENT_STATES].sort(),
  );
  assert.deepEqual(
    [...Object.values(__clientFunderRequirementsServiceContract.CLIENT_READINESS_BY_ASSESSMENT_STATE), __clientFunderRequirementsServiceContract.NOT_YET_ASSESSED].sort(),
    [...CLIENT_REQUIREMENT_READINESS].sort(),
  );
  assert.deepEqual(
    Object.values(__clientFunderRequirementsServiceContract.CLIENT_FUNDER_REQUIREMENTS_STATUSES).sort(),
    [...CLIENT_FUNDER_REQUIREMENTS_STATUSES].sort(),
  );
});

// ---------------------------------------------------------------------------
// Applicability / currentness
// ---------------------------------------------------------------------------

test("applicable: current reviewed applicability yields labelled requirements with readiness from the current assessment only; exact keys", async () => {
  const actorContext = await clientAdminActor();
  const calls = [];
  const result = await getClientFunderRequirements({ organizationId: ORG, engagementId: ENGAGEMENT, actorContext }, dependencies({ calls }));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.data, {
    engagementId: ENGAGEMENT,
    status: "applicable",
    target: EXPECTED_TARGET,
    requirementSets: [
      {
        requirementSetId: SET_ID,
        name: "Annual Outcomes",
        funderName: "City Impact Fund",
        frameworkName: "Annual Outcomes",
        versionLabel: "v1",
        requirements: [
          { requirementId: REQ_MET, label: LABELS[REQ_MET].label, description: LABELS[REQ_MET].description, readiness: "met" },
          { requirementId: REQ_REVIEW, label: LABELS[REQ_REVIEW].label, description: null, readiness: "in_review" },
          { requirementId: REQ_UNASSESSED, label: LABELS[REQ_UNASSESSED].label, description: LABELS[REQ_UNASSESSED].description, readiness: "not_yet_assessed" },
        ],
      },
    ],
  });
  assertNoHidden(result, "applicable payload");
  assert.ok(calls.includes(`assessment:${REQ_UNASSESSED}`), "every applicable requirement is read through the governed assessment path");
});

test("every governed assessment state maps one-to-one; an unknown state fails closed", async () => {
  const expected = { satisfied: "met", partially_satisfied: "partially_met", not_satisfied: "not_met", needs_review: "in_review" };
  for (const [state, readiness] of Object.entries(expected)) {
    const result = await getClientFunderRequirements(
      { organizationId: ORG, engagementId: ENGAGEMENT, actorContext: memberActor("client_contributor") },
      dependencies({ authority: [authorityRow([REQ_MET])], assessments: { [REQ_MET]: state } }),
    );
    assert.equal(result.data.requirementSets[0].requirements[0].readiness, readiness, state);
  }
  const unknown = await getClientFunderRequirements(
    { organizationId: ORG, engagementId: ENGAGEMENT, actorContext: memberActor("client_contributor") },
    dependencies({ authority: [authorityRow([REQ_MET])], assessments: { [REQ_MET]: "approved_for_funders" } }),
  );
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, "system_error");
  const failing = await getClientFunderRequirements(
    { organizationId: ORG, engagementId: ENGAGEMENT, actorContext: memberActor("client_contributor") },
    dependencies({ authority: [authorityRow([REQ_MET])], repositoryFailure: "system_error" }),
  );
  assert.equal(failing.ok, false, "a repository failure is never shown as not_yet_assessed");
});

test("no target / no authoritative set / conclusively not applicable / not yet confirmed never list requirements", async () => {
  const actorContext = memberActor("client_reviewer");
  const read = (deps) => getClientFunderRequirements({ organizationId: ORG, engagementId: ENGAGEMENT, actorContext }, dependencies(deps));

  const noTarget = await read({ target: null });
  assert.equal(noTarget.data.status, "no_target");
  assert.deepEqual(noTarget.data.requirementSets, []);
  assert.deepEqual(noTarget.data.target, { funderId: null, framework: null, grantProgram: null, report: null, reportingTemplate: null, reportingPeriodStart: null, reportingPeriodEnd: null });

  assert.equal((await read({ authority: [] })).data.status, "no_requirement_set");
  assert.equal((await read({ target: { target_funder_id: "city_impact_fund" } })).data.status, "no_requirement_set");

  const notApplicable = await read({ applicability: [applicabilityRow({ applicability_effective_state: "not_applicable" })] });
  assert.equal(notApplicable.data.status, "not_applicable");
  assert.deepEqual(notApplicable.data.requirementSets, []);

  const proposedOnly = await read({ applicability: [applicabilityRow({ applicability_status: "proposed", reviewed_by: null, reviewed_by_role: null, reviewed_at: null, applicability_effective_state: null })] });
  assert.equal(proposedOnly.data.status, "applicability_pending");
  assert.equal((await read({ applicability: [] })).data.status, "applicability_pending", "no decision at all is pending, never not applicable");

  const retargeted = await read({ applicability: [applicabilityRow({ target_context_identity: { target_funder_id: "city_impact_fund", target_framework: "annual_outcomes_v1" } })] });
  assert.equal(retargeted.data.status, "applicability_pending", "a decision made against a different target snapshot is not current");

  for (const value of [noTarget, notApplicable, proposedOnly, retargeted]) assertNoHidden(value, "non-applicable payload");
});

test("superseded applicability is never current truth: a superseded 'applicable' row with its successor still proposed is pending; with a current not-applicable successor it is not applicable", async () => {
  const actorContext = memberActor("client_admin");
  const superseded = applicabilityRow({ superseded_by_engagement_requirement_set_id: "ers-superseded-secret" });
  const pending = await getClientFunderRequirements(
    { organizationId: ORG, engagementId: ENGAGEMENT, actorContext },
    dependencies({ applicability: [applicabilityRow({ engagement_requirement_set_id: "ers-superseded-secret", applicability_status: "proposed", reviewed_by: null, reviewed_by_role: null, reviewed_at: null, applicability_effective_state: null }), superseded] }),
  );
  assert.equal(pending.data.status, "applicability_pending");
  assert.deepEqual(pending.data.requirementSets, []);
  const replaced = await getClientFunderRequirements(
    { organizationId: ORG, engagementId: ENGAGEMENT, actorContext },
    dependencies({ applicability: [applicabilityRow({ engagement_requirement_set_id: "ers-superseded-secret", applicability_effective_state: "not_applicable" }), superseded] }),
  );
  assert.equal(replaced.data.status, "not_applicable");
  assertNoHidden([pending, replaced], "superseded payloads");
});

test("a stale assessment (live gate or fingerprint no longer current) is not_yet_assessed, never its old state", async () => {
  const actorContext = memberActor("client_contributor");
  // Repository recompute-and-compare returns not_found for a stale fingerprint.
  const stale = await getClientFunderRequirements(
    { organizationId: ORG, engagementId: ENGAGEMENT, actorContext },
    dependencies({ authority: [authorityRow([REQ_MET])], assessments: {} }),
  );
  assert.equal(stale.data.requirementSets[0].requirements[0].readiness, "not_yet_assessed");
});

// ---------------------------------------------------------------------------
// Non-leakage
// ---------------------------------------------------------------------------

test("GK-only artifacts (review metadata, assessment ids/text/fingerprint, provenance) never change the client payload", async () => {
  const actorContext = memberActor("client_reviewer");
  const base = await getClientFunderRequirements({ organizationId: ORG, engagementId: ENGAGEMENT, actorContext }, dependencies({ variant: "a" }));
  const differentInternals = await getClientFunderRequirements(
    { organizationId: ORG, engagementId: ENGAGEMENT, actorContext },
    dependencies({
      variant: "b",
      applicability: [
        applicabilityRow({ reviewed_by: "another-reviewer", reviewed_by_role: "gk_admin", reviewed_at: "2026-09-20T00:00:00.000Z", engagement_requirement_set_id: "ers-new" }),
        applicabilityRow({ engagement_requirement_set_id: "ers-old", superseded_by_engagement_requirement_set_id: "ers-new", applicability_effective_state: "not_applicable" }),
      ],
    }),
  );
  assert.deepEqual(differentInternals.data, base.data, "internal review/assessment artifacts are invisible to the client");
  assertNoHidden(base, "base");
  const changedResult = await getClientFunderRequirements(
    { organizationId: ORG, engagementId: ENGAGEMENT, actorContext },
    dependencies({ assessments: { [REQ_MET]: "partially_satisfied", [REQ_REVIEW]: "needs_review" } }),
  );
  assert.notDeepEqual(changedResult.data, base.data, "a change in the governed result does change the payload");
});

// ---------------------------------------------------------------------------
// Roles and tenant boundary
// ---------------------------------------------------------------------------

test("roles: client_admin (binding-derived), client_reviewer, client_contributor, and GK roles all read the same client-safe result", async () => {
  const expected = (await getClientFunderRequirements(
    { organizationId: ORG, engagementId: ENGAGEMENT, actorContext: await clientAdminActor() },
    dependencies(),
  )).data;
  for (const actorContext of [memberActor("client_reviewer"), memberActor("client_contributor"), memberActor("gk_reviewer"), memberActor("gk_operator", { kaiRoles: ["gk_operator"] })]) {
    const result = await getClientFunderRequirements({ organizationId: ORG, engagementId: ENGAGEMENT, actorContext }, dependencies());
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.data, expected);
  }
});

test("the client read grants no GK assessment, applicability, classifier, or target authority", async () => {
  const now = "2026-09-24T12:00:00.000Z";
  for (const actorContext of [await clientAdminActor(), memberActor("client_reviewer"), memberActor("client_contributor")]) {
    const assessed = await assessEngagementRequirement(
      { organizationId: ORG, engagementId: ENGAGEMENT, requirementId: REQ_MET, actorContext, now },
      dependencies(),
    );
    assert.equal(assessed.ok, false);
    assert.equal(assessed.blockers[0].blocking_reason, "role_not_allowed");
    const gkRead = await getEngagementRequirementAssessment(
      { organizationId: ORG, engagementId: ENGAGEMENT, requirementId: REQ_MET, actorContext },
      dependencies(),
    );
    assert.equal(gkRead.ok, false);
    assert.equal(gkRead.blockers[0].blocking_reason, "role_not_allowed");
  }
  for (const role of ["client_reviewer", "client_contributor"]) {
    const classified = await classifyEngagementFunderRequirementsState(
      { organizationId: ORG, engagementId: ENGAGEMENT, actorContext: memberActor(role) },
      dependencies(),
    );
    assert.equal(classified.ok, false, `${role} classifier`);
    const composition = await getEngagementFunderRequirementsForImpactLibrary(
      { organizationId: ORG, engagementId: ENGAGEMENT, actorContext: memberActor(role) },
      dependencies(),
    );
    assert.equal(composition.ok, false, `${role} GK composition`);
  }
  // client_admin still passes only the classifier it already had; the GK
  // composition still fails at its GK-only assessment read.
  const adminComposition = await getEngagementFunderRequirementsForImpactLibrary(
    { organizationId: ORG, engagementId: ENGAGEMENT, actorContext: await clientAdminActor() },
    dependencies(),
  );
  assert.equal(adminComposition.ok, false);
  assert.equal(adminComposition.blockers[0].blocking_reason, "role_not_allowed");
});

test("cross-org client (binding to another organization) and a foreign engagement are denied before any requirement data is read", async () => {
  const calls = [];
  const crossOrg = await getClientFunderRequirements(
    { organizationId: ORG, engagementId: ENGAGEMENT, actorContext: await clientAdminActor(OTHER_ORG) },
    dependencies({ calls }),
  );
  assert.equal(crossOrg.ok, false);
  assert.equal(crossOrg.blockers[0].validator_key, "VAL-AUT-003");
  for (const role of ["client_reviewer", "client_contributor"]) {
    const denied = await getClientFunderRequirements(
      { organizationId: ORG, engagementId: ENGAGEMENT, actorContext: memberActor(role, { organizationId: OTHER_ORG }) },
      dependencies({ calls }),
    );
    assert.equal(denied.blockers[0].validator_key, "VAL-AUT-003");
  }
  assert.deepEqual(calls, [], "no requirement, applicability, label, or assessment read happens");
  const foreignEngagement = await getClientFunderRequirements(
    { organizationId: ORG, engagementId: ENGAGEMENT, actorContext: memberActor("client_admin") },
    dependencies({ engagementOrganizationId: OTHER_ORG }),
  );
  assert.equal(foreignEngagement.ok, false);
  assert.equal(foreignEngagement.error.code, "not_found");
  assert.equal(foreignEngagement.data ?? null, null, "no requirement data on failure");
});

test("input validation, unmapped actors, and the feature flag", async () => {
  const actorContext = memberActor("client_admin");
  const deps = dependencies();
  assert.equal((await getClientFunderRequirements({ organizationId: ORG, engagementId: ENGAGEMENT, actorContext: { actorType: "service" } }, deps)).error.code, "authorization_denied");
  assert.equal((await getClientFunderRequirements({ organizationId: "ABCDEF00-2222-4333-8444-555555555555", engagementId: ENGAGEMENT, actorContext }, deps)).error.code, "validation_blocker");
  assert.equal((await getClientFunderRequirements({ organizationId: ORG, engagementId: "not-a-uuid", actorContext }, deps)).error.code, "validation_blocker");
  assert.equal((await getClientFunderRequirements({ organizationId: ORG, engagementId: ENGAGEMENT, actorContext, requirementId: REQ_MET }, deps)).error.code, "validation_blocker");
  assert.equal((await getClientFunderRequirements({ organizationId: ORG, engagementId: ENGAGEMENT, actorContext }, { ...deps, env: {} })).error.code, "feature_disabled");
});

// ---------------------------------------------------------------------------
// GK workflow regression
// ---------------------------------------------------------------------------

test("GK composition and classifier DTOs are unchanged by the extraction", async () => {
  const gk = memberActor("gk_operator", { kaiRoles: ["gk_operator"] });
  const composition = await getEngagementFunderRequirementsForImpactLibrary(
    { organizationId: ORG, engagementId: ENGAGEMENT, actorContext: gk },
    dependencies(),
  );
  assert.equal(composition.ok, true, JSON.stringify(composition));
  assert.deepEqual(Object.keys(composition.data).sort(), [
    "applicability_conclusion", "applicability_rows", "applicable_requirement_sets", "authoritative_requirement_sets",
    "engagement", "missing_persistence", "not_confirmed_states", "state", "target",
  ]);
  assert.equal(composition.data.applicability_rows[0].reviewed_by, "reviewer-user-secret", "GK keeps its review metadata");
  const requirements = composition.data.applicable_requirement_sets[0].requirements;
  assert.equal(requirements[0].current_assessment.assessment.assessment_explanation, "GK EXPLANATION SECRET a");
  assert.equal(requirements[2].current_assessment, null);
  const classified = await classifyEngagementFunderRequirementsState(
    { organizationId: ORG, engagementId: ENGAGEMENT, actorContext: await clientAdminActor() },
    dependencies(),
  );
  assert.equal(classified.ok, true, "client_admin keeps its existing classifier access");
  assert.equal(classified.data.state, "applicable_requirement_set_assessment_not_available");
  const gkRead = await getEngagementRequirementAssessment(
    { organizationId: ORG, engagementId: ENGAGEMENT, requirementId: REQ_MET, actorContext: memberActor("gk_reviewer") },
    dependencies(),
  );
  assert.equal(gkRead.ok, true);
  assert.equal(gkRead.data.assessment.requirement_assessment_id, "assessment-row-secret-a");
});

// ---------------------------------------------------------------------------
// Mounted route
// ---------------------------------------------------------------------------

test("route: forwards only the two path ids and the resolved actor; malformed ids are rejected before the service", async () => {
  const actorContext = memberActor("client_contributor");
  const received = [];
  const restoreService = routeTestables.setIntakeServiceForTest({
    getClientFunderRequirements: async (input) => {
      received.push(input);
      return { ok: true, data: { engagementId: ENGAGEMENT, status: "no_target", target: {}, requirementSets: [] } };
    },
  });
  const restoreActor = routeTestables.setActorContextMiddlewareForTest((req, _res, next) => {
    req.kaiSprint2ActorContext = actorContext;
    next();
  });
  const originalFlag = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "true";
  const app = express();
  app.use((req, _res, next) => {
    req.isAuthenticated = () => true;
    req.user = { id: 601 };
    next();
  });
  app.use("/api/kai/sprint2/intake", sprint2IntakeApiRouter);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  try {
    const { port } = server.address();
    const url = (org, eng, query = "") => `http://127.0.0.1:${port}/api/kai/sprint2/intake/admin/organizations/${org}/engagements/${eng}/client-funder-requirements${query}`;
    assert.equal(url(ORG, ENGAGEMENT).endsWith(clientFunderRequirementsPath(ORG, ENGAGEMENT)), true);
    const ok = await fetch(url(ORG, ENGAGEMENT, `?organization_id=${OTHER_ORG}&requirement_id=${REQ_MET}`));
    assert.equal(ok.status, 200);
    assert.deepEqual(received, [{ organizationId: ORG, engagementId: ENGAGEMENT, actorContext }]);
    assert.equal((await fetch(url("not-a-uuid", ENGAGEMENT))).status, 422);
    assert.equal((await fetch(url(ORG, "ABCDEF00-3333-4444-8555-666666666666"))).status, 422);
    assert.equal(received.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    restoreActor();
    restoreService();
    process.env.KAI_SPRINT2_ENABLED = originalFlag;
  }
});

// ---------------------------------------------------------------------------
// Frontend
// ---------------------------------------------------------------------------

const componentSource = readFileSync("frontend/knowledgeStudio/ClientFunderRequirements.jsx", "utf8");
const clientStudioSource = readFileSync("frontend/knowledgeStudio/ClientKnowledgeStudio.jsx", "utf8");

test("frontend projection rejects unknown statuses/readiness and drops anything outside the contract", () => {
  const dto = {
    engagementId: ENGAGEMENT,
    status: "applicable",
    target: { funderId: "f", framework: "w", reviewed_by: "x" },
    requirementSets: [{ requirementSetId: SET_ID, name: "S", funderName: "F", frameworkName: "W", versionLabel: "v1", extra: "x", requirements: [{ requirementId: REQ_MET, label: "L", description: null, readiness: "met", assessment_explanation: "x" }] }],
  };
  const projected = projectClientFunderRequirements(dto);
  assert.equal(projected.requirementSets[0].requirements[0].readiness, "met");
  assert.doesNotMatch(JSON.stringify(projected), /reviewed_by|extra|assessment_explanation/);
  assert.equal(projectClientFunderRequirements({ ...dto, status: "approved" }), null);
  assert.equal(projectClientFunderRequirements({ ...dto, requirementSets: [{ ...dto.requirementSets[0], requirements: [{ requirementId: REQ_MET, readiness: "satisfied" }] }] }), null);
  assert.equal(projectClientFunderRequirements(null), null);
  assert.deepEqual(projectClientFunderRequirements({ ...dto, status: "not_applicable" }).requirementSets, []);
});

test("frontend: the client Funder Requirements tab makes only the client-safe read and offers no assessment or target control", () => {
  assert.equal((componentSource.match(/getJson\(/g) || []).length, 1);
  assert.match(componentSource, /getJson\(clientFunderRequirementsPath\(organizationId, engagementId\)\)/);
  for (const forbidden of [
    "engagementFunderRequirementsPath",
    "organizationRequirementsReadinessPath",
    "organizationRequirementAssessmentPath",
    "projectEngagementFunderRequirements",
    "postJson",
    "fetch(",
    "requirement-target",
    "assessment_explanation",
    "reviewed_by",
  ]) {
    assert.ok(!componentSource.includes(forbidden), forbidden);
  }
  assert.match(componentSource, /\{data && canReviewFollowups \? \(\s*<a className="btn btn-sm btn-outline-primary mt-2" href=\{CLIENT_FOLLOWUP_REVIEW_HREF\}>/);
  assert.match(clientStudioSource, /\["funderRequirements", "Funder Requirements"\]/);
  assert.match(clientStudioSource, /<ClientFunderRequirements\s+organizationId=\{organizationId\}\s+engagementId=\{engagementId\}\s+canReviewFollowups=\{canReviewFollowups\}\s+\/>/);
  assert.doesNotMatch(clientStudioSource, /getJson\(|postJson\(|fetch\(/);
});
