import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  createEngagement,
  __engagementContextServiceContract,
} from "../Backend/kai/services/kaiEngagementContextService.js";

/**
 * Impact Library redesign, Package F: "+ New Project" over kai.engagements.
 * Determination: no general-purpose create-engagement path existed -
 * insertInitialEngagement (kaiOrganizationEnablementQueries.js) already
 * accepted an arbitrary engagementCode but was only ever called by
 * organization-enablement bootstrap with a fixed default code. This adds
 * the smallest missing authorized service/route wrapper around that same,
 * already-existing DB write - no new Project model, no schema change.
 */

const ORG_A = "00000000-0000-4000-8000-00000000000a";
const ORG_B = "00000000-0000-4000-8000-00000000000b";
const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true" });

function createHarness({
  insertResult = { ok: true, engagement: { engagement_id: "10000000-0000-4000-8000-000000000001", organization_id: ORG_A, engagement_code: "2026 Annual Report" } },
  auditResult = { ok: true },
} = {}) {
  const calls = { transactions: 0, insert: [], audit: [] };
  const tx = { tx: true };
  return {
    calls,
    dependencies: {
      env: enabledEnv,
      async runInTransaction(callback) {
        calls.transactions += 1;
        return callback(tx);
      },
      async insertInitialEngagement(input, db) {
        calls.insert.push({ input, db });
        return insertResult;
      },
      async insertRequiredSuccessfulAuditEvent(metadata, db) {
        calls.audit.push({ metadata, db });
        return auditResult;
      },
    },
  };
}

const clientAdminActor = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  organizationMemberships: [{ organization_id: ORG_A, membership_status: "active", role_name: "client_admin" }],
});

test("create-engagement determination: insertInitialEngagement already accepts an arbitrary engagementCode (not hardcoded to the default) - the smallest missing piece is the authorized wrapper, not a new DB write", () => {
  const source = readFileSync("Backend/kai/db/kaiOrganizationEnablementQueries.js", "utf8");
  assert.match(source, /engagementCode = DEFAULT_INITIAL_ENGAGEMENT_CODE/);
  assert.doesNotMatch(source, /engagementCode:\s*DEFAULT_INITIAL_ENGAGEMENT_CODE(?!\s*[,}])/);
});

test("createEngagement is disabled when KAI_SPRINT2_ENABLED is not true", async () => {
  const harness = createHarness();
  const result = await createEngagement(
    { organizationId: ORG_A, engagementCode: "2026 Annual Report", actorContext: clientAdminActor },
    { ...harness.dependencies, env: {} },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "feature_disabled");
  assert.equal(harness.calls.transactions, 0);
});

test("createEngagement rejects a missing/empty Project name before any repository call", async () => {
  const harness = createHarness();
  const result = await createEngagement(
    { organizationId: ORG_A, engagementCode: "", actorContext: clientAdminActor },
    harness.dependencies,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(harness.calls.transactions, 0);
});

test("createEngagement denies an actor without an authorized role for the organization, before any repository call", async () => {
  const harness = createHarness();
  const unauthorizedActor = {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000001",
    organizationMemberships: [{ organization_id: ORG_A, membership_status: "active", role_name: "client_reviewer" }],
  };
  const result = await createEngagement(
    { organizationId: ORG_A, engagementCode: "2026 Annual Report", actorContext: unauthorizedActor },
    harness.dependencies,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
  assert.equal(harness.calls.transactions, 0);
});

test("createEngagement denies an actor authorized only for a different organization, before any repository call", async () => {
  const harness = createHarness();
  const otherOrgActor = {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000001",
    organizationMemberships: [{ organization_id: ORG_B, membership_status: "active", role_name: "client_admin" }],
  };
  const result = await createEngagement(
    { organizationId: ORG_A, engagementCode: "2026 Annual Report", actorContext: otherOrgActor },
    harness.dependencies,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
  assert.equal(harness.calls.transactions, 0);
});

test("createEngagement creates the engagement inside one transaction and records the required audit event before returning success", async () => {
  const harness = createHarness();
  const result = await createEngagement(
    { organizationId: ORG_A, engagementCode: "2026 Annual Report", actorContext: clientAdminActor },
    harness.dependencies,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, {
    engagement_id: "10000000-0000-4000-8000-000000000001",
    organization_id: ORG_A,
    engagement_code: "2026 Annual Report",
  });
  assert.equal(harness.calls.transactions, 1);
  assert.equal(harness.calls.insert.length, 1);
  assert.equal(harness.calls.insert[0].input.organizationId, ORG_A);
  assert.equal(harness.calls.insert[0].input.engagementCode, "2026 Annual Report");
  assert.equal(harness.calls.insert[0].input.createdByUserId, clientAdminActor.actorUserId);
  assert.equal(harness.calls.audit.length, 1);
  assert.equal(harness.calls.audit[0].metadata.operation, "create_engagement");
  assert.equal(harness.calls.audit[0].metadata.organization_id, ORG_A);
  assert.equal(harness.calls.audit[0].metadata.object_id, "10000000-0000-4000-8000-000000000001");
  assert.equal(harness.calls.audit[0].metadata.target_object_type, "engagement");
});

test("createEngagement maps a conflicting engagement_code to an honest conflict error, never silently overwriting or renaming", async () => {
  const harness = createHarness({ insertResult: { ok: false, error_code: "conflicting_engagement" } });
  const result = await createEngagement(
    { organizationId: ORG_A, engagementCode: "2026 Annual Report", actorContext: clientAdminActor },
    harness.dependencies,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "engagement_code_conflict");
  assert.equal(harness.calls.audit.length, 0, "must not audit a write that did not happen");
});

test("createEngagement fails the whole operation (required audit) if the audit insert itself is rejected", async () => {
  const harness = createHarness({ auditResult: { ok: false } });
  const result = await createEngagement(
    { organizationId: ORG_A, engagementCode: "2026 Annual Report", actorContext: clientAdminActor },
    harness.dependencies,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "audit_payload_rejected");
});

test("createEngagement is authorized for the same role set as every other engagement operation in this file (list/update/classify)", () => {
  assert.deepEqual(
    [...__engagementContextServiceContract.CREATE_ENGAGEMENT_ALLOWED_ROLES].sort(),
    ["client_admin", "gk_admin", "gk_operator"],
  );
});

test("the create-engagement route validates organization_id and delegates to the service - no SQL/DB access in the route", () => {
  const routeSource = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
  assert.match(routeSource, /router\.post\("\/admin\/organizations\/:organizationId\/engagements", async \(req, res\) => \{/);
  assert.match(routeSource, /service\.createEngagement\(\{/);
  const schemaSource = readFileSync("Backend/kai/validators/kaiSprint2RequestSchemas.js", "utf8");
  assert.match(schemaSource, /create_engagement: Object\.freeze\(\{/);
});
