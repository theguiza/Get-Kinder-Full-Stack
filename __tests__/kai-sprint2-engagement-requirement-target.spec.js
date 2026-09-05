import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  classifyEngagementFunderRequirementsState,
  listAuthorizedEngagements,
  updateEngagementRequirementTarget,
  __engagementContextServiceContract,
  __engagementContextServiceTestables,
} from "../Backend/kai/services/kaiEngagementContextService.js";

const ORG_A = "00000000-0000-4000-8000-00000000000a";
const ORG_B = "00000000-0000-4000-8000-00000000000b";
const ENGAGEMENT_A = "10000000-0000-4000-8000-00000000000a";
const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true" });
const kaiQueriesSource = readFileSync("Backend/kai/db/kaiQueries.js", "utf8");
const requirementAssessmentRepositorySource = readFileSync("Backend/kai/dictionary/postgresRequirementAssessmentRepository.js", "utf8");

const gkOperatorActor = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  kaiRoles: ["gk_operator"],
  organizationMemberships: [{ organization_id: ORG_A, membership_status: "active", role_name: "gk_operator" }],
});

const clientAdminActor = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000002",
  organizationMemberships: [{ organization_id: ORG_A, membership_status: "active", role_name: "client_admin" }],
});

const crossOrganizationActor = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000003",
  organizationMemberships: [{ organization_id: ORG_B, membership_status: "active", role_name: "client_admin" }],
});

const validTarget = Object.freeze({
  target_funder_id: "city_impact_fund",
  target_framework: "annual_outcomes_v1",
  grant_program_identity: "Youth Impact Grant 2026",
  report_identity: "Annual outcomes report",
  reporting_template_identity: "Template 2026-A",
  reporting_period_start: "2026-01-01",
  reporting_period_end: "2026-12-31",
});

const activeExternalRequirementSet = Object.freeze({
  requirement_set_id: "20000000-0000-4000-8000-000000000001",
  set_key: "annual_outcomes",
  set_name: "Annual Outcomes",
  requirement_framework_version_id: "30000000-0000-4000-8000-000000000001",
  framework_code: "annual_outcomes_v1",
  framework_name: "Annual Outcomes",
  version_label: "v1",
  framework_status: "active",
  requirement_source_id: "40000000-0000-4000-8000-000000000001",
  source_type: "funder",
  source_code: "city_impact_fund",
  source_name: "City Impact Fund",
  requirement_count: 2,
  requirements: [
    { requirement_id: "60000000-0000-4000-8000-000000000001", requirement_key: "fund_outcome_001" },
    { requirement_id: "60000000-0000-4000-8000-000000000002", requirement_key: "fund_output_001" },
  ],
});

function createHarness({
  initialMetadata = { preserved_existing_key: "keep" },
  storedOrganizationId = ORG_A,
  auditResult = { ok: true, auditEventId: "audit-1" },
} = {}) {
  const calls = {
    transactions: 0,
    read: [],
    update: [],
    audit: [],
  };
  const tx = { tx: true };
  return {
    calls,
    dependencies: {
      env: enabledEnv,
      async runInTransaction(callback) {
        calls.transactions += 1;
        return callback(tx);
      },
      async getEngagementForOrganization(input, db) {
        calls.read.push({ input, db });
        return {
          engagement_id: input.engagementId,
          organization_id: storedOrganizationId,
          engagement_type: "pilot_assessment",
          engagement_status: "draft",
          project_metadata: initialMetadata,
        };
      },
      async updateEngagementProjectMetadata(input, db) {
        calls.update.push({ input, db });
        return {
          engagement_id: input.engagementId,
          organization_id: input.organizationId,
          engagement_type: "pilot_assessment",
          engagement_status: "draft",
          project_metadata: input.projectMetadata,
        };
      },
      async insertRequiredSuccessfulAuditEvent(metadata, db) {
        calls.audit.push({ metadata, db });
        return auditResult;
      },
    },
  };
}

function createClassifierHarness({
  target = validTarget,
  engagementOrganizationId = ORG_A,
  authorityRows = [activeExternalRequirementSet],
  applicabilityRows = [],
} = {}) {
  const calls = {
    engagementReads: [],
    authorityReads: [],
    applicabilityReads: [],
  };
  return {
    calls,
    dependencies: {
      env: enabledEnv,
      async getEngagementForOrganization(input) {
        calls.engagementReads.push(input);
        return {
          engagement_id: input.engagementId,
          organization_id: engagementOrganizationId,
          engagement_type: "pilot_assessment",
          engagement_status: "draft",
          project_metadata: { engagement_requirement_target: target },
        };
      },
      async listExternalRequirementSetsForTarget(input) {
        calls.authorityReads.push(input);
        return authorityRows;
      },
      async listEngagementRequirementSetsForOrganization(input) {
        calls.applicabilityReads.push(input);
        return applicabilityRows;
      },
    },
  };
}

test("engagement target contract exposes exactly the approved controlled metadata namespace and target fields", () => {
  assert.equal(
    __engagementContextServiceContract.ENGAGEMENT_REQUIREMENT_TARGET_METADATA_KEY,
    "engagement_requirement_target",
  );
  assert.deepEqual(Object.keys(__engagementContextServiceContract.TARGET_FIELD_DEFINITIONS).sort(), [
    "grant_program_identity",
    "report_identity",
    "reporting_period_end",
    "reporting_period_start",
    "reporting_template_identity",
    "target_framework",
    "target_funder_id",
  ]);
});

test("requirement authority reader uses the governed hierarchy, active framework status, and excludes generic kai_standard sources", () => {
  const reader = kaiQueriesSource.match(/export async function listExternalRequirementSetsForTarget[\s\S]*?^}/m)?.[0];
  assert.ok(reader);
  assert.match(reader, /FROM kai\.requirement_sets rs/);
  assert.match(reader, /JOIN kai\.requirement_framework_versions rfv/);
  assert.match(reader, /JOIN kai\.requirement_sources src/);
  assert.match(reader, /LEFT JOIN kai\.requirements r/);
  assert.match(reader, /jsonb_build_object\(\s*'requirement_id'/);
  assert.match(reader, /src\.source_type <> 'kai_standard'/);
  assert.match(reader, /rfv\.framework_status = 'active'/);
  assert.match(reader, /src\.source_code = \$1/);
  assert.match(reader, /rfv\.framework_code = \$2/);
});

test("engagement applicability reader is organization scoped and read-only over existing engagement_requirement_sets", () => {
  const reader = kaiQueriesSource.match(/export async function listEngagementRequirementSetsForOrganization[\s\S]*?^}/m)?.[0];
  assert.ok(reader);
  assert.match(reader, /FROM kai\.engagement_requirement_sets ers/);
  assert.match(reader, /ers\.reviewed_by::text AS reviewed_by/);
  assert.match(reader, /ers\.applicability_effective_state/);
  assert.match(reader, /ers\.target_context_identity/);
  assert.match(reader, /successor\.engagement_requirement_set_id::text AS superseded_by_engagement_requirement_set_id/);
  assert.match(reader, /WHERE ers\.organization_id = \$1\s+AND ers\.engagement_id = \$2/);
  assert.doesNotMatch(reader, /\bINSERT\b|\bUPDATE\b|\bDELETE\b/);
});

test("package 1 read foundation adds no schema, applicability write, requirement write, or assessment write", () => {
  const packageSources = [
    kaiQueriesSource,
    readFileSync("Backend/kai/services/kaiEngagementContextService.js", "utf8"),
    readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8"),
  ].join("\n");
  assert.doesNotMatch(packageSources, /CREATE TABLE|ALTER TABLE|DROP TABLE/);
  assert.doesNotMatch(packageSources, /INSERT INTO kai\.engagement_requirement_sets|UPDATE kai\.engagement_requirement_sets|DELETE FROM kai\.engagement_requirement_sets/);
  assert.doesNotMatch(packageSources, /INSERT INTO kai\.requirements|UPDATE kai\.requirements|DELETE FROM kai\.requirements/);
  assert.doesNotMatch(packageSources, /INSERT INTO kai\.requirement_assessments|UPDATE kai\.requirement_assessments|DELETE FROM kai\.requirement_assessments/);
});

test("Package 2A does not create engagement-specific requirement assessments", () => {
  const insertAssessmentRow = requirementAssessmentRepositorySource.match(/async function insertAssessmentRow[\s\S]*?^}/m)?.[0];
  assert.ok(insertAssessmentRow);
  assert.match(insertAssessmentRow, /organization_id, engagement_id, requirement_id/);
  assert.match(insertAssessmentRow, /VALUES \(\$1::uuid, NULL, \$2::uuid/);
  assert.match(insertAssessmentRow, /WHERE engagement_id IS NULL/);
});

test("valid engagement target write updates only the controlled project_metadata namespace and writes required audit in the same transaction", async () => {
  const harness = createHarness();
  const result = await updateEngagementRequirementTarget(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, actorContext: gkOperatorActor, target: validTarget },
    harness.dependencies,
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.data.requirement_target, validTarget);
  assert.equal(harness.calls.transactions, 1);
  assert.equal(harness.calls.read[0].input.lockForUpdate, true);
  assert.strictEqual(harness.calls.read[0].db, harness.calls.update[0].db);
  assert.strictEqual(harness.calls.update[0].db, harness.calls.audit[0].db);
  assert.deepEqual(harness.calls.update[0].input.projectMetadata, {
    preserved_existing_key: "keep",
    engagement_requirement_target: validTarget,
  });
  assert.equal(harness.calls.audit[0].metadata.operation, "update_engagement_requirement_target");
  assert.equal(harness.calls.audit[0].metadata.organization_id, ORG_A);
  assert.equal(harness.calls.audit[0].metadata.engagement_id, ENGAGEMENT_A);
});

test("engagement target read returns the governed target when present without leaking arbitrary project_metadata", async () => {
  const result = await listAuthorizedEngagements(
    { organizationId: ORG_A, actorContext: clientAdminActor },
    {
      env: enabledEnv,
      listEngagementsForOrganization: async () => [{
        engagement_id: ENGAGEMENT_A,
        organization_id: ORG_A,
        engagement_type: "pilot_assessment",
        engagement_status: "draft",
        project_metadata: {
          engagement_requirement_target: validTarget,
          arbitrary_notes: "must not leak",
        },
      }],
    },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.items, [{
    engagement_id: ENGAGEMENT_A,
    organization_id: ORG_A,
    engagement_type: "pilot_assessment",
    engagement_status: "draft",
    requirement_target: validTarget,
  }]);
});

test("absent optional engagement target fields are valid and stored as an empty governed target", async () => {
  const harness = createHarness();
  const result = await updateEngagementRequirementTarget(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, actorContext: clientAdminActor, target: {} },
    harness.dependencies,
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.data.requirement_target, {});
  assert.deepEqual(harness.calls.update[0].input.projectMetadata.engagement_requirement_target, {});
});

test("invalid controlled target values are rejected before any read, write, transaction, or audit", async () => {
  const harness = createHarness();
  const result = await updateEngagementRequirementTarget(
    {
      organizationId: ORG_A,
      engagementId: ENGAGEMENT_A,
      actorContext: gkOperatorActor,
      target: { ...validTarget, reporting_period_start: "2026-13-01" },
    },
    harness.dependencies,
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(harness.calls.transactions, 0);
  assert.equal(harness.calls.read.length, 0);
  assert.equal(harness.calls.update.length, 0);
  assert.equal(harness.calls.audit.length, 0);
});

test("arbitrary target metadata cannot be written through the governed target service", async () => {
  const harness = createHarness();
  const result = await updateEngagementRequirementTarget(
    {
      organizationId: ORG_A,
      engagementId: ENGAGEMENT_A,
      actorContext: gkOperatorActor,
      target: { ...validTarget, arbitrary_json_patch: "not allowed" },
    },
    harness.dependencies,
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(harness.calls.transactions, 0);
});

test("engagement target write rejects cross-organization actors before persistence", async () => {
  const harness = createHarness();
  const result = await updateEngagementRequirementTarget(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, actorContext: crossOrganizationActor, target: validTarget },
    harness.dependencies,
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
  assert.equal(harness.calls.transactions, 0);
});

test("engagement target write rejects a resolved engagement from another organization and does not update metadata", async () => {
  const harness = createHarness({ storedOrganizationId: ORG_B });
  const result = await updateEngagementRequirementTarget(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, actorContext: gkOperatorActor, target: validTarget },
    harness.dependencies,
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "tenant_boundary_violation");
  assert.equal(harness.calls.read.length, 1);
  assert.equal(harness.calls.update.length, 0);
  assert.equal(harness.calls.audit.length, 0);
});

test("existing engagement list behavior remains valid for rows without target metadata", async () => {
  const result = await listAuthorizedEngagements(
    { organizationId: ORG_A, actorContext: gkOperatorActor },
    {
      env: enabledEnv,
      listEngagementsForOrganization: async () => [{
        engagement_id: ENGAGEMENT_A,
        organization_id: ORG_A,
        extra: "must not leak",
      }],
    },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.data.items, [{
    engagement_id: ENGAGEMENT_A,
    organization_id: ORG_A,
    engagement_type: null,
    engagement_status: null,
    requirement_target: {},
  }]);
});

test("target validation never accepts requirement data as an inferred engagement target", () => {
  const result = __engagementContextServiceTestables.normalizeEngagementRequirementTarget({
    requirement_set_id: "requirement-set-sentinel",
    requirement_source_id: "requirement-source-sentinel",
  });
  assert.equal(result.ok, false);
  assert.equal(result.blockers[0].blocking_reason, "unknown_target_field");
});

test("classifier state 1: no_target_selected is proven without reading requirement authority or applicability", async () => {
  const harness = createClassifierHarness({ target: {}, authorityRows: [], applicabilityRows: [] });
  const result = await classifyEngagementFunderRequirementsState(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, actorContext: clientAdminActor },
    harness.dependencies,
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.state, "no_target_selected");
  assert.deepEqual(result.data.target, {});
  assert.deepEqual(result.data.authoritative_requirement_sets, []);
  assert.deepEqual(result.data.applicability_rows, []);
  assert.equal(harness.calls.authorityReads.length, 0);
  assert.equal(harness.calls.applicabilityReads.length, 0);
});

test("classifier state 2: target_selected_no_authoritative_requirement_set excludes generic kai_standard authority", async () => {
  const target = {
    target_funder_id: validTarget.target_funder_id,
    target_framework: validTarget.target_framework,
  };
  const harness = createClassifierHarness({
    target,
    authorityRows: [{
      ...activeExternalRequirementSet,
      source_type: "kai_standard",
      source_code: validTarget.target_funder_id,
    }],
  });
  const result = await classifyEngagementFunderRequirementsState(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, actorContext: gkOperatorActor },
    harness.dependencies,
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.state, "target_selected_no_authoritative_requirement_set");
  assert.deepEqual(result.data.authoritative_requirement_sets, []);
  assert.equal(harness.calls.authorityReads.length, 1);
  assert.deepEqual(harness.calls.authorityReads[0], {
    sourceCode: validTarget.target_funder_id,
    frameworkCode: validTarget.target_framework,
  });
  assert.equal(harness.calls.applicabilityReads.length, 0);
});

test("classifier state 3: target dimensions can be matched through Package 2A approved target-context identity", async () => {
  const harness = createClassifierHarness();
  const result = await classifyEngagementFunderRequirementsState(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, actorContext: clientAdminActor },
    harness.dependencies,
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.state, "authoritative_requirement_set_not_applicable");
  assert.equal(result.data.authoritative_requirement_sets.length, 1);
  assert.equal(harness.calls.authorityReads.length, 1);
});

test("classifier state 3: authoritative_requirement_set_not_applicable is proven when active external authority exists but no current applicability can be proven", async () => {
  const target = {
    target_funder_id: validTarget.target_funder_id,
    target_framework: validTarget.target_framework,
  };
  const harness = createClassifierHarness({ target });
  const result = await classifyEngagementFunderRequirementsState(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, actorContext: gkOperatorActor },
    harness.dependencies,
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.state, "authoritative_requirement_set_not_applicable");
  assert.deepEqual(result.data.authoritative_requirement_sets, [{
    requirement_set_id: activeExternalRequirementSet.requirement_set_id,
    set_key: "annual_outcomes",
    requirement_count: 2,
    requirements: [
      { requirement_id: "60000000-0000-4000-8000-000000000001", requirement_key: "fund_outcome_001" },
      { requirement_id: "60000000-0000-4000-8000-000000000002", requirement_key: "fund_output_001" },
    ],
    requirement_framework_version: {
      requirement_framework_version_id: activeExternalRequirementSet.requirement_framework_version_id,
      framework_code: validTarget.target_framework,
      version_label: "v1",
      framework_status: "active",
    },
    requirement_source: {
      requirement_source_id: activeExternalRequirementSet.requirement_source_id,
      source_type: "funder",
      source_code: validTarget.target_funder_id,
    },
  }]);
  assert.deepEqual(result.data.applicable_requirement_sets, []);
  assert.equal(result.data.applicability_conclusion, "none");
});

test("mere applicability-row existence does not establish reviewed/current applicability without required persistence provenance", async () => {
  const target = {
    target_funder_id: validTarget.target_funder_id,
    target_framework: validTarget.target_framework,
  };
  const harness = createClassifierHarness({
    target,
    applicabilityRows: [{
      engagement_requirement_set_id: "50000000-0000-4000-8000-000000000001",
      organization_id: ORG_A,
      engagement_id: ENGAGEMENT_A,
      requirement_set_id: activeExternalRequirementSet.requirement_set_id,
      applicability_status: "confirmed",
      created_by_type: "human",
      created_at: "2026-09-05T00:00:00.000Z",
      ...activeExternalRequirementSet,
    }],
  });
  const result = await classifyEngagementFunderRequirementsState(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, actorContext: gkOperatorActor },
    harness.dependencies,
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.state, "authoritative_requirement_set_not_applicable");
  assert.equal(result.data.applicability_conclusion, "NOT_CONFIRMED");
  assert.equal(result.data.applicability_rows[0].applicability_status, "confirmed");
  assert.equal(result.data.applicability_rows[0].applicability_conclusion, "NOT_CONFIRMED");
  assert.deepEqual(result.data.applicable_requirement_sets, []);
  assert.deepEqual(result.data.not_confirmed_states, ["applicable_requirement_set_assessment_not_available"]);
  assert.deepEqual(result.data.missing_persistence, [
    "reviewed_by",
    "reviewed_at",
    "current_effective_state",
    "superseded_by_or_replaced_by",
    "target_snapshot_at_approval",
  ]);
});

test("Package 2A proposed unreviewed applicability does not qualify", async () => {
  const target = {
    target_funder_id: validTarget.target_funder_id,
    target_framework: validTarget.target_framework,
  };
  const harness = createClassifierHarness({
    target,
    applicabilityRows: [{
      engagement_requirement_set_id: "50000000-0000-4000-8000-000000000006",
      organization_id: ORG_A,
      engagement_id: ENGAGEMENT_A,
      requirement_set_id: activeExternalRequirementSet.requirement_set_id,
      applicability_status: "proposed",
      applicability_effective_state: "pending_review",
      reviewed_by: null,
      reviewed_by_role: null,
      reviewed_at: null,
      superseded_by_engagement_requirement_set_id: null,
      target_context_identity: null,
      created_by_type: "human",
      created_at: "2026-09-05T00:00:00.000Z",
      ...activeExternalRequirementSet,
    }],
  });
  const result = await classifyEngagementFunderRequirementsState(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, actorContext: gkOperatorActor },
    harness.dependencies,
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.state, "authoritative_requirement_set_not_applicable");
  assert.equal(result.data.applicability_rows[0].applicability_conclusion, "NOT_CONFIRMED");
  assert.deepEqual(result.data.applicable_requirement_sets, []);
});

test("Package 2A reviewed non-current and retired applicability do not qualify", async () => {
  const target = {
    target_funder_id: validTarget.target_funder_id,
    target_framework: validTarget.target_framework,
  };
  for (const row of [
    {
      engagement_requirement_set_id: "50000000-0000-4000-8000-000000000007",
      applicability_status: "confirmed",
      applicability_effective_state: "not_applicable",
      superseded_by_engagement_requirement_set_id: null,
    },
    {
      engagement_requirement_set_id: "50000000-0000-4000-8000-000000000008",
      applicability_status: "retired",
      applicability_effective_state: "retired",
      superseded_by_engagement_requirement_set_id: null,
    },
  ]) {
    const harness = createClassifierHarness({
      target,
      applicabilityRows: [{
        organization_id: ORG_A,
        engagement_id: ENGAGEMENT_A,
        requirement_set_id: activeExternalRequirementSet.requirement_set_id,
        reviewed_by: gkOperatorActor.actorUserId,
        reviewed_by_role: "gk_operator",
        reviewed_at: "2026-09-05T00:00:00.000Z",
        target_context_identity: target,
        created_by_type: "human",
        created_at: "2026-09-05T00:00:00.000Z",
        ...activeExternalRequirementSet,
        ...row,
      }],
    });
    const result = await classifyEngagementFunderRequirementsState(
      { organizationId: ORG_A, engagementId: ENGAGEMENT_A, actorContext: gkOperatorActor },
      harness.dependencies,
    );

    assert.equal(result.ok, true, row.applicability_effective_state);
    assert.equal(result.data.state, "authoritative_requirement_set_not_applicable", row.applicability_effective_state);
    assert.notEqual(result.data.applicability_rows[0].applicability_conclusion, "CURRENT_APPLICABLE");
    assert.deepEqual(result.data.applicable_requirement_sets, []);
  }
});

test("Package 2A reviewed current applicable row establishes applicable_requirement_set_assessment_not_available", async () => {
  const target = {
    target_funder_id: validTarget.target_funder_id,
    target_framework: validTarget.target_framework,
  };
  const harness = createClassifierHarness({
    target,
    applicabilityRows: [{
      engagement_requirement_set_id: "50000000-0000-4000-8000-000000000003",
      organization_id: ORG_A,
      engagement_id: ENGAGEMENT_A,
      requirement_set_id: activeExternalRequirementSet.requirement_set_id,
      applicability_status: "confirmed",
      applicability_effective_state: "applicable",
      reviewed_by: gkOperatorActor.actorUserId,
      reviewed_by_role: "gk_operator",
      reviewed_at: "2026-09-05T00:00:00.000Z",
      supersedes_engagement_requirement_set_id: null,
      superseded_by_engagement_requirement_set_id: null,
      target_context_identity: target,
      created_by_type: "human",
      created_at: "2026-09-05T00:00:00.000Z",
      ...activeExternalRequirementSet,
    }],
  });
  const result = await classifyEngagementFunderRequirementsState(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, actorContext: gkOperatorActor },
    harness.dependencies,
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.state, "applicable_requirement_set_assessment_not_available");
  assert.equal(result.data.applicability_conclusion, "CURRENT_APPLICABLE");
  assert.equal(result.data.applicability_rows[0].applicability_conclusion, "CURRENT_APPLICABLE");
  assert.equal(result.data.applicable_requirement_sets[0].requirement_set_id, activeExternalRequirementSet.requirement_set_id);
  assert.deepEqual(result.data.not_confirmed_states, []);
  assert.deepEqual(result.data.missing_persistence, []);
});

test("Package 2A superseded or stale-target rows do not establish current applicability", async () => {
  const target = {
    target_funder_id: validTarget.target_funder_id,
    target_framework: validTarget.target_framework,
  };
  const harness = createClassifierHarness({
    target,
    applicabilityRows: [{
      engagement_requirement_set_id: "50000000-0000-4000-8000-000000000004",
      organization_id: ORG_A,
      engagement_id: ENGAGEMENT_A,
      requirement_set_id: activeExternalRequirementSet.requirement_set_id,
      applicability_status: "confirmed",
      applicability_effective_state: "applicable",
      reviewed_by: gkOperatorActor.actorUserId,
      reviewed_by_role: "gk_operator",
      reviewed_at: "2026-09-05T00:00:00.000Z",
      superseded_by_engagement_requirement_set_id: "50000000-0000-4000-8000-000000000005",
      target_context_identity: { ...target, target_framework: "old_framework" },
      created_by_type: "human",
      created_at: "2026-09-05T00:00:00.000Z",
      ...activeExternalRequirementSet,
    }],
  });
  const result = await classifyEngagementFunderRequirementsState(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, actorContext: gkOperatorActor },
    harness.dependencies,
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.state, "authoritative_requirement_set_not_applicable");
  assert.equal(result.data.applicability_rows[0].applicability_conclusion, "NOT_CONFIRMED");
  assert.deepEqual(result.data.applicable_requirement_sets, []);
});

test("target mismatch on an applicability row fails closed rather than inheriting old applicability", async () => {
  const target = {
    target_funder_id: validTarget.target_funder_id,
    target_framework: validTarget.target_framework,
  };
  const harness = createClassifierHarness({
    target,
    applicabilityRows: [{
      engagement_requirement_set_id: "50000000-0000-4000-8000-000000000002",
      organization_id: ORG_A,
      engagement_id: ENGAGEMENT_A,
      requirement_set_id: activeExternalRequirementSet.requirement_set_id,
      applicability_status: "confirmed",
      created_by_type: "human",
      created_at: "2026-09-05T00:00:00.000Z",
      ...activeExternalRequirementSet,
      source_code: "prior_target",
    }],
  });
  const result = await classifyEngagementFunderRequirementsState(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, actorContext: gkOperatorActor },
    harness.dependencies,
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.state, "authoritative_requirement_set_not_applicable");
  assert.deepEqual(result.data.applicability_rows, []);
  assert.deepEqual(result.data.applicable_requirement_sets, []);
});

test("classifier rejects cross-organization actors before reading engagement, authority, or applicability", async () => {
  const harness = createClassifierHarness();
  const result = await classifyEngagementFunderRequirementsState(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, actorContext: crossOrganizationActor },
    harness.dependencies,
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
  assert.equal(harness.calls.engagementReads.length, 0);
  assert.equal(harness.calls.authorityReads.length, 0);
  assert.equal(harness.calls.applicabilityReads.length, 0);
});

test("classifier rejects an engagement resolved under another organization before authority or applicability reads", async () => {
  const harness = createClassifierHarness({
    target: {
      target_funder_id: validTarget.target_funder_id,
      target_framework: validTarget.target_framework,
    },
    engagementOrganizationId: ORG_B,
  });
  const result = await classifyEngagementFunderRequirementsState(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, actorContext: gkOperatorActor },
    harness.dependencies,
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "tenant_boundary_violation");
  assert.equal(harness.calls.engagementReads.length, 1);
  assert.equal(harness.calls.authorityReads.length, 0);
  assert.equal(harness.calls.applicabilityReads.length, 0);
});
