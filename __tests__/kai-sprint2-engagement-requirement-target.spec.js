import test from "node:test";
import assert from "node:assert/strict";

import {
  listAuthorizedEngagements,
  updateEngagementRequirementTarget,
  __engagementContextServiceContract,
  __engagementContextServiceTestables,
} from "../Backend/kai/services/kaiEngagementContextService.js";

const ORG_A = "00000000-0000-4000-8000-00000000000a";
const ORG_B = "00000000-0000-4000-8000-00000000000b";
const ENGAGEMENT_A = "10000000-0000-4000-8000-00000000000a";
const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true" });

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
  target_funder_id: "funder:city-impact-fund",
  target_framework: "framework:annual-outcomes-v1",
  grant_program_identity: "Youth Impact Grant 2026",
  report_identity: "Annual outcomes report",
  reporting_template_identity: "Template 2026-A",
  reporting_period_start: "2026-01-01",
  reporting_period_end: "2026-12-31",
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
