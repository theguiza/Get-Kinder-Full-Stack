import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import express from "express";

import { requireKaiSprint2Enabled } from "../Backend/kai/config/kaiSprint2Config.js";
import {
  listIntakeFilesForBatch as readIntakeFilesForBatch,
} from "../Backend/kai/db/kaiReadModels.js";
import { buildKaiError } from "../Backend/kai/errors/kaiErrors.js";
import { requireKaiSprint2Authenticated } from "../Backend/kai/middleware/kaiSprint2Authentication.js";
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
  listIntakeFilesForBatch,
} from "../Backend/kai/services/kaiIntakeService.js";

const basePath = "/api/kai/sprint2/intake";
const organizationId = "a5d17c5a-c55f-43af-9b21-fe63aafe733f";
const otherOrganizationId = "b5d17c5a-c55f-43af-9b21-fe63aafe733f";
const engagementId = "2e426ea1-2be3-4e48-b80f-9783ddbacda0";
const intakeBatchId = "8e426ea1-2be3-4e48-b80f-9783ddbacda0";
const createdAt = "2026-07-15T10:00:00.000Z";
const olderCreatedAt = "2026-07-15T09:00:00.000Z";
const fileIds = Object.freeze([
  "7e426ea1-2be3-4e48-b80f-9783ddbacda4",
  "7e426ea1-2be3-4e48-b80f-9783ddbacda3",
  "7e426ea1-2be3-4e48-b80f-9783ddbacda2",
  "7e426ea1-2be3-4e48-b80f-9783ddbacda1",
]);

const fileSummaryKeys = Object.freeze([
  "intake_file_id",
  "intake_batch_id",
  "organization_id",
  "engagement_id",
  "safe_filename",
  "mime_type",
  "file_size_bytes",
  "file_policy_status",
  "malware_scan_status",
  "processing_status",
  "parse_status",
  "review_status",
  "created_at",
  "updated_at",
].sort());

const forbiddenRowSentinels = Object.freeze({
  storage_provider: "storage-provider-sentinel",
  storage_bucket: "storage-bucket-sentinel",
  storage_object_key: "storage-object-key-sentinel",
  storage_uri: "storage-uri-sentinel",
  signed_url: "signed-url-sentinel",
  file_extension: ".forbidden-sentinel",
  checksum: "checksum-sentinel",
  hash_algorithm: "hash-algorithm-sentinel",
  notes: "notes-sentinel",
  metadata: Object.freeze({ marker: "unrestricted-metadata-sentinel" }),
  raw_content: "raw-content-sentinel",
  credentials: Object.freeze({ token: "credentials-sentinel" }),
  actor_context: Object.freeze({ marker: "actor-context-sentinel" }),
  membership_context: Object.freeze({ marker: "membership-context-sentinel" }),
  client_data: Object.freeze({ marker: "client-data-sentinel" }),
  unapproved_pii: Object.freeze({ marker: "unapproved-pii-sentinel" }),
  policy_status: "policy-status-alias-sentinel",
  malware_status: "malware-status-alias-sentinel",
});

const parentRow = Object.freeze({
  intake_batch_id: intakeBatchId,
  organization_id: organizationId,
  engagement_id: engagementId,
  returned_row_sentinel: "parent-row-sentinel",
});

const crossTenantParentRow = Object.freeze({
  intake_batch_id: intakeBatchId,
  organization_id: otherOrganizationId,
  engagement_id: engagementId,
  returned_row_sentinel: "cross-tenant-parent-row-sentinel",
});

function fileRow(intakeFileId, rowCreatedAt = createdAt, overrides = {}) {
  return {
    intake_file_id: intakeFileId,
    intake_batch_id: intakeBatchId,
    organization_id: organizationId,
    engagement_id: engagementId,
    safe_filename: `${intakeFileId.slice(-4)}.csv`,
    mime_type: "text/csv",
    file_size_bytes: 321,
    file_policy_status: "pending",
    malware_scan_status: "pending",
    processing_status: "received",
    parse_status: "not_started",
    review_status: "proposed",
    created_at: rowCreatedAt,
    updated_at: "2026-07-15T11:00:00.000Z",
    ...forbiddenRowSentinels,
    ...overrides,
  };
}

const safeRows = Object.freeze([
  Object.freeze(fileRow(fileIds[0])),
  Object.freeze(fileRow(fileIds[1])),
]);

function encodeRawCursor(value) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  return Buffer.from(serialized, "utf8").toString("base64url");
}

function decodeCursor(token) {
  return JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
}

function assertForbiddenSentinelsAbsent(value) {
  const serialized = JSON.stringify(value);
  for (const [field, sentinel] of Object.entries(forbiddenRowSentinels)) {
    const marker = typeof sentinel === "string" ? sentinel : Object.values(sentinel)[0];
    assert.equal(serialized.includes(`\"${field}\"`), false, field);
    assert.equal(serialized.includes(marker), false, marker);
  }
}

function tracedMembership(scenario, {
  membershipStatus = "active",
  roleName = "gk_operator",
} = {}) {
  return Object.defineProperties({}, {
    organization_id: {
      enumerable: true,
      get() {
        scenario.events.push("tenant_membership_scope_check");
        return organizationId;
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
        membershipStatus: scenario.membershipState === "inactive" ? "inactive" : "active",
        roleName: scenario.roleName,
      })];
    },
    async getIntakeBatchDetail(requestedOrganizationId, requestedIntakeBatchId) {
      scenario.events.push("tenant_scoped_parent_read");
      scenario.parentCalls.push({
        organizationId: requestedOrganizationId,
        intakeBatchId: requestedIntakeBatchId,
      });
      return scenario.parentRow;
    },
    async listIntakeFilesForBatch(requestedOrganizationId, requestedIntakeBatchId, pagination) {
      scenario.events.push("tenant_scoped_child_read");
      scenario.childCalls.push({
        organizationId: requestedOrganizationId,
        intakeBatchId: requestedIntakeBatchId,
        pagination,
      });
      return scenario.childRows;
    },
    async getIntakeBatchById() {
      scenario.fallbackCalls.push("id_only_parent");
      throw new Error("unscoped fallback must not execute");
    },
    async listIntakeFilesUnscoped() {
      scenario.fallbackCalls.push("unscoped_children");
      throw new Error("unscoped fallback must not execute");
    },
  };
}

function createScenario(overrides = {}) {
  return {
    authenticated: true,
    childCalls: [],
    childRows: safeRows,
    events: [],
    fallbackCalls: [],
    membershipState: "active",
    parentCalls: [],
    parentRow,
    roleName: "gk_operator",
    serviceResults: [],
    ...overrides,
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
        resolve({ statusCode: response.statusCode, body: JSON.parse(raw) });
      });
    });
    request.on("error", reject);
    request.end();
  });
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

function validPath(query = "") {
  const suffix = query ? `&${query}` : "";
  return `${basePath}/admin/batches/${intakeBatchId}/files?organization_id=${organizationId}${suffix}`;
}

test("the child-file read model is tenant-scoped, bounded, ordered, and uses the exclusive keyset predicate", async (t) => {
  await t.test("the first page is bounded to limit plus one with no offset", async () => {
    let queryCall = null;
    const rows = await readIntakeFilesForBatch(
      organizationId,
      intakeBatchId,
      { limit: 25, cursor: null },
      {
        async query(sql, params) {
          queryCall = { sql, params };
          return { rows: safeRows };
        },
      },
    );

    assert.equal(rows, safeRows);
    assert.match(queryCall.sql, /WHERE organization_id = \$1\s+AND intake_batch_id = \$2/);
    assert.match(queryCall.sql, /ORDER BY created_at DESC, intake_file_id DESC/);
    assert.match(queryCall.sql, /LIMIT \$3/);
    assert.doesNotMatch(queryCall.sql, /\bOFFSET\b/i);
    assert.deepEqual(queryCall.params, [organizationId, intakeBatchId, 26]);
    for (const forbiddenField of Object.keys(forbiddenRowSentinels)) {
      assert.doesNotMatch(queryCall.sql, new RegExp(`\\b${forbiddenField}\\b`), forbiddenField);
    }
  });

  await t.test("a continuation page predicates timestamp and ID exclusively", async () => {
    let queryCall = null;
    const cursor = { created_at: createdAt, intake_file_id: fileIds[1] };
    await readIntakeFilesForBatch(
      organizationId,
      intakeBatchId,
      { limit: 2, cursor },
      {
        async query(sql, params) {
          queryCall = { sql, params };
          return { rows: [] };
        },
      },
    );

    assert.match(queryCall.sql, /created_at < \$3\s+OR \(created_at = \$3 AND intake_file_id < \$4\)/);
    assert.match(queryCall.sql, /ORDER BY created_at DESC, intake_file_id DESC/);
    assert.match(queryCall.sql, /LIMIT \$5/);
    assert.doesNotMatch(queryCall.sql, /\bOFFSET\b/i);
    assert.deepEqual(queryCall.params, [organizationId, intakeBatchId, createdAt, fileIds[1], 3]);
  });
});

test("the service makes parent failure indistinguishable and never reads children on failure", async () => {
  async function run(parent) {
    const calls = { parent: [], child: [] };
    const result = await listIntakeFilesForBatch(
      {
        actorContext: {
          actorType: "human",
          actorUserId: "7fe568b1-5c05-4c42-bb1f-6e20de216c7b",
          kaiRoles: ["gk_operator"],
          organizationMemberships: [
            { organization_id: organizationId, membership_status: "active", role_name: "gk_operator" },
          ],
        },
        organizationId,
        intakeBatchId,
        pagination: { limit: 25, cursor: null },
      },
      {
        env: { KAI_SPRINT2_ENABLED: "true" },
        async getIntakeBatchDetail(requestedOrganizationId, requestedIntakeBatchId) {
          calls.parent.push({ requestedOrganizationId, requestedIntakeBatchId });
          return parent;
        },
        async listIntakeFilesForBatch(...args) {
          calls.child.push(args);
          return [];
        },
      },
    );
    return { calls, result };
  }

  const missing = await run(null);
  const mismatch = await run(crossTenantParentRow);
  assert.deepEqual(missing.result, buildKaiError("not_found"));
  assert.deepEqual(mismatch.result, missing.result);
  assert.deepEqual(missing.calls.parent, [{
    requestedOrganizationId: organizationId,
    requestedIntakeBatchId: intakeBatchId,
  }]);
  assert.deepEqual(mismatch.calls.parent, missing.calls.parent);
  assert.deepEqual(missing.calls.child, []);
  assert.deepEqual(mismatch.calls.child, []);

  const serialized = JSON.stringify([missing.result, mismatch.result]);
  for (const forbiddenValue of [
    organizationId,
    otherOrganizationId,
    intakeBatchId,
    crossTenantParentRow.returned_row_sentinel,
    "tenant_boundary_violation",
  ]) {
    assert.equal(serialized.includes(forbiddenValue), false, forbiddenValue);
  }
});

test("the service uses the probe row only for next-page detection and the cursor comes from the final returned item", async () => {
  const probeRows = [
    fileRow(fileIds[0]),
    fileRow(fileIds[1]),
    fileRow(fileIds[2]),
  ];
  const calls = { parent: [], child: [] };
  const dependencies = {
    env: { KAI_SPRINT2_ENABLED: "true" },
    async getIntakeBatchDetail(...args) {
      calls.parent.push(args);
      return parentRow;
    },
    async listIntakeFilesForBatch(...args) {
      calls.child.push(args);
      return probeRows;
    },
  };
  const input = {
    actorContext: {
      actorType: "human",
      actorUserId: "7fe568b1-5c05-4c42-bb1f-6e20de216c7b",
      kaiRoles: ["gk_operator"],
      organizationMemberships: [
        { organization_id: organizationId, membership_status: "active", role_name: "gk_operator" },
      ],
    },
    organizationId,
    intakeBatchId,
    pagination: { limit: 2, cursor: null },
  };

  const result = await listIntakeFilesForBatch(input, dependencies);
  assert.equal(result.ok, true);
  assert.equal(result.data.items.length, 2);
  assert.deepEqual(result.data.items.map((item) => item.intake_file_id), fileIds.slice(0, 2));
  assert.equal(result.data.items.some((item) => item.intake_file_id === fileIds[2]), false);
  assert.equal(typeof result.data.pagination.next_cursor, "string");
  assert.deepEqual(decodeCursor(result.data.pagination.next_cursor), {
    created_at: probeRows[1].created_at,
    intake_file_id: probeRows[1].intake_file_id,
  });
  assert.notDeepEqual(decodeCursor(result.data.pagination.next_cursor), {
    created_at: probeRows[2].created_at,
    intake_file_id: probeRows[2].intake_file_id,
  });
  assert.deepEqual(calls.parent, [[organizationId, intakeBatchId]]);
  assert.deepEqual(calls.child, [[organizationId, intakeBatchId, { limit: 2, cursor: null }]]);

  dependencies.listIntakeFilesForBatch = async () => probeRows.slice(0, 2);
  const finalPage = await listIntakeFilesForBatch(input, dependencies);
  assert.equal(finalPage.data.items.length, 2);
  assert.equal(finalPage.data.pagination.next_cursor, null);
  assertForbiddenSentinelsAbsent(result);
});

test("duplicate timestamps paginate without a skipped or duplicated ID", async () => {
  const orderedRows = [
    fileRow(fileIds[0], createdAt),
    fileRow(fileIds[1], createdAt),
    fileRow(fileIds[2], createdAt),
    fileRow(fileIds[3], olderCreatedAt),
  ];
  const childCalls = [];
  const dependencies = {
    env: { KAI_SPRINT2_ENABLED: "true" },
    async getIntakeBatchDetail() {
      return parentRow;
    },
    async listIntakeFilesForBatch(requestedOrganizationId, requestedIntakeBatchId, pagination) {
      childCalls.push({ requestedOrganizationId, requestedIntakeBatchId, pagination });
      const remaining = pagination.cursor
        ? orderedRows.filter((row) => (
          row.created_at < pagination.cursor.created_at
          || (
            row.created_at === pagination.cursor.created_at
            && row.intake_file_id < pagination.cursor.intake_file_id
          )
        ))
        : orderedRows;
      return remaining.slice(0, pagination.limit + 1);
    },
  };
  const commonInput = {
    actorContext: {
      actorType: "human",
      actorUserId: "7fe568b1-5c05-4c42-bb1f-6e20de216c7b",
      kaiRoles: ["gk_operator"],
      organizationMemberships: [
        { organization_id: organizationId, membership_status: "active", role_name: "gk_operator" },
      ],
    },
    organizationId,
    intakeBatchId,
  };

  const first = await listIntakeFilesForBatch({
    ...commonInput,
    pagination: { limit: 2, cursor: null },
  }, dependencies);
  const boundary = decodeCursor(first.data.pagination.next_cursor);
  const second = await listIntakeFilesForBatch({
    ...commonInput,
    pagination: { limit: 2, cursor: boundary },
  }, dependencies);

  assert.deepEqual(boundary, { created_at: createdAt, intake_file_id: fileIds[1] });
  assert.deepEqual(childCalls[1].pagination.cursor, boundary);
  assert.equal(
    second.data.items.every((item) => (
      item.created_at < boundary.created_at
      || (item.created_at === boundary.created_at && item.intake_file_id < boundary.intake_file_id)
    )),
    true,
  );
  const allIds = [...first.data.items, ...second.data.items].map((item) => item.intake_file_id);
  assert.deepEqual(allIds, fileIds);
  assert.equal(new Set(allIds).size, fileIds.length);
  assert.equal(second.data.pagination.next_cursor, null);
});

test("assembled production middleware and router enforce the batch-files collection contract", async (t) => {
  let scenario = createScenario();
  const restoreService = intakeRouteTestables.setIntakeServiceForTest({
    async listIntakeFilesForBatch(input) {
      scenario.events.push("sprint2_batch_files_route_handler");
      const result = await listIntakeFilesForBatch(input, scenarioDependencies(scenario));
      scenario.serviceResults.push(result);
      return result;
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

  await t.test("feature disabled stops before authentication, service, and repositories", async () => {
    scenario = createScenario();
    const response = await withFeatureFlag("false", () => getJson(server, validPath()));

    assert.equal(response.statusCode, 403);
    assert.equal(response.body.error.code, "feature_disabled");
    assert.deepEqual(scenario.events, []);
    assert.deepEqual(scenario.serviceResults, []);
    assert.deepEqual(scenario.parentCalls, []);
    assert.deepEqual(scenario.childCalls, []);
  });

  await t.test("unauthenticated stops at canonical authentication before service and repositories", async () => {
    scenario = createScenario({ authenticated: false });
    const response = await withFeatureFlag("true", () => getJson(server, validPath()));

    assert.equal(response.statusCode, 401);
    assert.equal(response.body.error.code, "unauthorized");
    assert.deepEqual(scenario.events, [
      "outer_feature_gate_passed",
      "canonical_http_authentication",
    ]);
    assert.deepEqual(scenario.serviceResults, []);
    assert.deepEqual(scenario.parentCalls, []);
    assert.deepEqual(scenario.childCalls, []);
  });

  await t.test("invalid organization and batch IDs stop before repository reads", async () => {
    for (const path of [
      `${basePath}/admin/batches/${intakeBatchId}/files?organization_id=not-a-uuid`,
      `${basePath}/admin/batches/not-a-uuid/files?organization_id=${organizationId}`,
    ]) {
      scenario = createScenario();
      const response = await withFeatureFlag("true", () => getJson(server, path));
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.error.code, "invalid_request");
      assert.deepEqual(scenario.parentCalls, []);
      assert.deepEqual(scenario.childCalls, []);
    }
  });

  await t.test("disallowed role returns 403 with zero parent and child reads", async () => {
    scenario = createScenario({ roleName: "external_viewer" });
    const response = await withFeatureFlag("true", () => getJson(server, validPath()));

    assert.equal(response.statusCode, 403);
    assert.equal(response.body.error.code, "authorization_denied");
    assert.equal(response.body.blockers[0].blocking_reason, "role_not_allowed");
    assert.deepEqual(scenario.parentCalls, []);
    assert.deepEqual(scenario.childCalls, []);
  });

  await t.test("missing and inactive membership each return 403 with zero reads", async () => {
    for (const membershipState of ["missing", "inactive"]) {
      scenario = createScenario({ membershipState });
      const response = await withFeatureFlag("true", () => getJson(server, validPath()));

      assert.equal(response.statusCode, 403);
      assert.equal(response.body.error.code, "authorization_denied");
      assert.equal(response.body.blockers[0].blocking_reason, "missing_active_organization_membership");
      assert.deepEqual(scenario.parentCalls, []);
      assert.deepEqual(scenario.childCalls, []);
    }
  });

  await t.test("missing and mismatched parents have deeply equal service and HTTP results", async () => {
    scenario = createScenario({ parentRow: null });
    const missingResponse = await withFeatureFlag("true", () => getJson(server, validPath()));
    const missingResult = scenario.serviceResults[0];
    const missingParentCalls = scenario.parentCalls;
    const missingChildCalls = scenario.childCalls;

    scenario = createScenario({ parentRow: crossTenantParentRow });
    const mismatchResponse = await withFeatureFlag("true", () => getJson(server, validPath()));
    const mismatchResult = scenario.serviceResults[0];

    assert.equal(missingResponse.statusCode, 404);
    assert.equal(mismatchResponse.statusCode, 404);
    assert.deepEqual(mismatchResult, missingResult);
    assert.deepEqual(mismatchResponse.body, missingResponse.body);
    assert.deepEqual(missingParentCalls, [{ organizationId, intakeBatchId }]);
    assert.deepEqual(scenario.parentCalls, [{ organizationId, intakeBatchId }]);
    assert.deepEqual(missingChildCalls, []);
    assert.deepEqual(scenario.childCalls, []);

    const serialized = JSON.stringify([missingResult, mismatchResult, missingResponse.body, mismatchResponse.body]);
    for (const forbiddenValue of [
      organizationId,
      otherOrganizationId,
      intakeBatchId,
      crossTenantParentRow.returned_row_sentinel,
      "tenant_boundary_violation",
    ]) {
      assert.equal(serialized.includes(forbiddenValue), false, forbiddenValue);
    }
  });

  await t.test("an existing empty parent returns the exact empty collection shape", async () => {
    scenario = createScenario({ childRows: [] });
    const response = await withFeatureFlag("true", () => getJson(server, validPath("limit=1")));

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, {
      ok: true,
      data: {
        items: [],
        pagination: { limit: 1, next_cursor: null },
      },
      warnings: [],
    });
    assert.deepEqual(scenario.parentCalls, [{ organizationId, intakeBatchId }]);
    assert.deepEqual(scenario.childCalls, [{
      organizationId,
      intakeBatchId,
      pagination: { limit: 1, cursor: null },
    }]);
  });

  await t.test("success performs one parent and one child read and returns the exact DTO allowlist", async () => {
    scenario = createScenario();
    const response = await withFeatureFlag("true", () => getJson(server, validPath("limit=2")));

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.data.items.length, 2);
    for (const item of response.body.data.items) {
      assert.deepEqual(Object.keys(item).sort(), fileSummaryKeys);
    }
    assert.deepEqual(scenario.parentCalls, [{ organizationId, intakeBatchId }]);
    assert.deepEqual(scenario.childCalls, [{
      organizationId,
      intakeBatchId,
      pagination: { limit: 2, cursor: null },
    }]);
    assert.deepEqual(scenario.fallbackCalls, []);
    assertForbiddenSentinelsAbsent(response.body);
  });

  await t.test("omitted, minimum, and maximum limits resolve to 25, 1, and 25", async () => {
    for (const { query, expected } of [
      { query: "", expected: 25 },
      { query: "limit=1", expected: 1 },
      { query: "limit=25", expected: 25 },
    ]) {
      scenario = createScenario({ childRows: [] });
      const response = await withFeatureFlag("true", () => getJson(server, validPath(query)));
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.data.pagination.limit, expected);
      assert.equal(scenario.childCalls[0].pagination.limit, expected);
    }
  });

  await t.test("invalid limits and unknown query parameters return canonical invalid_request before reads", async () => {
    for (const query of [
      "limit=0",
      "limit=-1",
      "limit=1.5",
      "limit=abc",
      "limit=1x",
      "limit=26",
      "limit=",
      "limit=1&limit=2",
      "offset=1",
    ]) {
      scenario = createScenario();
      const response = await withFeatureFlag("true", () => getJson(server, validPath(query)));
      assert.equal(response.statusCode, 400, query);
      assert.equal(response.body.error.code, "invalid_request", query);
      assert.deepEqual(scenario.parentCalls, [], query);
      assert.deepEqual(scenario.childCalls, [], query);
    }
  });

  await t.test("malformed cursors and every invalid decoded shape stop before reads", async () => {
    const invalidCursors = [
      "not%25base64url",
      "abc=",
      encodeRawCursor("not-json"),
      encodeRawCursor([]),
      encodeRawCursor({ created_at: createdAt }),
      encodeRawCursor({ created_at: createdAt, intake_file_id: fileIds[0], extra: true }),
      encodeRawCursor({ created_at: "2026-07-15T10:00:00Z", intake_file_id: fileIds[0] }),
      encodeRawCursor({ created_at: "2026-02-30T10:00:00.000Z", intake_file_id: fileIds[0] }),
      encodeRawCursor({ created_at: createdAt, intake_file_id: "not-a-uuid" }),
      encodeRawCursor({ created_at: 123, intake_file_id: fileIds[0] }),
      encodeRawCursor({ created_at: createdAt, intake_file_id: 123 }),
    ];

    for (const cursor of invalidCursors) {
      scenario = createScenario();
      const response = await withFeatureFlag("true", () => (
        getJson(server, validPath(`cursor=${encodeURIComponent(cursor)}`))
      ));
      assert.equal(response.statusCode, 400, cursor);
      assert.equal(response.body.error.code, "invalid_request", cursor);
      assert.deepEqual(scenario.parentCalls, [], cursor);
      assert.deepEqual(scenario.childCalls, [], cursor);
    }
  });
});
