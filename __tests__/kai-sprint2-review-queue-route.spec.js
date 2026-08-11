import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import express from "express";

import { validateActorCanPerformOperation } from "../Backend/kai/auth/kaiAuthorizationService.js";
import { requireKaiSprint2Enabled } from "../Backend/kai/config/kaiSprint2Config.js";
import {
  listIntakeFileReviewQueueItems as readIntakeFileReviewQueueItems,
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
  listIntakeFileReviewQueueItems,
} from "../Backend/kai/services/kaiIntakeService.js";

const basePath = "/api/kai/sprint2/intake";
const organizationId = "a5d17c5a-c55f-43af-9b21-fe63aafe733f";
const otherOrganizationId = "b5d17c5a-c55f-43af-9b21-fe63aafe733f";
const actorUserId = "7fe568b1-5c05-4c42-bb1f-6e20de216c7b";
const createdAt = "2026-07-15T10:00:00.000Z";
const olderCreatedAt = "2026-07-15T09:00:00.000Z";
const updatedAt = "2026-07-15T11:00:00.000Z";
const queueIds = Object.freeze([
  "9e426ea1-2be3-4e48-b80f-9783ddbacda4",
  "9e426ea1-2be3-4e48-b80f-9783ddbacda3",
  "9e426ea1-2be3-4e48-b80f-9783ddbacda2",
  "9e426ea1-2be3-4e48-b80f-9783ddbacda1",
]);
const targetIds = Object.freeze([
  "7e426ea1-2be3-4e48-b80f-9783ddbacda4",
  "7e426ea1-2be3-4e48-b80f-9783ddbacda3",
  "7e426ea1-2be3-4e48-b80f-9783ddbacda2",
  "7e426ea1-2be3-4e48-b80f-9783ddbacda1",
]);

const reviewQueueKeys = Object.freeze([
  "review_queue_item_id",
  "organization_id",
  "queue_type",
  "target_object_type",
  "target_object_id",
  "priority",
  "queue_status",
  "due_at",
  "summary",
  "required_action",
  "created_at",
  "updated_at",
]);

const forbiddenRowSentinels = Object.freeze({
  assigned_to: "assigned-to-sentinel",
  blocked_reason: "blocked-reason-sentinel",
  queue_metadata: Object.freeze({ marker: "queue-metadata-sentinel" }),
  internal_notes: "internal-notes-sentinel",
  actor_context: Object.freeze({ marker: "actor-context-sentinel" }),
  session_context: Object.freeze({ marker: "session-context-sentinel" }),
  membership_context: Object.freeze({ marker: "membership-context-sentinel" }),
  storage_provider: "storage-provider-sentinel",
  storage_bucket: "storage-bucket-sentinel",
  storage_object_key: "storage-object-key-sentinel",
  credentials: Object.freeze({ token: "credentials-sentinel" }),
  raw_content: "raw-content-sentinel",
  client_data: Object.freeze({ marker: "client-data-sentinel" }),
  pii: "pii-sentinel",
});

function queueRow(
  reviewQueueItemId = queueIds[0],
  targetObjectId = targetIds[0],
  rowCreatedAt = createdAt,
  overrides = {},
) {
  return {
    review_queue_item_id: reviewQueueItemId,
    organization_id: organizationId,
    queue_type: "intake_file_review",
    target_object_type: "intake_file",
    target_object_id: targetObjectId,
    priority: "high",
    queue_status: "open",
    due_at: null,
    summary: "Review intake file",
    required_action: "Inspect metadata and record the review outcome.",
    created_at: rowCreatedAt,
    updated_at: updatedAt,
    ...forbiddenRowSentinels,
    ...overrides,
  };
}

const safeRows = Object.freeze([
  Object.freeze(queueRow(queueIds[0], targetIds[0])),
  Object.freeze(queueRow(queueIds[1], targetIds[1])),
]);

function actorContext(roleName = "gk_operator", membershipStatus = "active") {
  return {
    actorType: "human",
    actorUserId,
    kaiRoles: [roleName],
    organizationMemberships: [{
      organization_id: organizationId,
      membership_status: membershipStatus,
      role_name: roleName,
    }],
  };
}

function decodeCursor(token) {
  return JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
}

function encodeRawCursor(value) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  return Buffer.from(serialized, "utf8").toString("base64url");
}

function assertForbiddenSentinelsAbsent(value) {
  const serialized = JSON.stringify(value);
  for (const [field, sentinel] of Object.entries(forbiddenRowSentinels)) {
    const marker = typeof sentinel === "string" ? sentinel : Object.values(sentinel)[0];
    assert.equal(serialized.includes(`\"${field}\"`), false, field);
    assert.equal(serialized.includes(marker), false, marker);
  }
}

function scenarioDependencies(scenario) {
  return {
    env: { KAI_SPRINT2_ENABLED: "true" },
    async findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: legacyId }) {
      scenario.events.push("actor_mapping");
      assert.equal(legacyId, 46);
      return {
        user_id: actorUserId,
        legacy_identity_source: "public.userdata",
        legacy_public_userdata_id: 46,
        status: "active",
      };
    },
    async listKaiRolesForUser() {
      scenario.events.push("role_context_lookup");
      return [scenario.roleName];
    },
    async resolveEffectiveClientOrganizationMembershipsForLegacyUser() {
      return [];
    },
    async listOrganizationMembershipsForUser() {
      scenario.events.push("membership_context_lookup");
      if (scenario.membershipState === "missing") return [];
      return [{
        organization_id: organizationId,
        membership_status: scenario.membershipState === "inactive" ? "inactive" : "active",
        role_name: scenario.roleName,
      }];
    },
    async listIntakeFileReviewQueueItems(requestedOrganizationId, pagination) {
      scenario.events.push("tenant_scoped_bounded_queue_read");
      scenario.queueCalls.push({ organizationId: requestedOrganizationId, pagination });
      return scenario.queueRows;
    },
    async listReviewQueueItemsUnscoped() {
      scenario.fallbackCalls.push("unscoped_collection");
      throw new Error("Unscoped fallback must not execute");
    },
    async getReviewQueueItemById() {
      scenario.fallbackCalls.push("id_only_queue_item");
      throw new Error("ID-only fallback must not execute");
    },
    async getIntakeFileMetadata() {
      scenario.fallbackCalls.push("per_row_target_lookup");
      throw new Error("Per-row target lookup must not execute");
    },
  };
}

function createScenario(overrides = {}) {
  return {
    authenticated: true,
    events: [],
    fallbackCalls: [],
    membershipState: "active",
    queueCalls: [],
    queueRows: safeRows,
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
  return `${basePath}/admin/review-queue?organization_id=${organizationId}${suffix}`;
}

test("review-queue read model is fixed-scope, organization-scoped, bounded, and keyset ordered", async (t) => {
  await t.test("first page uses the fixed queue/target/status predicates and limit plus one", async () => {
    let queryCall = null;
    const rows = await readIntakeFileReviewQueueItems(
      organizationId,
      { limit: 25, cursor: null },
      {
        async query(sql, params) {
          queryCall = { sql, params };
          return { rows: safeRows };
        },
      },
    );

    assert.equal(rows, safeRows);
    assert.match(queryCall.sql, /WHERE organization_id = \$1/);
    assert.match(queryCall.sql, /queue_type = 'intake_file_review'/);
    assert.match(queryCall.sql, /target_object_type = 'intake_file'/);
    assert.match(
      queryCall.sql,
      /queue_status IN \('open', 'in_progress', 'blocked', 'waiting_on_client', 'waiting_on_gk'\)/,
    );
    assert.doesNotMatch(queryCall.sql, /'resolved'|'cancelled'/);
    assert.match(queryCall.sql, /ORDER BY created_at DESC, review_queue_item_id DESC/);
    assert.match(queryCall.sql, /LIMIT \$2/);
    assert.doesNotMatch(queryCall.sql, /\bOFFSET\b/i);
    assert.deepEqual(queryCall.params, [organizationId, 26]);

    for (const forbiddenField of Object.keys(forbiddenRowSentinels)) {
      assert.doesNotMatch(queryCall.sql, new RegExp(`\\b${forbiddenField}\\b`), forbiddenField);
    }
  });

  await t.test("continuation is exclusive on created_at and review_queue_item_id", async () => {
    let queryCall = null;
    const cursor = { created_at: createdAt, review_queue_item_id: queueIds[1] };
    await readIntakeFileReviewQueueItems(
      organizationId,
      { limit: 2, cursor },
      {
        async query(sql, params) {
          queryCall = { sql, params };
          return { rows: [] };
        },
      },
    );

    assert.match(
      queryCall.sql,
      /created_at < \$2\s+OR \(created_at = \$2 AND review_queue_item_id < \$3\)/,
    );
    assert.match(queryCall.sql, /ORDER BY created_at DESC, review_queue_item_id DESC/);
    assert.match(queryCall.sql, /LIMIT \$4/);
    assert.deepEqual(queryCall.params, [organizationId, createdAt, queueIds[1], 3]);
  });
});

test("service derives next_cursor from the final returned row and validates the probe row", async () => {
  const probeRows = [
    queueRow(queueIds[0], targetIds[0]),
    queueRow(queueIds[1], targetIds[1]),
    queueRow(queueIds[2], targetIds[2]),
  ];
  const calls = [];
  const input = {
    actorContext: actorContext(),
    organizationId,
    pagination: { limit: 2, cursor: null },
  };
  const dependencies = {
    env: { KAI_SPRINT2_ENABLED: "true" },
    async listIntakeFileReviewQueueItems(...args) {
      calls.push(args);
      return probeRows;
    },
  };

  const result = await listIntakeFileReviewQueueItems(input, dependencies);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.items.map((item) => item.review_queue_item_id), queueIds.slice(0, 2));
  assert.deepEqual(decodeCursor(result.data.pagination.next_cursor), {
    created_at: probeRows[1].created_at,
    review_queue_item_id: probeRows[1].review_queue_item_id,
  });
  assert.notDeepEqual(decodeCursor(result.data.pagination.next_cursor), {
    created_at: probeRows[2].created_at,
    review_queue_item_id: probeRows[2].review_queue_item_id,
  });
  assert.deepEqual(calls, [[organizationId, { limit: 2, cursor: null }]]);

  dependencies.listIntakeFileReviewQueueItems = async () => [
    ...probeRows.slice(0, 2),
    queueRow(queueIds[2], targetIds[2], createdAt, { summary: `unsafe\u202Eprobe` }),
  ];
  const malformedProbe = await listIntakeFileReviewQueueItems(input, dependencies);
  assert.deepEqual(malformedProbe, buildKaiError("system_error"));
  assert.equal(JSON.stringify(malformedProbe).includes("unsafe"), false);
});

test("duplicate created_at values paginate without a skipped or duplicated queue ID", async () => {
  const orderedRows = [
    queueRow(queueIds[0], targetIds[0], createdAt),
    queueRow(queueIds[1], targetIds[1], createdAt),
    queueRow(queueIds[2], targetIds[2], createdAt),
    queueRow(queueIds[3], targetIds[3], olderCreatedAt),
  ];
  const calls = [];
  const dependencies = {
    env: { KAI_SPRINT2_ENABLED: "true" },
    async listIntakeFileReviewQueueItems(requestedOrganizationId, pagination) {
      calls.push({ requestedOrganizationId, pagination });
      const remaining = pagination.cursor
        ? orderedRows.filter((row) => (
          row.created_at < pagination.cursor.created_at
          || (
            row.created_at === pagination.cursor.created_at
            && row.review_queue_item_id < pagination.cursor.review_queue_item_id
          )
        ))
        : orderedRows;
      return remaining.slice(0, pagination.limit + 1);
    },
  };
  const common = { actorContext: actorContext(), organizationId };

  const first = await listIntakeFileReviewQueueItems({
    ...common,
    pagination: { limit: 2, cursor: null },
  }, dependencies);
  const boundary = decodeCursor(first.data.pagination.next_cursor);
  const second = await listIntakeFileReviewQueueItems({
    ...common,
    pagination: { limit: 2, cursor: boundary },
  }, dependencies);

  assert.deepEqual(boundary, { created_at: createdAt, review_queue_item_id: queueIds[1] });
  assert.deepEqual(calls[1].pagination.cursor, boundary);
  const collectedIds = [...first.data.items, ...second.data.items]
    .map((item) => item.review_queue_item_id);
  assert.deepEqual(collectedIds, queueIds);
  assert.equal(new Set(collectedIds).size, queueIds.length);
  assert.equal(second.data.pagination.next_cursor, null);
});

test("assembled production middleware and router enforce the internal-GK review-queue contract", async (t) => {
  let scenario = createScenario();
  const restoreService = intakeRouteTestables.setIntakeServiceForTest({
    async listIntakeFileReviewQueueItems(input) {
      scenario.events.push("sprint2_review_queue_route_handler");
      const result = await listIntakeFileReviewQueueItems(input, scenarioDependencies(scenario));
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

  await t.test("feature gate remains before authentication, service, and the collection read", async () => {
    scenario = createScenario();
    const response = await withFeatureFlag("false", () => getJson(server, validPath()));

    assert.equal(response.statusCode, 403);
    assert.equal(response.body.error.code, "feature_disabled");
    assert.deepEqual(scenario.events, []);
    assert.deepEqual(scenario.queueCalls, []);
  });

  await t.test("canonical authentication remains before service and the collection read", async () => {
    scenario = createScenario({ authenticated: false });
    const response = await withFeatureFlag("true", () => getJson(server, validPath()));

    assert.equal(response.statusCode, 401);
    assert.equal(response.body.error.code, "unauthorized");
    assert.deepEqual(scenario.events, [
      "outer_feature_gate_passed",
      "canonical_http_authentication",
    ]);
    assert.deepEqual(scenario.queueCalls, []);
  });

  await t.test("GK operator, reviewer, and admin each require active organization membership", async () => {
    for (const roleName of ["gk_operator", "gk_reviewer", "gk_admin"]) {
      scenario = createScenario({ roleName, queueRows: [] });
      const allowed = await withFeatureFlag("true", () => getJson(server, validPath()));
      assert.equal(allowed.statusCode, 200, roleName);
      assert.deepEqual(scenario.queueCalls, [{
        organizationId,
        pagination: { limit: 25, cursor: null },
      }], roleName);

      scenario = createScenario({ roleName, membershipState: "inactive" });
      const denied = await withFeatureFlag("true", () => getJson(server, validPath()));
      assert.equal(denied.statusCode, 403, roleName);
      assert.equal(denied.body.error.code, "authorization_denied", roleName);
      assert.equal(denied.body.blockers[0].blocking_reason, "missing_active_organization_membership");
      assert.deepEqual(scenario.queueCalls, [], roleName);
    }
  });

  await t.test("client roles pass generic read_intake but are denied by the GK route restriction", async () => {
    for (const roleName of ["client_admin", "client_reviewer", "client_contributor"]) {
      const genericAuth = validateActorCanPerformOperation(
        actorContext(roleName),
        "read_intake",
        organizationId,
      );
      assert.equal(genericAuth.ok, true, roleName);

      scenario = createScenario({ roleName });
      const response = await withFeatureFlag("true", () => getJson(server, validPath()));
      assert.equal(response.statusCode, 403, roleName);
      assert.equal(response.body.error.code, "authorization_denied", roleName);
      assert.equal(response.body.blockers[0].blocking_reason, "role_not_allowed", roleName);
      assert.deepEqual(scenario.queueCalls, [], roleName);
    }
  });

  await t.test("success makes one scoped bounded read, no target lookup, and returns only the DTO", async () => {
    scenario = createScenario();
    const response = await withFeatureFlag("true", () => getJson(server, validPath("limit=2")));

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.data.items.length, 2);
    for (const item of response.body.data.items) {
      assert.deepEqual(Object.keys(item), reviewQueueKeys);
    }
    assert.deepEqual(scenario.queueCalls, [{
      organizationId,
      pagination: { limit: 2, cursor: null },
    }]);
    assert.deepEqual(scenario.fallbackCalls, []);
    assert.equal(scenario.events.at(-1), "tenant_scoped_bounded_queue_read");
    assertForbiddenSentinelsAbsent(response.body);
  });

  await t.test("fixed active statuses pass while resolved and cancelled fail closed", async () => {
    for (const queueStatus of [
      "open",
      "in_progress",
      "blocked",
      "waiting_on_client",
      "waiting_on_gk",
    ]) {
      scenario = createScenario({
        queueRows: [queueRow(queueIds[0], targetIds[0], createdAt, { queue_status: queueStatus })],
      });
      const response = await withFeatureFlag("true", () => getJson(server, validPath()));
      assert.equal(response.statusCode, 200, queueStatus);
      assert.equal(response.body.data.items[0].queue_status, queueStatus);
    }

    for (const queueStatus of ["resolved", "cancelled"]) {
      scenario = createScenario({ queueRows: [queueRow(queueIds[0], targetIds[0], createdAt, { queue_status: queueStatus })] });
      const response = await withFeatureFlag("true", () => getJson(server, validPath()));
      assert.equal(response.statusCode, 500, queueStatus);
      assert.equal(response.body.error.code, "system_error", queueStatus);
      assert.equal(Object.hasOwn(response.body, "items"), false, queueStatus);
    }
  });

  await t.test("organization, queue type, target type, status, and UUID mismatches fail as one safe 500", async () => {
    const malformedRows = [
      ["organization", { organization_id: otherOrganizationId }],
      ["queue_type", { queue_type: "source_candidate_review" }],
      ["target_type", { target_object_type: "intake_batch" }],
      ["status", { queue_status: "resolved" }],
      ["queue_uuid", { review_queue_item_id: "not-a-uuid" }],
      ["organization_uuid", { organization_id: "not-a-uuid" }],
      ["target_uuid", { target_object_id: "not-a-uuid" }],
    ];

    for (const [name, overrides] of malformedRows) {
      const offendingMarker = Object.values(overrides)[0];
      scenario = createScenario({
        queueRows: [safeRows[0], queueRow(queueIds[1], targetIds[1], createdAt, overrides)],
      });
      const response = await withFeatureFlag("true", () => getJson(server, validPath("limit=2")));
      const serialized = JSON.stringify(response.body);
      assert.equal(response.statusCode, 500, name);
      assert.equal(response.body.error.code, "system_error", name);
      assert.equal(serialized.includes("items"), false, name);
      assert.equal(serialized.includes(String(offendingMarker)), false, name);
      assert.equal(serialized.includes(queueIds[0]), false, name);
    }
  });

  await t.test("bidi, C1, NUL, and overlength text each fail closed with no partial response", async () => {
    const hostileTextRows = [
      ["bidi", { summary: "hostile\u202Eoverride" }],
      ["c1", { summary: "hostile\u0085control" }],
      ["nul", { summary: "hostile\u0000nul" }],
      ["summary_201", { summary: "s".repeat(201) }],
      ["required_action_1001", { required_action: "a".repeat(1001) }],
    ];

    for (const [name, overrides] of hostileTextRows) {
      scenario = createScenario({
        queueRows: [safeRows[0], queueRow(queueIds[1], targetIds[1], createdAt, overrides)],
      });
      const response = await withFeatureFlag("true", () => getJson(server, validPath("limit=2")));
      const serialized = JSON.stringify(response.body);
      assert.equal(response.statusCode, 500, name);
      assert.equal(response.body.error.code, "system_error", name);
      assert.equal(serialized.includes("items"), false, name);
      assert.equal(serialized.includes(queueIds[0]), false, name);
      assert.equal(serialized.includes("hostile"), false, name);
    }
  });

  await t.test("NFC/plain text passes and markup remains inert JSON text", async () => {
    scenario = createScenario({
      queueRows: [queueRow(queueIds[0], targetIds[0], createdAt, {
        summary: "  Cafe\u0301\r\n<em>review</em>  ",
        required_action: "  **check**\rnext\tstep  ",
      })],
    });
    const response = await withFeatureFlag("true", () => getJson(server, validPath()));

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.data.items[0].summary, "Café\n<em>review</em>");
    assert.equal(response.body.data.items[0].required_action, "**check**\nnext\tstep");
    assert.equal(response.body.data.items[0].summary.includes("<em>"), true);
    assert.equal(response.body.data.items[0].required_action.includes("**"), true);
  });

  await t.test("canonical limits and malformed cursors match the established collection behavior", async () => {
    for (const { query, expectedLimit } of [
      { query: "", expectedLimit: 25 },
      { query: "limit=1", expectedLimit: 1 },
      { query: "limit=25", expectedLimit: 25 },
    ]) {
      scenario = createScenario({ queueRows: [] });
      const response = await withFeatureFlag("true", () => getJson(server, validPath(query)));
      assert.equal(response.statusCode, 200, query);
      assert.equal(response.body.data.pagination.limit, expectedLimit, query);
    }

    const invalidQueries = [
      "limit=0",
      "limit=-1",
      "limit=1.5",
      "limit=abc",
      "limit=26",
      "limit=1&limit=2",
      "offset=1",
      "cursor=not%25base64url",
      "cursor=abc%3D",
      `cursor=${encodeURIComponent(encodeRawCursor("not-json"))}`,
      `cursor=${encodeURIComponent(encodeRawCursor({ created_at: createdAt }))}`,
      `cursor=${encodeURIComponent(encodeRawCursor({
        created_at: createdAt,
        review_queue_item_id: queueIds[0],
        extra: true,
      }))}`,
      `cursor=${encodeURIComponent(encodeRawCursor({
        created_at: "2026-07-15T10:00:00Z",
        review_queue_item_id: queueIds[0],
      }))}`,
      `cursor=${encodeURIComponent(encodeRawCursor({
        created_at: createdAt,
        review_queue_item_id: "not-a-uuid",
      }))}`,
    ];

    for (const query of invalidQueries) {
      scenario = createScenario();
      const response = await withFeatureFlag("true", () => getJson(server, validPath(query)));
      assert.equal(response.statusCode, 400, query);
      assert.equal(response.body.error.code, "invalid_request", query);
      assert.deepEqual(scenario.queueCalls, [], query);
    }
  });
});
