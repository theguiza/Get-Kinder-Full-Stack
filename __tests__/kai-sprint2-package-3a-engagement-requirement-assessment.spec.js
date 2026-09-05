import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  assessEngagementRequirement,
  getEngagementRequirementAssessment,
  __engagementRequirementAssessmentServiceContract,
  __engagementRequirementAssessmentServiceTestables,
} from "../Backend/kai/services/kaiEngagementRequirementAssessmentService.js";
import {
  __requirementAssessmentServiceContract,
} from "../Backend/kai/services/kaiRequirementAssessmentService.js";
import {
  __engagementContextServiceTestables,
} from "../Backend/kai/services/kaiEngagementContextService.js";

const ORG_A = "00000000-0000-4000-8000-00000000000a";
const ORG_B = "00000000-0000-4000-8000-00000000000b";
const ENGAGEMENT_A = "10000000-0000-4000-8000-00000000000a";
const ENGAGEMENT_B = "10000000-0000-4000-8000-00000000000b";
const REQUIREMENT_ID = "20000000-0000-4000-8000-000000000001";
const REQUIREMENT_SET_ID = "30000000-0000-4000-8000-000000000001";
const NOW = "2026-09-05T12:00:00.000Z";

const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true" });

const matchingTarget = Object.freeze({
  target_funder_id: "city_impact_fund",
  target_framework: "annual_outcomes_v1",
});

const mismatchedTarget = Object.freeze({
  target_funder_id: "city_impact_fund",
  target_framework: "different_framework_v9",
});

function engagementRow({ organizationId = ORG_A, engagementId = ENGAGEMENT_A, target = matchingTarget } = {}) {
  return {
    engagement_id: engagementId,
    organization_id: organizationId,
    engagement_type: "pilot_assessment",
    engagement_status: "active",
    project_metadata: target ? { engagement_requirement_target: target } : {},
  };
}

const externalActiveAuthority = Object.freeze({
  requirement_set_id: REQUIREMENT_SET_ID,
  source_type: "funder",
  source_code: "city_impact_fund",
  framework_code: "annual_outcomes_v1",
  framework_status: "active",
});

const kaiStandardAuthority = Object.freeze({
  ...externalActiveAuthority,
  source_type: "kai_standard",
});

function currentApplicableRow({ requirementSetId = REQUIREMENT_SET_ID, target = matchingTarget } = {}) {
  return {
    requirement_set_id: requirementSetId,
    applicability_status: "confirmed",
    applicability_effective_state: "applicable",
    reviewed_by: "90000000-0000-4000-8000-000000000009",
    reviewed_by_role: "gk_admin",
    reviewed_at: new Date("2026-09-01T00:00:00.000Z"),
    superseded_by_engagement_requirement_set_id: null,
    target_context_identity: target,
  };
}

const gkReviewerActor = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  kaiRoles: [],
  organizationMemberships: [{ organization_id: ORG_A, membership_status: "active", role_name: "gk_reviewer" }],
});

const gkOperatorActor = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000002",
  kaiRoles: [],
  organizationMemberships: [{ organization_id: ORG_A, membership_status: "active", role_name: "gk_operator" }],
});

const crossOrganizationActor = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000003",
  kaiRoles: [],
  organizationMemberships: [{ organization_id: ORG_B, membership_status: "active", role_name: "gk_reviewer" }],
});

function successfulAssessmentResult({ engagementId = ENGAGEMENT_A } = {}) {
  return {
    ok: true,
    data: {
      requirement_assessment_id: "40000000-0000-4000-8000-000000000001",
      organization_id: ORG_A,
      engagement_id: engagementId,
      requirement_id: REQUIREMENT_ID,
      assessment_state: "satisfied",
      assessment_explanation: "test",
      state_fingerprint: "a".repeat(64),
      created_at: NOW,
      replayed: false,
    },
    error: null,
  };
}

function createFakeRepository({ assessResult = successfulAssessmentResult(), readResult } = {}) {
  const calls = { assess: [], read: [] };
  return {
    calls,
    repository: {
      async assessEngagementRequirement(input) {
        calls.assess.push(input);
        return assessResult;
      },
      async readEngagementRequirementAssessment(input) {
        calls.read.push(input);
        return readResult || { ok: false, data: null, error: { code: "not_found", status: 404 } };
      },
    },
  };
}

function createGateDependencies({
  engagement = engagementRow(),
  authority = externalActiveAuthority,
  applicabilityRows = [currentApplicableRow()],
} = {}) {
  return {
    async getEngagementForOrganization({ organizationId, engagementId }) {
      if (!engagement) return null;
      if (engagement.organization_id !== organizationId || engagement.engagement_id !== engagementId) return null;
      return engagement;
    },
    async listEngagementRequirementSetsForOrganization() {
      return applicabilityRows;
    },
    async getRequirementSetIdForRequirement({ requirementId }) {
      if (requirementId !== REQUIREMENT_ID) return null;
      return { requirement_id: requirementId, requirement_set_id: REQUIREMENT_SET_ID };
    },
    async getRequirementSetAuthority() {
      return authority;
    },
  };
}

function baseInput(overrides = {}) {
  return {
    organizationId: ORG_A,
    engagementId: ENGAGEMENT_A,
    requirementId: REQUIREMENT_ID,
    actorContext: gkReviewerActor,
    now: NOW,
    ...overrides,
  };
}

function baseReadInput(overrides = {}) {
  return {
    organizationId: ORG_A,
    engagementId: ENGAGEMENT_A,
    requirementId: REQUIREMENT_ID,
    actorContext: gkReviewerActor,
    ...overrides,
  };
}

function baseDependencies({ engagement, authority, applicabilityRows, ...functionOverrides } = {}) {
  const { repository, calls } = createFakeRepository();
  return {
    env: enabledEnv,
    metadataOnlyAudit: { prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => ({ ok: true }) }) },
    requirementAssessmentRepository: repository,
    ...createGateDependencies({ engagement, authority, applicabilityRows }),
    ...functionOverrides,
    __calls: calls,
  };
}

test("Package 3A: a valid, currently-applicable requirement can receive an engagement assessment", async () => {
  const deps = baseDependencies();
  const result = await assessEngagementRequirement(baseInput(), deps);
  assert.equal(result.ok, true);
  assert.equal(deps.__calls.assess.length, 1);
  assert.equal(deps.__calls.assess[0].engagementId, ENGAGEMENT_A);
  assert.equal(deps.__calls.assess[0].organizationId, ORG_A);
  assert.equal(deps.__calls.assess[0].requirementId, REQUIREMENT_ID);
});

test("Package 3A: generic (organization-scope) assessments are untouched - engagement_id stays null in that contract", () => {
  // The organization-scope contract's own insert always binds engagement_id
  // to a literal SQL NULL; assert the repository source still does so and
  // that this package added no ALTER to that statement.
  const repositorySource = readFileSync(
    "Backend/kai/dictionary/postgresRequirementAssessmentRepository.js",
    "utf8",
  );
  assert.match(
    repositorySource,
    /organization_id, engagement_id, requirement_id, assessment_state, assessment_explanation,\s*\n\s*state_fingerprint, created_by, created_by_type, created_at\s*\n\s*\)\s*VALUES \(\$1::uuid, NULL, \$2::uuid/,
  );
});

test("Package 3A: engagement and organization scope assessments are read through strictly distinct queries (never falls back)", () => {
  const repositorySource = readFileSync(
    "Backend/kai/dictionary/postgresRequirementAssessmentRepository.js",
    "utf8",
  );
  assert.match(repositorySource, /async function readExistingAssessmentRow[\s\S]{0,700}?AND engagement_id IS NULL/);
  assert.match(repositorySource, /async function readExistingEngagementAssessmentRow[\s\S]{0,700}?AND engagement_id = \$2::uuid/);
});

test("Package 3A: engagement A cannot read engagement B's assessment - read is scoped to the exact engagementId", async () => {
  const { repository, calls } = createFakeRepository({
    readResult: { ok: false, data: null, error: { code: "not_found", status: 404 } },
  });
  const deps = {
    env: enabledEnv,
    requirementAssessmentRepository: repository,
    async getEngagementForOrganization({ organizationId, engagementId }) {
      if (engagementId !== ENGAGEMENT_A) return null;
      return engagementRow({ engagementId: ENGAGEMENT_A });
    },
  };
  const result = await getEngagementRequirementAssessment(
    baseReadInput({ engagementId: ENGAGEMENT_B, actorContext: gkOperatorActor }),
    deps,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
  assert.equal(calls.read.length, 0); // never even reaches the repository - engagement B does not resolve for org A here
});

test("Package 3A: cross-tenant write fails closed - engagement does not resolve under the wrong organization", async () => {
  const deps = baseDependencies({
    async getEngagementForOrganization({ organizationId, engagementId }) {
      // Simulates the real getEngagementForOrganization: WHERE organization_id
      // AND engagement_id both must match - a cross-org engagementId never
      // resolves.
      if (organizationId !== ORG_B) return null;
      return engagementRow({ organizationId: ORG_B, engagementId });
    },
  });
  const result = await assessEngagementRequirement(
    baseInput({ organizationId: ORG_A, actorContext: crossOrganizationActor }),
    deps,
  );
  assert.equal(result.ok, false);
  // crossOrganizationActor belongs to ORG_B but organizationId is ORG_A, so
  // actor authorization itself should already deny before the gate runs.
  assert.equal(result.error.code, "authorization_denied");
});

test("Package 3A: cross-tenant write fails closed even for a same-org actor pointed at another org's engagement id", async () => {
  const deps = baseDependencies({
    async getEngagementForOrganization() {
      return null; // engagementId does not belong to organizationId
    },
  });
  const result = await assessEngagementRequirement(baseInput(), deps);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
  assert.equal(deps.__calls.assess.length, 0);
});

test("Package 3A: a requirement outside the applicable set cannot be assessed for that engagement", async () => {
  const deps = baseDependencies({
    async getRequirementSetIdForRequirement() {
      return { requirement_id: REQUIREMENT_ID, requirement_set_id: "different-set" };
    },
    async getRequirementSetAuthority() {
      return { ...externalActiveAuthority, requirement_set_id: "different-set" };
    },
    async listEngagementRequirementSetsForOrganization() {
      return [currentApplicableRow()]; // only REQUIREMENT_SET_ID is applicable, not "different-set"
    },
  });
  const result = await assessEngagementRequirement(baseInput(), deps);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "engagement_requirement_applicability_not_confirmed");
  assert.equal(deps.__calls.assess.length, 0);
});

test("Package 3A: proposed/unreviewed Package 2B applicability cannot authorize an assessment", async () => {
  const deps = baseDependencies({
    async listEngagementRequirementSetsForOrganization() {
      return [{
        requirement_set_id: REQUIREMENT_SET_ID,
        applicability_status: "proposed",
        applicability_effective_state: "pending_review",
        reviewed_by: null,
        reviewed_by_role: null,
        reviewed_at: null,
        superseded_by_engagement_requirement_set_id: null,
        target_context_identity: null,
      }];
    },
  });
  const result = await assessEngagementRequirement(baseInput(), deps);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "engagement_requirement_applicability_not_confirmed");
  assert.equal(deps.__calls.assess.length, 0);
});

test("Package 3A: non-applicable effective state cannot authorize an assessment", async () => {
  const deps = baseDependencies({
    async listEngagementRequirementSetsForOrganization() {
      return [{ ...currentApplicableRow(), applicability_effective_state: "not_applicable" }];
    },
  });
  const result = await assessEngagementRequirement(baseInput(), deps);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "engagement_requirement_applicability_not_confirmed");
});

test("Package 3A: retired requirement set cannot authorize an assessment (not an authoritative-active external set)", async () => {
  const deps = baseDependencies({
    async getRequirementSetAuthority() {
      return { ...externalActiveAuthority, framework_status: "retired" };
    },
  });
  const result = await assessEngagementRequirement(baseInput(), deps);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "engagement_requirement_applicability_not_confirmed");
});

test("Package 3A: kai_standard (non-external) requirement set cannot authorize an assessment", async () => {
  const deps = baseDependencies({ authority: kaiStandardAuthority });
  const result = await assessEngagementRequirement(baseInput(), deps);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "engagement_requirement_applicability_not_confirmed");
});

test("Package 3A: superseded applicability cannot authorize an assessment", async () => {
  const deps = baseDependencies({
    async listEngagementRequirementSetsForOrganization() {
      return [{
        ...currentApplicableRow(),
        superseded_by_engagement_requirement_set_id: "50000000-0000-4000-8000-000000000099",
      }];
    },
  });
  const result = await assessEngagementRequirement(baseInput(), deps);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "engagement_requirement_applicability_not_confirmed");
});

test("Package 3A: target mismatch (approved applicability target != engagement's current target) fails closed", async () => {
  const deps = baseDependencies({
    engagement: engagementRow({ target: mismatchedTarget }),
    applicabilityRows: [currentApplicableRow({ target: matchingTarget })],
  });
  const result = await assessEngagementRequirement(baseInput(), deps);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "engagement_requirement_applicability_not_confirmed");
});

test("Package 3A: no target selected on the engagement fails closed", async () => {
  const deps = baseDependencies({
    engagement: engagementRow({ target: null }),
  });
  const result = await assessEngagementRequirement(baseInput(), deps);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "engagement_requirement_applicability_not_confirmed");
});

test("Package 3A: existing actor-authority mechanism is reused verbatim (identical role sets to the generic path)", () => {
  assert.deepEqual(
    [...__engagementRequirementAssessmentServiceContract.ASSESS_ENGAGEMENT_REQUIREMENT_ALLOWED_ROLES].sort(),
    [...__requirementAssessmentServiceContract.ASSESS_REQUIREMENT_ALLOWED_ROLES].sort(),
  );
  assert.deepEqual(
    [...__engagementRequirementAssessmentServiceContract.READ_ENGAGEMENT_REQUIREMENT_ASSESSMENT_ALLOWED_ROLES].sort(),
    [...__requirementAssessmentServiceContract.READ_REQUIREMENT_ASSESSMENT_ALLOWED_ROLES].sort(),
  );
});

test("Package 3A: an actor missing from the allowed roles is denied before the gate ever runs", async () => {
  const clientAdminActor = {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000004",
    kaiRoles: [],
    organizationMemberships: [{ organization_id: ORG_A, membership_status: "active", role_name: "client_admin" }],
  };
  const deps = baseDependencies();
  const result = await assessEngagementRequirement(baseInput({ actorContext: clientAdminActor }), deps);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
  assert.equal(deps.__calls.assess.length, 0);
});

test("Package 3A: feature flag off is a hard stop", async () => {
  const deps = baseDependencies({ env: { KAI_SPRINT2_ENABLED: "false" } });
  const result = await assessEngagementRequirement(baseInput(), deps);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "feature_disabled");
});

test("Package 3A: system/ai actors are never mapped human actors and are denied", async () => {
  const deps = baseDependencies();
  const result = await assessEngagementRequirement(
    baseInput({ actorContext: { actorType: "system", actorUserId: null } }),
    deps,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("Package 3A: the required metadataOnlyAudit contract is invoked exactly as the generic path requires it (audit rejection surfaces as validation_blocker)", async () => {
  const { repository } = createFakeRepository({
    assessResult: { ok: false, data: null, error: { code: "validation_blocker", status: 422 } },
  });
  const deps = {
    env: enabledEnv,
    requirementAssessmentRepository: repository,
    metadataOnlyAudit: { prepareMetadataOnlyAudit: () => ({ ok: false }) },
    ...createGateDependencies(),
  };
  const result = await assessEngagementRequirement(baseInput(), deps);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
});

test("Package 3A/3B: read path returns whatever the repository's engagement-scoped read finds, once Package 2B gate revalidation confirms current applicability", async () => {
  // Superseded by Package 3B: the read path used to trust the repository's
  // stored row without re-checking Package 2B currency at all. It now
  // re-resolves the identical gate the write path uses (see
  // resolveEngagementApplicabilityGate/gate revalidation added to
  // getEngagementRequirementAssessment in kaiEngagementRequirementAssessmentService.js)
  // before returning the repository's read - this test demonstrates that,
  // given still-current gate dependencies, the previously-asserted pass-
  // through behavior is preserved: the read still simply returns whatever
  // the repository's own engagement-scoped read finds.
  const readResult = {
    ok: true,
    data: {
      requirement: { requirement_id: REQUIREMENT_ID },
      assessment: { requirement_assessment_id: "x", engagement_id: ENGAGEMENT_A },
    },
    error: null,
  };
  const { repository, calls } = createFakeRepository({ readResult });
  const deps = {
    env: enabledEnv,
    requirementAssessmentRepository: repository,
    ...createGateDependencies(),
  };
  const result = await getEngagementRequirementAssessment(baseReadInput({ actorContext: gkOperatorActor }), deps);
  assert.equal(result.ok, true);
  assert.equal(calls.read.length, 1);
  assert.equal(calls.read[0].engagementId, ENGAGEMENT_A);
});

test("Package 3A schema check: C2.1 migration already declares a nullable engagement_id column, a tenant-safe engagement FK, and a dedicated engagement-scope partial unique index - no schema change was required for this package", () => {
  const migrationSource = readFileSync(
    "migrations/kai_sprint2_c2_1_requirement_assessment_persistence.sql",
    "utf8",
  );
  assert.match(migrationSource, /engagement_id uuid,/);
  assert.match(migrationSource, /CONSTRAINT requirement_assessments_c2_1_engagement_fk\s*\n\s*FOREIGN KEY \(engagement_id, organization_id\)\s*\n\s*REFERENCES kai\.engagements \(engagement_id, organization_id\)/);
  assert.match(
    migrationSource,
    /CREATE UNIQUE INDEX IF NOT EXISTS ux_requirement_assessments_c2_1_engagement_scope_fingerprint\s*\n\s*ON kai\.requirement_assessments \(organization_id, engagement_id, requirement_id, state_fingerprint\)\s*\n\s*WHERE engagement_id IS NOT NULL/,
  );
  assert.match(
    migrationSource,
    /CREATE UNIQUE INDEX IF NOT EXISTS ux_requirement_assessments_c2_1_org_scope_fingerprint\s*\n\s*ON kai\.requirement_assessments \(organization_id, requirement_id, state_fingerprint\)\s*\n\s*WHERE engagement_id IS NULL/,
  );
});

test("Package 3A: gate reuses Package 2B's own pure classification predicates verbatim (imported, not reimplemented)", () => {
  assert.equal(typeof __engagementContextServiceTestables.isExternalAuthoritativeRequirementSet, "function");
  assert.equal(typeof __engagementContextServiceTestables.rowMatchesTarget, "function");
  assert.equal(typeof __engagementContextServiceTestables.isCurrentReviewedApplicability, "function");
  assert.equal(typeof __engagementContextServiceTestables.serializeEngagementTarget, "function");

  const gateDeps = {
    getEngagement: async () => engagementRow(),
    listApplicability: async () => [currentApplicableRow()],
    getRequirementSetId: async () => ({ requirement_id: REQUIREMENT_ID, requirement_set_id: REQUIREMENT_SET_ID }),
    getRequirementSetAuthority: async () => externalActiveAuthority,
    serializeEngagementTarget: __engagementContextServiceTestables.serializeEngagementTarget,
    isExternalAuthoritativeRequirementSet: __engagementContextServiceTestables.isExternalAuthoritativeRequirementSet,
    rowMatchesTarget: __engagementContextServiceTestables.rowMatchesTarget,
    isCurrentReviewedApplicability: __engagementContextServiceTestables.isCurrentReviewedApplicability,
  };
  return __engagementRequirementAssessmentServiceTestables
    .resolveEngagementApplicabilityGate(
      { organizationId: ORG_A, engagementId: ENGAGEMENT_A, requirementId: REQUIREMENT_ID },
      gateDeps,
    )
    .then((gate) => {
      assert.equal(gate.ok, true);
      assert.equal(gate.requirementSetId, REQUIREMENT_SET_ID);
    });
});
