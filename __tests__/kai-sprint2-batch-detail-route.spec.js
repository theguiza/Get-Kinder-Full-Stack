import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";

import express from "express";

import { requireKaiSprint2Enabled } from "../Backend/kai/config/kaiSprint2Config.js";
import {
  getIntakeBatchDetail as readIntakeBatchDetail,
} from "../Backend/kai/db/kaiReadModels.js";
import { requireKaiSprint2Authenticated } from "../Backend/kai/middleware/kaiSprint2Authentication.js";
import { buildKaiError } from "../Backend/kai/errors/kaiErrors.js";
import {
  handleKaiSprint2JsonParserError,
  kaiSprint2ActorMutationLimiter,
  kaiSprint2MetadataJsonParser,
  kaiSprint2OrganizationMutationLimiter,
  setKaiSprint2NoStore,
} from "../Backend/kai/middleware/kaiSprint2RequestSafety.js";
import sprint2IntakeApiRouter, {
  __testables as intakeRouteTestables,
} from "../Backend/kai/routes/sprint2IntakeApi.js";
import {
  getIntakeBatchDetail,
} from "../Backend/kai/services/kaiIntakeService.js";

const basePath = "/api/kai/sprint2/intake";
const organizationId = "a5d17c5a-c55f-43af-9b21-fe63aafe733f";
const otherOrganizationId = "b5d17c5a-c55f-43af-9b21-fe63aafe733f";
const engagementId = "2e426ea1-2be3-4e48-b80f-9783ddbacda0";
const intakeBatchId = "8e426ea1-2be3-4e48-b80f-9783ddbacda0";
const forbiddenRowSentinels = Object.freeze({
  idempotency_key: "idempotency-key-sentinel",
  source_system_name: "source-system-name-sentinel",
  source_system_ref: "source-system-ref-sentinel",
  notes: "notes-sentinel",
  batch_metadata: Object.freeze({ marker: "batch-metadata-sentinel" }),
  storage_provider: "storage-provider-sentinel",
  storage_bucket: "storage-bucket-sentinel",
  storage_object_key: "storage-object-key-sentinel",
  storage_uri: "storage-uri-sentinel",
  signed_url: "signed-url-sentinel",
  raw_content: "raw-content-sentinel",
  client_data: Object.freeze({ marker: "client-data-sentinel" }),
  unapproved_pii: Object.freeze({ marker: "unapproved-pii-sentinel" }),
});
const safeBatchRow = Object.freeze({
  intake_batch_id: intakeBatchId,
  organization_id: organizationId,
  engagement_id: engagementId,
  batch_code: "BATCH-DETAIL-001",
  processing_status: "received",
  review_status: "proposed",
  created_at: "2026-07-15T10:00:00.000Z",
  updated_at: "2026-07-15T11:00:00.000Z",
  idempotency_key: forbiddenRowSentinels.idempotency_key,
  source_system_name: forbiddenRowSentinels.source_system_name,
  source_system_ref: forbiddenRowSentinels.source_system_ref,
  notes: forbiddenRowSentinels.notes,
  batch_metadata: forbiddenRowSentinels.batch_metadata,
  storage_provider: forbiddenRowSentinels.storage_provider,
  storage_bucket: forbiddenRowSentinels.storage_bucket,
  storage_object_key: forbiddenRowSentinels.storage_object_key,
  storage_uri: forbiddenRowSentinels.storage_uri,
  signed_url: forbiddenRowSentinels.signed_url,
  raw_content: forbiddenRowSentinels.raw_content,
  client_data: forbiddenRowSentinels.client_data,
  unapproved_pii: forbiddenRowSentinels.unapproved_pii,
});
const crossTenantBatchRow = Object.freeze({
  intake_batch_id: intakeBatchId,
  organization_id: otherOrganizationId,
  engagement_id: engagementId,
  batch_code: "BATCH-DETAIL-001",
  processing_status: "received",
  review_status: "proposed",
  created_at: "2026-07-15T10:00:00.000Z",
  updated_at: "2026-07-15T11:00:00.000Z",
  idempotency_key: forbiddenRowSentinels.idempotency_key,
  source_system_name: forbiddenRowSentinels.source_system_name,
  source_system_ref: forbiddenRowSentinels.source_system_ref,
  notes: forbiddenRowSentinels.notes,
  batch_metadata: forbiddenRowSentinels.batch_metadata,
  storage_provider: forbiddenRowSentinels.storage_provider,
  storage_bucket: forbiddenRowSentinels.storage_bucket,
  storage_object_key: forbiddenRowSentinels.storage_object_key,
  storage_uri: forbiddenRowSentinels.storage_uri,
  signed_url: forbiddenRowSentinels.signed_url,
  raw_content: forbiddenRowSentinels.raw_content,
  client_data: forbiddenRowSentinels.client_data,
  unapproved_pii: forbiddenRowSentinels.unapproved_pii,
});
const expectedBatchDto = Object.freeze({
  intake_batch_id: intakeBatchId,
  organization_id: organizationId,
  engagement_id: engagementId,
  batch_code: "BATCH-DETAIL-001",
  processing_status: "received",
  review_status: "proposed",
  created_at: "2026-07-15T10:00:00.000Z",
  updated_at: "2026-07-15T11:00:00.000Z",
});
const readActorContext = Object.freeze({
  actorType: "human",
  actorUserId: "7fe568b1-5c05-4c42-bb1f-6e20de216c7b",
  kaiRoles: ["gk_operator"],
  organizationMemberships: [
    { organization_id: organizationId, role_name: "gk_operator", membership_status: "active" },
  ],
});

function assertForbiddenSentinelsAbsent(value) {
  const serialized = JSON.stringify(value);
  for (const [key, sentinel] of Object.entries(forbiddenRowSentinels)) {
    assert.equal(Object.hasOwn(value?.data || {}, key), false, key);
    const serializedSentinel = typeof sentinel === "string"
      ? sentinel
      : Object.values(sentinel)[0];
    assert.equal(serialized.includes(serializedSentinel), false, serializedSentinel);
  }
}

function tracedMembership(scenario, {
  membershipOrganizationId = organizationId,
  membershipStatus = "active",
  roleName = "gk_operator",
} = {}) {
  return Object.defineProperties({}, {
    organization_id: {
      enumerable: true,
      get() {
        scenario.events.push("tenant_membership_scope_check");
        return membershipOrganizationId;
      },
    },
    membership_status: {
      enumerable: true,
      get() {
        scenario.events.push("active_membership_check");
        return membershipStatus;
      },
    },
    role_name: {
      enumerable: true,
      get() {
        scenario.events.push("allowed_role_check");
        return roleName;
      },
    },
  });
}

function scenarioDependencies(scenario) {
  return {
    env: { KAI_SPRINT2_ENABLED: "true" },
    async findKaiUserByLegacyPublicUserdataId(legacyId) {
      scenario.events.push("actor_mapping");
      assert.equal(legacyId, 46);
      return {
        user_id: "7fe568b1-5c05-4c42-bb1f-6e20de216c7b",
        legacy_identity_source: "public.userdata",
        legacy_public_userdata_id: 46,
        status: "active",
      };
    },
    async listKaiRolesForUser() {
      scenario.events.push("role_context_lookup");
      return ["gk_operator"];
    },
    async listOrganizationMembershipsForUser() {
      scenario.events.push("membership_context_lookup");
      if (scenario.membershipState === "missing") return [];
      return [tracedMembership(scenario, {
        membershipOrganizationId: scenario.membershipOrganizationId,
        membershipStatus: scenario.membershipState === "inactive" ? "inactive" : "active",
        roleName: scenario.roleName,
      })];
    },
    async getIntakeBatchDetail(requestedOrganizationId, requestedIntakeBatchId) {
      scenario.events.push("tenant_scoped_repository_read");
      scenario.repositoryCalls.push({
        organizationId: requestedOrganizationId,
        intakeBatchId: requestedIntakeBatchId,
      });
      return scenario.repositoryRow;
    },
  };
}

function createAssembledApplication(getScenario) {
  const app = express();

  app.use(
    basePath,
    setKaiSprint2NoStore,
    requireKaiSprint2Enabled,
    kaiSprint2MetadataJsonParser,
  );
  app.use(basePath, handleKaiSprint2JsonParserError);

  app.use(basePath, (req, res, next) => {
    const scenario = getScenario();
    scenario.events.push("outer_feature_gate_passed");
    req.isAuthenticated = () => {
      scenario.events.push("canonical_http_authentication");
      return scenario.authenticated;
    };
    if (scenario.authenticated) req.user = { id: 46 };
    return next();
  });

  app.use(
    basePath,
    requireKaiSprint2Enabled,
    kaiSprint2OrganizationMutationLimiter,
    kaiSprint2ActorMutationLimiter,
    requireKaiSprint2Authenticated,
    sprint2IntakeApiRouter,
  );

  return app;
}

async function listen(app) {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1");
    server.once("listening", () => resolve(server));
    server.once("error", reject);
  });
}

async function getJson(server, path) {
  const { port } = server.address();
  return await new Promise((resolve, reject) => {
    const request = http.request({
      hostname: "127.0.0.1",
      port,
      path,
      method: "GET",
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve({
          statusCode: response.statusCode,
          body: JSON.parse(raw),
        });
      });
    });
    request.on("error", reject);
    request.end();
  });
}

function createScenario(overrides = {}) {
  return {
    authenticated: true,
    events: [],
    membershipOrganizationId: organizationId,
    membershipState: "active",
    repositoryCalls: [],
    repositoryRow: safeBatchRow,
    roleName: "gk_operator",
    ...overrides,
  };
}

async function withFeatureFlag(value, callback) {
  const previous = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = value;
  try {
    return await callback();
  } finally {
    if (previous === undefined) delete process.env.KAI_SPRINT2_ENABLED;
    else process.env.KAI_SPRINT2_ENABLED = previous;
  }
}

test("the production batch-detail read model predicates both tenant and batch identifiers", async () => {
  let queryCall = null;
  const row = await readIntakeBatchDetail(organizationId, intakeBatchId, {
    async query(sql, params) {
      queryCall = { sql, params };
      return { rows: [safeBatchRow] };
    },
  });

  assert.equal(row, safeBatchRow);
  assert.match(queryCall.sql, /WHERE organization_id = \$1\s+AND intake_batch_id = \$2/);
  assert.deepEqual(queryCall.params, [organizationId, intakeBatchId]);
});

test("the direct batch-detail service result is an explicit safe DTO", async () => {
  const repositoryCalls = [];
  const result = await getIntakeBatchDetail(
    {
      actorContext: {
        actorType: "human",
        actorUserId: "7fe568b1-5c05-4c42-bb1f-6e20de216c7b",
        kaiRoles: ["gk_operator"],
        organizationMemberships: [
          { organization_id: organizationId, role_name: "gk_operator", membership_status: "active" },
        ],
      },
      organizationId,
      intakeBatchId,
    },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      async getIntakeBatchDetail(requestedOrganizationId, requestedIntakeBatchId) {
        repositoryCalls.push({ requestedOrganizationId, requestedIntakeBatchId });
        return safeBatchRow;
      },
    },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.data, expectedBatchDto);
  assert.deepEqual(repositoryCalls, [{
    requestedOrganizationId: organizationId,
    requestedIntakeBatchId: intakeBatchId,
  }]);
  assertForbiddenSentinelsAbsent(result);
});

test("a missing batch row returns the canonical safe not-found result", async () => {
  const repositoryCalls = [];
  const result = await getIntakeBatchDetail(
    {
      actorContext: readActorContext,
      organizationId,
      intakeBatchId,
    },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      async getIntakeBatchDetail(requestedOrganizationId, requestedIntakeBatchId) {
        repositoryCalls.push({ requestedOrganizationId, requestedIntakeBatchId });
        return null;
      },
    },
  );

  assert.deepEqual(result, buildKaiError("not_found"));
  assert.deepEqual(repositoryCalls, [{
    requestedOrganizationId: organizationId,
    requestedIntakeBatchId: intakeBatchId,
  }]);
});

test("a cross-tenant returned row is deeply equal to the no-row result and performs no fallback", async () => {
  const canonicalNotFound = buildKaiError("not_found");

  const noRowCalls = [];
  const noRowResult = await getIntakeBatchDetail(
    {
      actorContext: readActorContext,
      organizationId,
      intakeBatchId,
    },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      async getIntakeBatchDetail(requestedOrganizationId, requestedIntakeBatchId) {
        noRowCalls.push({ requestedOrganizationId, requestedIntakeBatchId });
        return null;
      },
    },
  );

  const mismatchCalls = [];
  const mismatchResult = await getIntakeBatchDetail(
    {
      actorContext: readActorContext,
      organizationId,
      intakeBatchId,
    },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      async getIntakeBatchDetail(requestedOrganizationId, requestedIntakeBatchId) {
        mismatchCalls.push({ requestedOrganizationId, requestedIntakeBatchId });
        return crossTenantBatchRow;
      },
    },
  );

  assert.deepEqual(noRowResult, canonicalNotFound);
  assert.deepEqual(mismatchResult, canonicalNotFound);
  assert.deepEqual(mismatchResult, noRowResult);
  assertForbiddenSentinelsAbsent(mismatchResult);
  const serializedMismatch = JSON.stringify(mismatchResult);
  assert.equal(serializedMismatch.includes(otherOrganizationId), false);
  assert.equal(serializedMismatch.includes("tenant_boundary_violation"), false);
  assert.deepEqual(noRowCalls, [{
    requestedOrganizationId: organizationId,
    requestedIntakeBatchId: intakeBatchId,
  }]);
  assert.deepEqual(mismatchCalls, [{
    requestedOrganizationId: organizationId,
    requestedIntakeBatchId: intakeBatchId,
  }]);
});

test("a disallowed role is denied before any repository read", async () => {
  const repositoryCalls = [];
  const result = await getIntakeBatchDetail(
    {
      actorContext: {
        actorType: "human",
        actorUserId: "7fe568b1-5c05-4c42-bb1f-6e20de216c7b",
        kaiRoles: ["external_viewer"],
        organizationMemberships: [
          { organization_id: organizationId, role_name: "external_viewer", membership_status: "active" },
        ],
      },
      organizationId,
      intakeBatchId,
    },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      async getIntakeBatchDetail(requestedOrganizationId, requestedIntakeBatchId) {
        repositoryCalls.push({ requestedOrganizationId, requestedIntakeBatchId });
        return safeBatchRow;
      },
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.status, 403);
  assert.equal(result.error.code, "authorization_denied");
  assert.equal(result.blockers[0].blocking_reason, "role_not_allowed");
  assert.deepEqual(repositoryCalls, []);
});

test("missing or inactive membership is denied before any repository read", async () => {
  for (const memberships of [[], [
    { organization_id: organizationId, role_name: "gk_operator", membership_status: "inactive" },
  ]]) {
    const repositoryCalls = [];
    const result = await getIntakeBatchDetail(
      {
        actorContext: {
          actorType: "human",
          actorUserId: "7fe568b1-5c05-4c42-bb1f-6e20de216c7b",
          kaiRoles: ["gk_operator"],
          organizationMemberships: memberships,
        },
        organizationId,
        intakeBatchId,
      },
      {
        env: { KAI_SPRINT2_ENABLED: "true" },
        async getIntakeBatchDetail(requestedOrganizationId, requestedIntakeBatchId) {
          repositoryCalls.push({ requestedOrganizationId, requestedIntakeBatchId });
          return safeBatchRow;
        },
      },
    );

    assert.equal(result.ok, false);
    assert.equal(result.error.status, 403);
    assert.equal(result.error.code, "authorization_denied");
    assert.equal(result.blockers[0].blocking_reason, "missing_active_organization_membership");
    assert.deepEqual(repositoryCalls, []);
  }
});

test("assembled production middleware and router enforce batch-detail boundaries", async (t) => {
  let scenario = createScenario();
  const restoreService = intakeRouteTestables.setIntakeServiceForTest({
    async getIntakeBatchDetail(input) {
      scenario.events.push("sprint2_batch_detail_route_handler");
      return getIntakeBatchDetail(input, scenarioDependencies(scenario));
    },
  });
  const app = createAssembledApplication(() => scenario);
  const server = await listen(app);

  t.after(async () => {
    restoreService();
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  const validPath = `${basePath}/admin/batches/${intakeBatchId}?organization_id=${organizationId}`;

  await t.test("feature disabled stops before canonical authentication and repository read", async () => {
    scenario = createScenario();
    const response = await withFeatureFlag("false", () => getJson(server, validPath));

    assert.equal(response.statusCode, 403);
    assert.equal(response.body.error.code, "feature_disabled");
    assert.deepEqual(scenario.events, []);
    assert.deepEqual(scenario.repositoryCalls, []);
  });

  await t.test("feature enabled but unauthenticated stops at canonical authentication", async () => {
    scenario = createScenario({ authenticated: false });
    const response = await withFeatureFlag("true", () => getJson(server, validPath));

    assert.equal(response.statusCode, 401);
    assert.equal(response.body.error.code, "unauthorized");
    assert.deepEqual(scenario.events, [
      "outer_feature_gate_passed",
      "canonical_http_authentication",
    ]);
    assert.deepEqual(scenario.repositoryCalls, []);
  });

  await t.test("authenticated invalid identifiers stop in the route before the repository", async () => {
    for (const path of [
      `${basePath}/admin/batches/not-a-uuid?organization_id=${organizationId}`,
      `${basePath}/admin/batches/${intakeBatchId}?organization_id=not-a-uuid`,
    ]) {
      scenario = createScenario();
      const response = await withFeatureFlag("true", () => getJson(server, path));

      assert.equal(response.statusCode, 400);
      assert.equal(response.body.error.code, "invalid_request");
      assert.deepEqual(scenario.events, [
        "outer_feature_gate_passed",
        "canonical_http_authentication",
      ]);
      assert.deepEqual(scenario.repositoryCalls, []);
    }
  });

  await t.test("a disallowed role causes no repository read", async () => {
    scenario = createScenario({ roleName: "external_viewer" });
    const response = await withFeatureFlag("true", () => getJson(server, validPath));

    assert.equal(response.statusCode, 403);
    assert.equal(response.body.error.code, "authorization_denied");
    assert.equal(response.body.blockers[0].blocking_reason, "role_not_allowed");
    assert.deepEqual(scenario.repositoryCalls, []);
    assert.equal(scenario.events.includes("allowed_role_check"), true);
    assert.equal(scenario.events.includes("tenant_scoped_repository_read"), false);
  });

  await t.test("missing and inactive memberships cause no repository read", async () => {
    for (const membershipState of ["missing", "inactive"]) {
      scenario = createScenario({ membershipState });
      const response = await withFeatureFlag("true", () => getJson(server, validPath));

      assert.equal(response.statusCode, 403);
      assert.equal(response.body.error.code, "authorization_denied");
      assert.equal(response.body.blockers[0].blocking_reason, "missing_active_organization_membership");
      assert.deepEqual(scenario.repositoryCalls, []);
      assert.equal(scenario.events.includes("tenant_scoped_repository_read"), false);
    }
  });

  await t.test("a cross-tenant request has no unscoped fallback", async () => {
    scenario = createScenario();
    const path = `${basePath}/admin/batches/${intakeBatchId}?organization_id=${otherOrganizationId}`;
    const response = await withFeatureFlag("true", () => getJson(server, path));

    assert.equal(response.statusCode, 403);
    assert.equal(response.body.error.code, "authorization_denied");
    assert.equal(response.body.data, null);
    assert.deepEqual(scenario.repositoryCalls, []);
  });

  await t.test("no repository row returns the canonical safe not-found result", async () => {
    scenario = createScenario({ repositoryRow: null });
    const response = await withFeatureFlag("true", () => getJson(server, validPath));

    assert.equal(response.statusCode, 404);
    assert.equal(response.body.error.code, "not_found");
    assert.deepEqual(scenario.repositoryCalls, [{ organizationId, intakeBatchId }]);
  });

  await t.test("a cross-tenant repository row returns a response identical to the no-row response", async () => {
    scenario = createScenario({ repositoryRow: null });
    const noRowResponse = await withFeatureFlag("true", () => getJson(server, validPath));
    const noRowRepositoryCalls = scenario.repositoryCalls;

    scenario = createScenario({ repositoryRow: crossTenantBatchRow });
    const mismatchResponse = await withFeatureFlag("true", () => getJson(server, validPath));

    assert.equal(mismatchResponse.statusCode, 404);
    assert.equal(mismatchResponse.statusCode, noRowResponse.statusCode);
    assert.deepEqual(mismatchResponse.body, noRowResponse.body);
    assert.equal(mismatchResponse.body.error.code, "not_found");
    assert.equal(mismatchResponse.body.data, null);
    const serializedMismatch = JSON.stringify(mismatchResponse.body);
    assert.equal(serializedMismatch.includes(otherOrganizationId), false);
    assert.equal(serializedMismatch.includes(intakeBatchId), false);
    assert.equal(serializedMismatch.includes("tenant_boundary_violation"), false);
    assertForbiddenSentinelsAbsent(mismatchResponse.body);
    assert.deepEqual(noRowRepositoryCalls, [{ organizationId, intakeBatchId }]);
    assert.deepEqual(scenario.repositoryCalls, [{ organizationId, intakeBatchId }]);
  });

  await t.test("success performs exactly one scoped read after all controls and returns only the DTO", async () => {
    scenario = createScenario();
    const response = await withFeatureFlag("true", () => getJson(server, validPath));

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, {
      ok: true,
      data: expectedBatchDto,
      warnings: [],
    });
    assert.deepEqual(scenario.repositoryCalls, [{ organizationId, intakeBatchId }]);
    assert.deepEqual(scenario.events, [
      "outer_feature_gate_passed",
      "canonical_http_authentication",
      "sprint2_batch_detail_route_handler",
      "actor_mapping",
      "role_context_lookup",
      "membership_context_lookup",
      "tenant_membership_scope_check",
      "active_membership_check",
      "allowed_role_check",
      "tenant_scoped_repository_read",
    ]);
    assertForbiddenSentinelsAbsent(response.body);
  });

  const indexSource = readFileSync("index.js", "utf8");
  assert.match(indexSource, /["']\/api\/kai\/sprint2\/intake["'][\s\S]*requireKaiSprint2Enabled[\s\S]*kaiSprint2OrganizationMutationLimiter[\s\S]*kaiSprint2ActorMutationLimiter[\s\S]*requireKaiSprint2Authenticated[\s\S]*sprint2IntakeApiRouter/);
  assert.doesNotMatch(indexSource, /app\.(?:get|use)\([^\n]*admin\/batches\/:intakeBatchId/);
});
