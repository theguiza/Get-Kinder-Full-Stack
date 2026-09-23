import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  updateEngagementProjectDetails,
  __engagementContextServiceContract,
  __engagementContextServiceTestables,
} from "../Backend/kai/services/kaiEngagementContextService.js";

/**
 * KAI Impact Library redesign, Package F completeness repair
 * (project_status/use_case_type). Determination: of the controlling
 * Engagement-as-Project contract's seven Project/use-case metadata
 * concepts, engagement_type/reporting_period_start/reporting_period_end/
 * target_funder_id/target_framework were already covered by prior packages.
 * use_case_type and project_status were genuinely absent. Bounded inspection
 * of the real, committed production schema capture
 * (artifacts/kai-db-reconciliation-2026-09-16/PRODUCTION_KAI_SCHEMA.json)
 * showed kai.engagements is a pre-existing "bootstrap-only foundation" table
 * (not one this repository's migrations construct/evolve) - its extra
 * production-only columns (use_case_type, reporting_period_start/end,
 * target_funder_id, target_framework) are NOT part of the tracked/
 * reproducible "expected executable schema" this repository's local
 * ephemeral-Postgres tests build against, so writing to them directly would
 * not be honestly testable here and was not done. project_status, however,
 * is exactly the controlling contract's name for the already-existing,
 * already-tracked engagement_status column/enum (Project is the user-facing
 * name for kai.engagements throughout this codebase - the same convention).
 * use_case_type is stored in the existing project_metadata jsonb bucket
 * (the same mechanism engagement_requirement_target already uses), reusing
 * that bucket's existing "identifier" validation pattern rather than
 * inventing a new taxonomy. No schema/migration change.
 */

const ORG_A = "00000000-0000-4000-8000-00000000000a";
const ORG_B = "00000000-0000-4000-8000-00000000000b";
const ENGAGEMENT_A = "10000000-0000-4000-8000-00000000000a";
const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true" });

const clientAdminActor = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  organizationMemberships: [{ organization_id: ORG_A, membership_status: "active", role_name: "client_admin" }],
});

const crossOrganizationActor = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000002",
  organizationMemberships: [{ organization_id: ORG_B, membership_status: "active", role_name: "client_admin" }],
});

function createHarness({
  storedOrganizationId = ORG_A,
  initialMetadata = { engagement_requirement_target: { target_funder_id: "city_impact_fund" } },
  auditResult = { ok: true },
} = {}) {
  const calls = { transactions: 0, read: [], update: [], audit: [] };
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
      async updateEngagementProjectFields(input, db) {
        calls.update.push({ input, db });
        return {
          engagement_id: input.engagementId,
          organization_id: input.organizationId,
          engagement_type: "pilot_assessment",
          engagement_status: input.engagementStatus || "draft",
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

test("updateEngagementProjectDetails is disabled when KAI_SPRINT2_ENABLED is not true", async () => {
  const harness = createHarness();
  const result = await updateEngagementProjectDetails(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, projectStatus: "active", actorContext: clientAdminActor },
    { ...harness.dependencies, env: {} },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "feature_disabled");
  assert.equal(harness.calls.transactions, 0);
});

test("updateEngagementProjectDetails rejects an update with neither useCaseType nor projectStatus, before any repository call", async () => {
  const harness = createHarness();
  const result = await updateEngagementProjectDetails(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, actorContext: clientAdminActor },
    harness.dependencies,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(harness.calls.transactions, 0);
});

test("updateEngagementProjectDetails rejects a useCaseType that does not match the existing project_metadata identifier pattern, before any repository call", async () => {
  const harness = createHarness();
  const result = await updateEngagementProjectDetails(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, useCaseType: "Not Valid!", actorContext: clientAdminActor },
    harness.dependencies,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(harness.calls.transactions, 0);
});

test("updateEngagementProjectDetails rejects a projectStatus value outside kai.engagement_status_enum's real production vocabulary with a structured validation_blocker, before any repository call", async () => {
  const harness = createHarness();
  const result = await updateEngagementProjectDetails(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, projectStatus: "not_a_real_status", actorContext: clientAdminActor },
    harness.dependencies,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(result.error.status, 422);
  assert.equal(harness.calls.transactions, 0);
});

test("updateEngagementProjectDetails denies an actor authorized only for a different organization, before any repository call", async () => {
  const harness = createHarness();
  const result = await updateEngagementProjectDetails(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, projectStatus: "active", actorContext: crossOrganizationActor },
    harness.dependencies,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
  assert.equal(harness.calls.transactions, 0);
});

test("updateEngagementProjectDetails updates project_status (engagement_status) inside one transaction, preserving existing project_metadata keys, and records the required audit event", async () => {
  const harness = createHarness();
  const result = await updateEngagementProjectDetails(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, projectStatus: "active", actorContext: clientAdminActor },
    harness.dependencies,
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.project_status, "active");
  assert.equal(result.data.engagement_status, "active");
  assert.equal(harness.calls.transactions, 1);
  assert.equal(harness.calls.update.length, 1);
  assert.equal(harness.calls.update[0].input.engagementStatus, "active");
  assert.deepEqual(harness.calls.update[0].input.projectMetadata, {
    engagement_requirement_target: { target_funder_id: "city_impact_fund" },
  });
  assert.equal(harness.calls.audit.length, 1);
  assert.equal(harness.calls.audit[0].metadata.operation, "update_engagement_project_details");
});

test("updateEngagementProjectDetails sets use_case_type into project_metadata without disturbing engagement_requirement_target", async () => {
  const harness = createHarness();
  const result = await updateEngagementProjectDetails(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, useCaseType: "funder_case_packet", actorContext: clientAdminActor },
    harness.dependencies,
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.use_case_type, "funder_case_packet");
  assert.deepEqual(harness.calls.update[0].input.projectMetadata, {
    engagement_requirement_target: { target_funder_id: "city_impact_fund" },
    use_case_type: "funder_case_packet",
  });
  assert.equal(harness.calls.update[0].input.engagementStatus, null);
});

test("updateEngagementProjectDetails can clear use_case_type by passing null explicitly", async () => {
  const harness = createHarness({
    initialMetadata: { use_case_type: "evidence_library_build" },
  });
  const result = await updateEngagementProjectDetails(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, useCaseType: null, actorContext: clientAdminActor },
    harness.dependencies,
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.use_case_type, null);
  assert.deepEqual(harness.calls.update[0].input.projectMetadata, {});
});

test("updateEngagementProjectDetails fails the whole operation (required audit) if the audit insert itself is rejected", async () => {
  const harness = createHarness({ auditResult: { ok: false } });
  const result = await updateEngagementProjectDetails(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, projectStatus: "active", actorContext: clientAdminActor },
    harness.dependencies,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "audit_payload_rejected");
});

test("updateEngagementProjectDetails is authorized for the same role set as every other engagement operation in this file", () => {
  assert.deepEqual(
    [...__engagementContextServiceContract.UPDATE_ENGAGEMENT_PROJECT_DETAILS_ALLOWED_ROLES].sort(),
    ["client_admin", "gk_admin", "gk_operator"],
  );
});

test("serializeEngagementTarget exposes project_status as the same value as engagement_status - not a fabricated second status", () => {
  const dto = __engagementContextServiceTestables.serializeEngagementTarget({
    engagement_id: ENGAGEMENT_A,
    organization_id: ORG_A,
    engagement_status: "paused",
    project_metadata: {},
  });
  assert.equal(dto.project_status, "paused");
  assert.equal(dto.project_status, dto.engagement_status);
});

test("serializeEngagementTarget exposes use_case_type only when it matches the validated identifier pattern - never a raw/corrupt value", () => {
  const valid = __engagementContextServiceTestables.serializeEngagementTarget({
    engagement_id: ENGAGEMENT_A,
    organization_id: ORG_A,
    project_metadata: { use_case_type: "readiness_self_check" },
  });
  assert.equal(valid.use_case_type, "readiness_self_check");

  const invalid = __engagementContextServiceTestables.serializeEngagementTarget({
    engagement_id: ENGAGEMENT_A,
    organization_id: ORG_A,
    project_metadata: { use_case_type: "Not Valid!" },
  });
  assert.equal(invalid.use_case_type, null);

  const absent = __engagementContextServiceTestables.serializeEngagementTarget({
    engagement_id: ENGAGEMENT_A,
    organization_id: ORG_A,
    project_metadata: {},
  });
  assert.equal(absent.use_case_type, null);
});

test("determination: kai.engagements is a pre-existing bootstrap-only foundation table in the committed production schema capture, not one this repository's migrations construct - its production-only columns are not part of the tracked/reproducible schema this repository can safely write to", () => {
  const provenance = JSON.parse(
    readFileSync("artifacts/kai-db-reconciliation-2026-09-16/schema_table_provenance.json", "utf8"),
  );
  const engagementsRow = provenance.tables.find((row) => row.table === "engagements");
  assert.ok(engagementsRow);
  assert.equal(engagementsRow.classification, "BOOTSTRAP_ONLY_FOUNDATION");

  const expectedSchema = JSON.parse(
    readFileSync("artifacts/kai-db-reconciliation-2026-09-16/EXPECTED_EXECUTABLE_SCHEMA.json", "utf8"),
  );
  const expectedEngagementColumns = expectedSchema.columns
    .filter((column) => column.table_name === "engagements")
    .map((column) => column.column_name);
  assert.ok(!expectedEngagementColumns.includes("use_case_type"));
  assert.ok(expectedEngagementColumns.includes("project_metadata"));
});
