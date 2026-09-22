import test from "node:test";
import assert from "node:assert/strict";

import {
  createImprovementPractice,
  listImprovementPracticesForOrganizationOperation,
  getImprovementPracticeOperation,
  updateImprovementPracticeFieldsOperation,
  updateImprovementPracticeStatusOperation,
  __improvementPracticeServiceContract,
} from "../Backend/kai/services/kaiImprovementPracticeService.js";

const ORG_A = "00000000-0000-4000-8000-00000000000a";
const ORG_B = "00000000-0000-4000-8000-00000000000b";
const ENGAGEMENT_A = "00000000-0000-4000-8000-0000000000e1";
const PRACTICE_ID = "00000000-0000-4000-8000-000000000101";
const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true" });

const clientAdminActor = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  organizationMemberships: [{ organization_id: ORG_A, membership_status: "active", role_name: "client_admin" }],
});

function baseRow(overrides = {}) {
  return {
    improvement_practice_id: PRACTICE_ID,
    organization_id: ORG_A,
    engagement_id: null,
    gap_log_item_id: null,
    title: "Quarterly data-quality check-in",
    rationale: "Keeps evidence current for the next funder report.",
    status: "recommended",
    cadence: "quarterly",
    next_due_date: null,
    responsible_actor_user_id: null,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function createHarness({
  insertResult = { ok: true, practice: baseRow() },
  auditResult = { ok: true },
  listRows = [baseRow()],
  getRow = baseRow(),
  updateFieldsResult = { ok: true, practice: baseRow({ title: "Updated title" }) },
  updateStatusResult = { ok: true, practice: baseRow({ status: "active" }) },
} = {}) {
  const calls = { transactions: 0, insert: [], audit: [], list: [], get: [], updateFields: [], updateStatus: [] };
  const tx = { tx: true };
  return {
    calls,
    dependencies: {
      env: enabledEnv,
      async runInTransaction(callback) {
        calls.transactions += 1;
        return callback(tx);
      },
      async insertImprovementPractice(input, db) {
        calls.insert.push({ input, db });
        return insertResult;
      },
      async insertRequiredSuccessfulAuditEvent(metadata, db) {
        calls.audit.push({ metadata, db });
        return auditResult;
      },
      async listImprovementPracticesForOrganization(input) {
        calls.list.push(input);
        return listRows;
      },
      async getImprovementPracticeForOrganization(input) {
        calls.get.push(input);
        return getRow;
      },
      async updateImprovementPracticeFields(input, db) {
        calls.updateFields.push({ input, db });
        return updateFieldsResult;
      },
      async updateImprovementPracticeStatus(input, db) {
        calls.updateStatus.push({ input, db });
        return updateStatusResult;
      },
    },
  };
}

test("createImprovementPractice is disabled when KAI_SPRINT2_ENABLED is not true", async () => {
  const harness = createHarness();
  const result = await createImprovementPractice(
    { organizationId: ORG_A, title: "t", rationale: "r", cadence: "monthly", actorContext: clientAdminActor },
    { ...harness.dependencies, env: {} },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "feature_disabled");
  assert.equal(harness.calls.transactions, 0);
});

test("createImprovementPractice rejects a missing title/rationale/cadence before any repository call", async () => {
  const harness = createHarness();
  const result = await createImprovementPractice(
    { organizationId: ORG_A, title: "", rationale: "r", cadence: "monthly", actorContext: clientAdminActor },
    harness.dependencies,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(harness.calls.transactions, 0);
});

test("createImprovementPractice rejects an unapproved cadence value before any repository call", async () => {
  const harness = createHarness();
  const result = await createImprovementPractice(
    { organizationId: ORG_A, title: "t", rationale: "r", cadence: "biweekly", actorContext: clientAdminActor },
    harness.dependencies,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(harness.calls.transactions, 0);
});

test("createImprovementPractice denies an actor authorized only for a different organization, before any repository call", async () => {
  const harness = createHarness();
  const result = await createImprovementPractice(
    { organizationId: ORG_B, title: "t", rationale: "r", cadence: "monthly", actorContext: clientAdminActor },
    harness.dependencies,
  );
  assert.equal(result.ok, false);
  assert.equal(harness.calls.transactions, 0);
});

test("createImprovementPractice creates the practice inside one transaction and records the required audit event before returning success", async () => {
  const harness = createHarness();
  const result = await createImprovementPractice(
    {
      organizationId: ORG_A,
      engagementId: ENGAGEMENT_A,
      title: "Quarterly data-quality check-in",
      rationale: "Keeps evidence current for the next funder report.",
      cadence: "quarterly",
      actorContext: clientAdminActor,
    },
    harness.dependencies,
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.improvement_practice_id, PRACTICE_ID);
  assert.equal(harness.calls.transactions, 1);
  assert.equal(harness.calls.insert.length, 1);
  assert.equal(harness.calls.insert[0].input.organizationId, ORG_A);
  assert.equal(harness.calls.insert[0].input.createdByUserId, clientAdminActor.actorUserId);
  assert.equal(harness.calls.audit.length, 1);
  assert.equal(harness.calls.audit[0].metadata.operation, "create_improvement_practice");
  assert.equal(harness.calls.audit[0].metadata.object_type, "other");
  assert.equal(harness.calls.audit[0].metadata.target_object_type, "improvement_practice");
});

test("createImprovementPractice fails the whole operation if the required audit insert is rejected", async () => {
  const harness = createHarness({ auditResult: { ok: false } });
  const result = await createImprovementPractice(
    { organizationId: ORG_A, title: "t", rationale: "r", cadence: "monthly", actorContext: clientAdminActor },
    harness.dependencies,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "audit_payload_rejected");
});

test("listImprovementPracticesForOrganizationOperation is organization-scoped and passes through an optional engagement filter", async () => {
  const harness = createHarness();
  const result = await listImprovementPracticesForOrganizationOperation(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, actorContext: clientAdminActor },
    harness.dependencies,
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.length, 1);
  assert.equal(harness.calls.list[0].organizationId, ORG_A);
  assert.equal(harness.calls.list[0].engagementId, ENGAGEMENT_A);
});

test("getImprovementPracticeOperation returns not_found for a missing practice", async () => {
  const harness = createHarness({ getRow: null });
  const result = await getImprovementPracticeOperation(
    { organizationId: ORG_A, improvementPracticeId: PRACTICE_ID, actorContext: clientAdminActor },
    harness.dependencies,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
});

test("updateImprovementPracticeFieldsOperation requires expectedUpdatedAt and maps a conflict to conflict_current_state_changed", async () => {
  const harness = createHarness({ updateFieldsResult: { ok: false, error_code: "conflict_current_state_changed" } });
  const result = await updateImprovementPracticeFieldsOperation(
    {
      organizationId: ORG_A,
      improvementPracticeId: PRACTICE_ID,
      expectedUpdatedAt: "2026-09-01T00:00:00.000Z",
      title: "New title",
      rationale: "New rationale",
      cadence: "monthly",
      actorContext: clientAdminActor,
    },
    harness.dependencies,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict_current_state_changed");
  assert.equal(harness.calls.audit.length, 0, "must not audit a write that did not happen");
});

test("updateImprovementPracticeFieldsOperation succeeds and records the required audit event", async () => {
  const harness = createHarness();
  const result = await updateImprovementPracticeFieldsOperation(
    {
      organizationId: ORG_A,
      improvementPracticeId: PRACTICE_ID,
      expectedUpdatedAt: "2026-09-01T00:00:00.000Z",
      title: "Updated title",
      rationale: "Keeps evidence current for the next funder report.",
      cadence: "quarterly",
      actorContext: clientAdminActor,
    },
    harness.dependencies,
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.title, "Updated title");
  assert.equal(harness.calls.audit[0].metadata.operation, "update_improvement_practice_fields");
});

test("updateImprovementPracticeStatusOperation rejects an unapproved status value before any repository call", async () => {
  const harness = createHarness();
  const result = await updateImprovementPracticeStatusOperation(
    {
      organizationId: ORG_A,
      improvementPracticeId: PRACTICE_ID,
      expectedUpdatedAt: "2026-09-01T00:00:00.000Z",
      status: "archived",
      actorContext: clientAdminActor,
    },
    harness.dependencies,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(harness.calls.transactions, 0);
});

test("updateImprovementPracticeStatusOperation succeeds and records the required audit event with the resulting status", async () => {
  const harness = createHarness();
  const result = await updateImprovementPracticeStatusOperation(
    {
      organizationId: ORG_A,
      improvementPracticeId: PRACTICE_ID,
      expectedUpdatedAt: "2026-09-01T00:00:00.000Z",
      status: "active",
      actorContext: clientAdminActor,
    },
    harness.dependencies,
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.status, "active");
  assert.equal(harness.calls.audit[0].metadata.operation, "update_improvement_practice_status");
  assert.equal(harness.calls.audit[0].metadata.resulting_status, "active");
});

test("Improvement Practice operations are authorized for the same role set as every other engagement-scoped operation (gk_admin/gk_operator/client_admin)", () => {
  assert.deepEqual(
    [...__improvementPracticeServiceContract.IMPROVEMENT_PRACTICE_ALLOWED_ROLES].sort(),
    ["client_admin", "gk_admin", "gk_operator"],
  );
});
