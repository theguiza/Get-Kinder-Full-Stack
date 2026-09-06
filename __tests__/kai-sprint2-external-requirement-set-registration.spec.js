import test from "node:test";
import assert from "node:assert/strict";

import sprint2IntakeApiRouter, { __testables as intakeRouteTestables } from "../Backend/kai/routes/sprint2IntakeApi.js";
import {
  registerExternalRequirementSet,
} from "../Backend/kai/services/kaiExternalRequirementSetRegistrationService.js";
import {
  validateExternalRequirementSetRegistrationPayload,
} from "../Backend/kai/validators/kaiExternalRequirementSetRegistrationValidators.js";

const ORG_A = "00000000-0000-4000-8000-00000000000a";
const ORG_B = "00000000-0000-4000-8000-00000000000b";
const SOURCE_ID = "10000000-0000-4000-8000-000000000001";
const FRAMEWORK_ID = "20000000-0000-4000-8000-000000000001";
const SET_ID = "30000000-0000-4000-8000-000000000001";
const REQUIREMENT_1 = "40000000-0000-4000-8000-000000000001";
const REQUIREMENT_2 = "40000000-0000-4000-8000-000000000002";
const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true" });

const gkAdminActor = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  kaiRoles: ["gk_admin"],
  organizationMemberships: [{ organization_id: ORG_A, membership_status: "active", role_name: "gk_admin" }],
});

const crossTenantGkAdminActor = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000002",
  kaiRoles: ["gk_admin"],
  organizationMemberships: [{ organization_id: ORG_B, membership_status: "active", role_name: "gk_admin" }],
});

const clientAdminActor = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000003",
  kaiRoles: [],
  organizationMemberships: [{ organization_id: ORG_A, membership_status: "active", role_name: "client_admin" }],
});

const systemActor = Object.freeze({ actorType: "system", actorUserId: null, kaiRoles: [], organizationMemberships: [] });

function payload(overrides = {}) {
  return {
    source: {
      source_type: "funder",
      source_code: "city_impact_fund",
      source_name: "City Impact Fund",
    },
    framework: {
      framework_code: "annual_outcomes_v1",
      framework_name: "Annual Outcomes",
      version_label: "v1",
      framework_status: "active",
    },
    requirement_set: {
      set_key: "annual_report",
      set_name: "Annual Report",
    },
    requirements: [
      {
        requirement_key: "outcomes_summary",
        requirement_label: "Outcomes summary",
        requirement_description: "Summarize annual outcomes.",
        display_order: 0,
      },
      {
        requirement_key: "participant_count",
        requirement_label: "Participant count",
        requirement_description: "Report participant count.",
        display_order: 1,
      },
    ],
    ...overrides,
  };
}

function repositoryData({ replayed = false } = {}) {
  return {
    replayed,
    inserted: {
      source: !replayed,
      framework: !replayed,
      requirement_set: !replayed,
      requirements: replayed ? 0 : 2,
    },
    requirement_source: {
      requirement_source_id: SOURCE_ID,
      source_type: "funder",
      source_code: "city_impact_fund",
      source_name: "City Impact Fund",
      organization_id: null,
      created_by: gkAdminActor.actorUserId,
      created_by_type: "human",
      created_at: "2026-09-06T00:00:00.000Z",
    },
    requirement_framework_version: {
      requirement_framework_version_id: FRAMEWORK_ID,
      requirement_source_id: SOURCE_ID,
      framework_code: "annual_outcomes_v1",
      framework_name: "Annual Outcomes",
      version_label: "v1",
      framework_status: "active",
      created_by: gkAdminActor.actorUserId,
      created_by_type: "human",
      created_at: "2026-09-06T00:00:00.000Z",
    },
    requirement_set: {
      requirement_set_id: SET_ID,
      requirement_framework_version_id: FRAMEWORK_ID,
      set_key: "annual_report",
      set_name: "Annual Report",
      created_by: gkAdminActor.actorUserId,
      created_by_type: "human",
      created_at: "2026-09-06T00:00:00.000Z",
    },
    requirements: [
      {
        requirement_id: REQUIREMENT_1,
        requirement_set_id: SET_ID,
        requirement_key: "outcomes_summary",
        requirement_label: "Outcomes summary",
        requirement_description: "Summarize annual outcomes.",
        display_order: 0,
      },
      {
        requirement_id: REQUIREMENT_2,
        requirement_set_id: SET_ID,
        requirement_key: "participant_count",
        requirement_label: "Participant count",
        requirement_description: "Report participant count.",
        display_order: 1,
      },
    ],
  };
}

function createServiceHarness({ repositoryResult = { ok: true, data: repositoryData(), error: null } } = {}) {
  const calls = { transactions: 0, repository: [], audit: [] };
  const tx = { tx: true };
  return {
    calls,
    dependencies: {
      env: enabledEnv,
      async runInTransaction(callback) {
        calls.transactions += 1;
        return callback(tx);
      },
      registrationRepository: {
        async registerExternalRequirementSet(input, db) {
          calls.repository.push({ input, db });
          return repositoryResult;
        },
      },
      async insertRequiredSuccessfulAuditEvent(metadata, db) {
        calls.audit.push({ metadata, db });
        return { ok: true, auditEventId: "audit-1" };
      },
    },
  };
}

function baseInput(overrides = {}) {
  return {
    organizationId: ORG_A,
    payload: payload(),
    actorContext: gkAdminActor,
    ...overrides,
  };
}

test("structured registration payload validator normalizes only source, framework, set, and requirement items", () => {
  const result = validateExternalRequirementSetRegistrationPayload(payload({
    source: { source_type: "funder", source_code: " city_impact_fund ", source_name: " City Impact Fund " },
  }));
  assert.equal(result.ok, true);
  assert.equal(result.data.source.source_code, "city_impact_fund");
  assert.equal(result.data.source.source_name, "City Impact Fund");
});

test("authorized same-tenant registration succeeds and preserves source/provenance identity", async () => {
  const harness = createServiceHarness();
  const result = await registerExternalRequirementSet(baseInput(), harness.dependencies);
  assert.equal(result.ok, true);
  assert.equal(result.data.organization_id, ORG_A);
  assert.equal(result.data.registration_state, "registered");
  assert.equal(result.data.requirement_source.source_type, "funder");
  assert.equal(result.data.requirement_source.source_code, "city_impact_fund");
  assert.equal(result.data.requirement_source.organization_id, null);
  assert.equal(result.data.requirement_framework_version.framework_code, "annual_outcomes_v1");
  assert.equal(result.data.requirement_framework_version.framework_status, "active");
  assert.equal(harness.calls.transactions, 1);
  assert.equal(harness.calls.audit.length, 1);
});

test("requirement items retain the registered requirement_set identity", async () => {
  const harness = createServiceHarness();
  const result = await registerExternalRequirementSet(baseInput(), harness.dependencies);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.requirements.map((requirement) => requirement.requirement_set_id), [SET_ID, SET_ID]);
  assert.deepEqual(
    harness.calls.repository[0].input.requirements.map((requirement) => requirement.requirement_key),
    ["outcomes_summary", "participant_count"],
  );
});

test("unauthorized and non-human actors fail before repository write", async () => {
  const clientHarness = createServiceHarness();
  const clientResult = await registerExternalRequirementSet(
    baseInput({ actorContext: clientAdminActor }),
    clientHarness.dependencies,
  );
  assert.equal(clientResult.ok, false);
  assert.equal(clientResult.error.code, "authorization_denied");
  assert.equal(clientHarness.calls.repository.length, 0);

  const systemHarness = createServiceHarness();
  const systemResult = await registerExternalRequirementSet(
    baseInput({ actorContext: systemActor }),
    systemHarness.dependencies,
  );
  assert.equal(systemResult.ok, false);
  assert.equal(systemResult.error.code, "authorization_denied");
  assert.equal(systemHarness.calls.repository.length, 0);
});

test("cross-tenant registration fails before repository write", async () => {
  const harness = createServiceHarness();
  const result = await registerExternalRequirementSet(
    baseInput({ actorContext: crossTenantGkAdminActor }),
    harness.dependencies,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
  assert.equal(harness.calls.repository.length, 0);
});

test("malformed structured input returns the existing blocker/error shape before write", async () => {
  const harness = createServiceHarness();
  const result = await registerExternalRequirementSet(
    baseInput({ payload: payload({ source: { source_type: "kai_standard", source_code: "x", source_name: "X" } }) }),
    harness.dependencies,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(result.blockers[0].severity, "blocker");
  assert.equal(result.blockers[0].blocking_reason, "source_type_not_external");
  assert.equal(harness.calls.repository.length, 0);
});

test("duplicate/idempotent behavior follows natural-key exact replay and conflict contracts", async () => {
  const replayHarness = createServiceHarness({
    repositoryResult: { ok: true, data: repositoryData({ replayed: true }), error: null },
  });
  const replay = await registerExternalRequirementSet(baseInput(), replayHarness.dependencies);
  assert.equal(replay.ok, true);
  assert.equal(replay.data.replayed, true);
  assert.equal(replayHarness.calls.audit.length, 0);

  const conflictHarness = createServiceHarness({
    repositoryResult: { ok: false, data: null, error: { code: "duplicate_conflict", status: 409 } },
  });
  const conflict = await registerExternalRequirementSet(baseInput(), conflictHarness.dependencies);
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error.code, "duplicate_conflict");
});

test("partial write failure rolls back through the service transaction and leaves no authoritative partial state", async () => {
  const state = { sources: [], frameworks: [], sets: [], requirements: [] };
  const calls = { audit: 0 };
  const dependencies = {
    env: enabledEnv,
    async runInTransaction(callback) {
      const snapshot = JSON.parse(JSON.stringify(state));
      try {
        return await callback({ tx: true });
      } catch (error) {
        Object.assign(state, snapshot);
        throw error;
      }
    },
    registrationRepository: {
      async registerExternalRequirementSet() {
        state.sources.push("source");
        state.frameworks.push("framework");
        return { ok: false, data: null, error: { code: "duplicate_conflict", status: 409 } };
      },
    },
    async insertRequiredSuccessfulAuditEvent() {
      calls.audit += 1;
      return { ok: true };
    },
  };
  const result = await registerExternalRequirementSet(baseInput(), dependencies);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "duplicate_conflict");
  assert.deepEqual(state, { sources: [], frameworks: [], sets: [], requirements: [] });
  assert.equal(calls.audit, 0);
});

test("registration creates no reviewed/current applicability and no assessment authority", async () => {
  const harness = createServiceHarness();
  const result = await registerExternalRequirementSet(baseInput(), harness.dependencies);
  assert.equal(result.ok, true);
  assert.equal(result.data.applicability_created, false);
  assert.equal(result.data.assessment_created, false);
  assert.equal("engagement_requirement_set_id" in result.data, false);
  assert.equal("requirement_assessment_id" in result.data, false);
});

test("route delegates structured registration with sanitized actor context and no SQL", async () => {
  let serviceInput = null;
  const restoreService = intakeRouteTestables.setIntakeServiceForTest({
    async registerExternalRequirementSet(input) {
      serviceInput = input;
      return { ok: true, data: { registration_state: "registered" }, warnings: [] };
    },
  });
  const restoreActor = intakeRouteTestables.setActorContextMiddlewareForTest((req, res, next) => {
    req.kaiSprint2ActorContext = gkAdminActor;
    next();
  });

  try {
    const layer = sprint2IntakeApiRouter.stack.find((candidate) =>
      candidate.route?.path === "/admin/organizations/:organizationId/external-requirement-sets" &&
      candidate.route?.methods?.post
    );
    assert.ok(layer);
    const res = {
      statusCode: null,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        return body;
      },
    };
    const req = {
      params: { organizationId: ORG_A },
      body: payload(),
      headers: { cookie: "session=secret" },
      user: { id: 46, email: "hidden@example.test" },
    };
    await new Promise((resolve, reject) => {
      layer.route.stack[0].handle(req, res, async (error) => {
        if (error) {
          reject(error);
          return;
        }
        try {
          await layer.route.stack[1].handle(req, res);
          resolve();
        } catch (handlerError) {
          reject(handlerError);
        }
      });
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(serviceInput, {
      organizationId: ORG_A,
      payload: payload(),
      actorContext: gkAdminActor,
    });
  } finally {
    restoreActor();
    restoreService();
  }
});
