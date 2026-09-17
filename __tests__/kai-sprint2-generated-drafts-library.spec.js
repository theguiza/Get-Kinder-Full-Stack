import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { readFileSync } from "node:fs";

import sprint2IntakeApiRouter, { __testables as intakeRouteTestables } from "../Backend/kai/routes/sprint2IntakeApi.js";
import { requireKaiSprint2Enabled } from "../Backend/kai/config/kaiSprint2Config.js";
import {
  createAttachKaiSprint2ActorContext,
  requireKaiSprint2Authenticated,
} from "../Backend/kai/middleware/kaiSprint2Authentication.js";
import {
  handleKaiSprint2JsonParserError,
  kaiSprint2ActorMutationLimiter,
  kaiSprint2MetadataJsonParser,
  kaiSprint2OrganizationMutationLimiter,
  setKaiSprint2NoStore,
} from "../Backend/kai/middleware/kaiSprint2RequestSafety.js";
import {
  listGeneratedDraftLibraryIndex,
  __generatedDraftLibraryServiceContract,
  __testables as generatedDraftLibraryServiceTestables,
} from "../Backend/kai/services/kaiGeneratedDraftLibraryService.js";
import { __generatedContentReviewPacketServiceTestables } from "../Backend/kai/services/kaiGeneratedContentService.js";
import { listGeneratedDraftLibraryIndex as readGeneratedDraftLibraryIndex } from "../Backend/kai/db/kaiGeneratedDraftLibraryReadModels.js";
import {
  CLAIM_REVIEW_DECISIONS,
  generatedDraftContentTypeLabel,
  generatedDraftLibraryIndexPath,
  generatedDraftReviewLabel,
  generatedDraftReviewPacketPath,
  projectGeneratedDraftLibraryItems,
  projectGeneratedDraftPacket,
  projectTraceability,
} from "../frontend/impactEvidenceLibraryLogic.js";

const basePath = "/api/kai/sprint2/intake";
const organizationId = "00000000-0000-4000-8000-000000000001";
const otherOrganizationId = "00000000-0000-4000-8000-000000000002";
const draftId = "00000000-0000-4000-8000-000000000777";
const reviewQueueItemId = "00000000-0000-4000-8000-000000000778";
const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" });
const actorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  organizationMemberships: [
    { organization_id: organizationId, membership_status: "active", role_name: "gk_reviewer" },
  ],
});

// Every joined export_review internal field the static contract inspects,
// defaulted to the genuine zero-review absence (all null together).
function zeroExportReviewFields() {
  return {
    export_review_queue_item_id: null,
    export_review_organization_id: null,
    export_review_queue_type: null,
    export_review_target_object_type: null,
    export_review_target_object_id: null,
    export_review_priority: null,
    export_review_queue_status: null,
    export_review_status: null,
    export_review_blocked_reason: null,
    export_review_assigned_to: null,
    export_review_due_at: null,
    export_review_summary: null,
    export_review_required_action: null,
    export_review_queue_metadata: null,
    export_review_created_by: null,
    export_review_created_by_type: null,
  };
}

// An authentic export_review row matching EXPORT_REVIEW_QUEUE_STATIC_CONTRACT
// exactly, for the given draft id and lifecycle pair - the same shape the
// single-draft read path's loadExportReviewQueueRows persists/reads.
function authenticExportReviewFields(forDraftId, queueItemId, { queueStatus, reviewStatus }) {
  return {
    export_review_queue_item_id: queueItemId,
    export_review_organization_id: organizationId,
    export_review_queue_type: "export_review",
    export_review_target_object_type: "generated_content_draft",
    export_review_target_object_id: forDraftId,
    export_review_priority: "medium",
    export_review_queue_status: queueStatus,
    export_review_status: reviewStatus,
    export_review_blocked_reason: null,
    export_review_assigned_to: null,
    export_review_due_at: null,
    export_review_summary: "Generated draft requires export review.",
    export_review_required_action:
      "Review audience authority, current eligibility, citations, and the final export gate before any export.",
    export_review_queue_metadata: {},
    export_review_created_by: null,
    export_review_created_by_type: "system",
  };
}

function draftRow(overrides = {}) {
  return {
    generated_content_draft_id: draftId,
    organization_id: organizationId,
    content_type: "evidence_summary",
    requested_audience: "internal",
    draft_status: "draft",
    review_queue_item_id: reviewQueueItemId,
    queue_status: "open",
    review_status: "needs_gk_review",
    created_at: "2026-08-15T10:00:00.000Z",
    ...zeroExportReviewFields(),
    raw_content: "must not render",
    signed_url: "must not render",
    ...overrides,
  };
}

function scenario(overrides = {}) {
  return {
    authenticated: true,
    actorContext,
    calls: [],
    result: {
      ok: true,
      data: { items: [], limit: 25, afterGeneratedContentDraftId: null, truncated: false, nextAfterGeneratedContentDraftId: null },
      error: null,
    },
    ...overrides,
  };
}

function createApp(getScenario) {
  const app = express();
  app.use(basePath, setKaiSprint2NoStore, requireKaiSprint2Enabled, kaiSprint2MetadataJsonParser);
  app.use(basePath, handleKaiSprint2JsonParserError);
  app.use(basePath, (req, res, next) => {
    const current = getScenario();
    req.isAuthenticated = () => current.authenticated;
    if (current.authenticated) {
      req.user = { id: 46 };
    }
    return next();
  });
  // Real attachment middleware, stubbed only at the resolver seam so the
  // route is exercised exactly as production mounts it (no manual
  // req.kaiSprint2ActorContext injection that would mask the middleware
  // being missing from the chain).
  const restoreActorContextMiddleware = intakeRouteTestables.setActorContextMiddlewareForTest(
    createAttachKaiSprint2ActorContext({
      resolveActorContext: async () => ({ ok: true, actorContext: getScenario().actorContext }),
    }),
  );
  app.use(
    basePath,
    requireKaiSprint2Enabled,
    kaiSprint2OrganizationMutationLimiter,
    kaiSprint2ActorMutationLimiter,
    requireKaiSprint2Authenticated,
    sprint2IntakeApiRouter,
  );
  return { app, restoreActorContextMiddleware };
}

async function listen(app) {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1");
    server.once("listening", () => resolve(server));
    server.once("error", reject);
  });
}

async function requestJson(server, path) {
  const { port } = server.address();
  return await new Promise((resolve, reject) => {
    const request = http.request({ hostname: "127.0.0.1", port, path, method: "GET" }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        statusCode: response.statusCode,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
      }));
    });
    request.on("error", reject);
    request.end();
  });
}

test("Generated Drafts index route is mounted once as authenticated read-only GET", () => {
  const matches = sprint2IntakeApiRouter.stack
    .filter((layer) => layer.route?.path === "/admin/organizations/:organizationId/generated-content-drafts" && layer.route?.methods?.get);
  assert.equal(matches.length, 1);
  assert.deepEqual(Object.keys(matches[0].route.methods), ["get"]);
});

test("Generated Drafts index route delegates to the generated-draft library service and rejects unknown query fields", async (t) => {
  let current = scenario({
    result: {
      ok: true,
      data: {
        items: [{
          generatedContentDraftId: draftId,
          contentType: "evidence_summary",
          requestedAudience: "internal",
          draftStatus: "draft",
          reviewQueueItemId,
          queueStatus: "open",
          reviewStatus: "needs_gk_review",
          createdAt: "2026-08-15T10:00:00.000Z",
        }],
        limit: 25,
        afterGeneratedContentDraftId: null,
        truncated: false,
        nextAfterGeneratedContentDraftId: null,
      },
      error: null,
    },
  });
  const restore = intakeRouteTestables.setIntakeServiceForTest({
    async listGeneratedDraftLibraryIndex(input) {
      current.calls.push(input);
      return current.result;
    },
  });
  const originalFeatureFlag = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "true";
  const { app, restoreActorContextMiddleware } = createApp(() => current);
  const server = await listen(app);

  t.after(async () => {
    restore();
    restoreActorContextMiddleware();
    if (originalFeatureFlag === undefined) delete process.env.KAI_SPRINT2_ENABLED;
    else process.env.KAI_SPRINT2_ENABLED = originalFeatureFlag;
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  const path = `${basePath}/admin/organizations/${organizationId}/generated-content-drafts?limit=25`;
  const rejected = await requestJson(server, `${path}&raw_content=1`);
  assert.equal(rejected.statusCode, 422);
  assert.deepEqual(current.calls, []);

  const first = await requestJson(server, path);
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.data.items[0].generatedContentDraftId, draftId);
  assert.deepEqual(current.calls, [{
    organizationId,
    limit: 25,
    afterGeneratedContentDraftId: null,
    actorContext,
  }]);

  // A second, independent request (simulating a fresh Library reload) rediscovers
  // the same persisted draft without any generation/provider dependency.
  const second = await requestJson(server, path);
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.data.items[0].generatedContentDraftId, draftId);
  assert.equal(current.calls.length, 2);
});

test("Generated Drafts index route populates req.kaiSprint2ActorContext through the real attachment middleware, not manual test injection", async (t) => {
  // Unlike createApp() above, this app never assigns req.kaiSprint2ActorContext
  // directly. It only sets req.user and req.isAuthenticated, then relies on the
  // production middleware chain (requireKaiSprint2Authenticated followed by the
  // router-mounted attachKaiSprint2ActorContext) to populate the actor context
  // from a stubbed resolver, exactly as production does from the real one.
  let observedResolverCalls = 0;
  const restoreActorContextMiddleware = intakeRouteTestables.setActorContextMiddlewareForTest(
    createAttachKaiSprint2ActorContext({
      resolveActorContext: async () => {
        observedResolverCalls += 1;
        return { ok: true, actorContext };
      },
    }),
  );

  const calls = [];
  const restoreService = intakeRouteTestables.setIntakeServiceForTest({
    async listGeneratedDraftLibraryIndex(input) {
      calls.push(input);
      return {
        ok: true,
        data: { items: [], limit: 25, afterGeneratedContentDraftId: null, truncated: false, nextAfterGeneratedContentDraftId: null },
        error: null,
      };
    },
  });

  const originalFeatureFlag = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "true";

  const app = express();
  app.use(basePath, setKaiSprint2NoStore, requireKaiSprint2Enabled, kaiSprint2MetadataJsonParser);
  app.use(basePath, handleKaiSprint2JsonParserError);
  app.use(basePath, (req, res, next) => {
    req.isAuthenticated = () => true;
    req.user = { id: 46 };
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
  const server = await listen(app);

  t.after(async () => {
    restoreActorContextMiddleware();
    restoreService();
    if (originalFeatureFlag === undefined) delete process.env.KAI_SPRINT2_ENABLED;
    else process.env.KAI_SPRINT2_ENABLED = originalFeatureFlag;
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  const path = `${basePath}/admin/organizations/${organizationId}/generated-content-drafts?limit=25`;
  const response = await requestJson(server, path);

  assert.equal(response.statusCode, 200);
  assert.equal(observedResolverCalls, 1);
  assert.equal(calls.length, 1);
  // The service must receive the resolver's full actor context (roles,
  // memberships, etc.), not a hand-built {actorType, actorUserId} stub.
  assert.deepEqual(calls[0].actorContext, actorContext);
});

test("Generated Drafts library service authorizes like the existing generated-draft read packet and fails closed", async () => {
  let calls = 0;
  const deps = {
    env: enabledEnv,
    async listGeneratedDraftLibraryIndex() {
      calls += 1;
      return [draftRow()];
    },
  };

  const allowed = await listGeneratedDraftLibraryIndex(
    { organizationId, limit: 25, afterGeneratedContentDraftId: null, actorContext },
    deps,
  );
  assert.equal(allowed.ok, true);
  assert.equal(calls, 1);
  assert.equal(allowed.data.items.length, 1);
  assert.equal(allowed.data.items[0].contentType, "evidence_summary");
  assert.equal(allowed.data.items[0].requestedAudience, "internal");
  assert.equal(allowed.data.items[0].draftStatus, "draft");
  assert.equal(JSON.stringify(allowed).includes("must not render"), false);

  const globalAdmin = await listGeneratedDraftLibraryIndex(
    {
      organizationId,
      limit: 25,
      afterGeneratedContentDraftId: null,
      actorContext: {
        ...actorContext,
        kaiRoles: ["gk_admin"],
        organizationMemberships: [{ organization_id: organizationId, membership_status: "active", role_name: "client_contributor" }],
      },
    },
    deps,
  );
  assert.equal(globalAdmin.ok, true);

  // Cross-tenant: actor has no active membership in the requested organization.
  const crossTenant = await listGeneratedDraftLibraryIndex(
    { organizationId: otherOrganizationId, limit: 25, afterGeneratedContentDraftId: null, actorContext },
    deps,
  );
  assert.equal(crossTenant.ok, false);
  assert.equal(crossTenant.error.code, "authorization_denied");

  // Disallowed role for this operation.
  const deniedRole = await listGeneratedDraftLibraryIndex(
    {
      organizationId,
      limit: 25,
      afterGeneratedContentDraftId: null,
      actorContext: {
        ...actorContext,
        organizationMemberships: [{ organization_id: organizationId, membership_status: "active", role_name: "gk_operator" }],
      },
    },
    deps,
  );
  assert.equal(deniedRole.ok, false);
  assert.equal(deniedRole.error.code, "authorization_denied");

  // Feature disabled fails closed with no read model call.
  calls = 0;
  const disabled = await listGeneratedDraftLibraryIndex(
    { organizationId, limit: 25, afterGeneratedContentDraftId: null, actorContext },
    { ...deps, env: { KAI_SPRINT2_ENABLED: "false", KAI_GENERATION_ENABLED: "true" } },
  );
  assert.equal(disabled.ok, false);
  assert.equal(disabled.error.code, "feature_disabled");
  assert.equal(calls, 0);
});

test("Generated Drafts library index admits all four canonical generated-content types, including data_gap_memo, and excludes unsupported types", async () => {
  for (const contentType of ["evidence_summary", "impact_narrative", "readiness_assessment", "data_gap_memo"]) {
    const deps = {
      env: enabledEnv,
      async listGeneratedDraftLibraryIndex() {
        return [draftRow({ content_type: contentType })];
      },
    };
    const result = await listGeneratedDraftLibraryIndex(
      { organizationId, limit: 25, afterGeneratedContentDraftId: null, actorContext },
      deps,
    );
    assert.equal(result.ok, true, `${contentType}: expected ok=true, got ${JSON.stringify(result.error)}`);
    assert.equal(result.data.items[0].contentType, contentType);
  }

  // An unsupported content type still fails closed as system_error rather
  // than being silently admitted alongside the four canonical types.
  const deps = {
    env: enabledEnv,
    async listGeneratedDraftLibraryIndex() {
      return [draftRow({ content_type: "board_update" })];
    },
  };
  const result = await listGeneratedDraftLibraryIndex(
    { organizationId, limit: 25, afterGeneratedContentDraftId: null, actorContext },
    deps,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "system_error");
});

test("Generated Drafts read model index includes data_gap_memo in the generic content_type allowlist alongside the other three canonical types", async () => {
  let observed = null;
  await readGeneratedDraftLibraryIndex(organizationId, { limit: 25, afterGeneratedContentDraftId: null }, {
    async query(sql, params) {
      observed = { sql, params };
      return { rows: [] };
    },
  });
  assert.match(observed.sql, /AND d\.content_type IN \('evidence_summary', 'impact_narrative', 'readiness_assessment', 'data_gap_memo', 'case_for_support'\)/);
});

test("Generated Drafts library index reuses e890a8c's export-review role boundary: gk_reviewer never receives identity/state even when a row exists", async () => {
  const deps = {
    env: enabledEnv,
    async listGeneratedDraftLibraryIndex() {
      return [draftRow(authenticExportReviewFields(draftId, "00000000-0000-4000-8000-000000000901", {
        queueStatus: "open",
        reviewStatus: "needs_gk_review",
      }))];
    },
  };
  const result = await listGeneratedDraftLibraryIndex(
    { organizationId, limit: 25, afterGeneratedContentDraftId: null, actorContext },
    deps,
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.items[0].exportReviewVisible, false);
  assert.equal(result.data.items[0].exportReviewQueueItemId, null);
  assert.equal(result.data.items[0].exportReviewQueueStatus, null);
  assert.equal(result.data.items[0].exportReviewStatus, null);
});

test("Generated Drafts library index recovers a genuine zero-export-review-state as null (not restricted) for an authorized actor, and never fabricates an id", async () => {
  const gkAdminActor = {
    ...actorContext,
    organizationMemberships: [{ organization_id: organizationId, membership_status: "active", role_name: "gk_admin" }],
  };
  const deps = {
    env: enabledEnv,
    async listGeneratedDraftLibraryIndex() {
      return [draftRow()];
    },
  };
  const result = await listGeneratedDraftLibraryIndex(
    { organizationId, limit: 25, afterGeneratedContentDraftId: null, actorContext: gkAdminActor },
    deps,
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.items[0].exportReviewVisible, true);
  assert.equal(result.data.items[0].exportReviewQueueItemId, null);
  assert.equal(result.data.items[0].exportReviewQueueStatus, null);
  assert.equal(result.data.items[0].exportReviewStatus, null);
});

test("Generated Drafts library index recovers open/in_progress/resolved export-review state per draft for an authorized actor without cross-wiring queue ids across drafts", async () => {
  const gkAdminActor = {
    ...actorContext,
    organizationMemberships: [{ organization_id: organizationId, membership_status: "active", role_name: "gk_admin" }],
  };
  const draftIdOpen = "00000000-0000-4000-8000-000000000801";
  const draftIdInProgress = "00000000-0000-4000-8000-000000000802";
  const draftIdResolved = "00000000-0000-4000-8000-000000000803";
  const queueIdOpen = "00000000-0000-4000-8000-000000000811";
  const queueIdInProgress = "00000000-0000-4000-8000-000000000812";
  const queueIdResolved = "00000000-0000-4000-8000-000000000813";
  const deps = {
    env: enabledEnv,
    async listGeneratedDraftLibraryIndex() {
      return [
        draftRow({
          generated_content_draft_id: draftIdOpen,
          ...authenticExportReviewFields(draftIdOpen, queueIdOpen, { queueStatus: "open", reviewStatus: "needs_gk_review" }),
        }),
        draftRow({
          generated_content_draft_id: draftIdInProgress,
          ...authenticExportReviewFields(draftIdInProgress, queueIdInProgress, { queueStatus: "in_progress", reviewStatus: "needs_gk_review" }),
        }),
        draftRow({
          generated_content_draft_id: draftIdResolved,
          ...authenticExportReviewFields(draftIdResolved, queueIdResolved, { queueStatus: "resolved", reviewStatus: "resolved" }),
        }),
        draftRow({ generated_content_draft_id: draftId }),
      ];
    },
  };
  const result = await listGeneratedDraftLibraryIndex(
    { organizationId, limit: 25, afterGeneratedContentDraftId: null, actorContext: gkAdminActor },
    deps,
  );
  assert.equal(result.ok, true);
  const byDraftId = Object.fromEntries(result.data.items.map((item) => [item.generatedContentDraftId, item]));
  assert.equal(byDraftId[draftIdOpen].exportReviewQueueItemId, queueIdOpen);
  assert.equal(byDraftId[draftIdOpen].exportReviewQueueStatus, "open");
  assert.equal(byDraftId[draftIdInProgress].exportReviewQueueItemId, queueIdInProgress);
  assert.equal(byDraftId[draftIdInProgress].exportReviewQueueStatus, "in_progress");
  assert.equal(byDraftId[draftIdResolved].exportReviewQueueItemId, queueIdResolved);
  assert.equal(byDraftId[draftIdResolved].exportReviewQueueStatus, "resolved");
  assert.equal(byDraftId[draftId].exportReviewQueueItemId, null);
});

test("Generated Drafts library index export-review row validator rejects a fabricated id/state combination as system_error", async () => {
  const gkAdminActor = {
    ...actorContext,
    organizationMemberships: [{ organization_id: organizationId, membership_status: "active", role_name: "gk_admin" }],
  };
  const deps = {
    env: enabledEnv,
    async listGeneratedDraftLibraryIndex() {
      return [draftRow(authenticExportReviewFields(draftId, "00000000-0000-4000-8000-000000000901", {
        queueStatus: "not_a_real_status",
        reviewStatus: "needs_gk_review",
      }))];
    },
  };
  const result = await listGeneratedDraftLibraryIndex(
    { organizationId, limit: 25, afterGeneratedContentDraftId: null, actorContext: gkAdminActor },
    deps,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "system_error");
});

test("Generated Drafts library index export-review validator reuses the exact single-draft static contract + lifecycle check: authentic rows pass, mutations fail closed", async () => {
  const gkAdminActor = {
    ...actorContext,
    organizationMemberships: [{ organization_id: organizationId, membership_status: "active", role_name: "gk_admin" }],
  };
  const queueItemId = "00000000-0000-4000-8000-000000000901";
  const authentic = () => authenticExportReviewFields(draftId, queueItemId, { queueStatus: "open", reviewStatus: "needs_gk_review" });

  async function evaluate(rowOverrides) {
    const deps = {
      env: enabledEnv,
      async listGeneratedDraftLibraryIndex() {
        return [draftRow(rowOverrides)];
      },
    };
    return listGeneratedDraftLibraryIndex(
      { organizationId, limit: 25, afterGeneratedContentDraftId: null, actorContext: gkAdminActor },
      deps,
    );
  }

  const cases = [
    { name: "authentic open row", overrides: authentic(), expectOk: true },
    { name: "authentic in_progress row", overrides: authenticExportReviewFields(draftId, queueItemId, { queueStatus: "in_progress", reviewStatus: "needs_gk_review" }), expectOk: true },
    { name: "authentic resolved row", overrides: authenticExportReviewFields(draftId, queueItemId, { queueStatus: "resolved", reviewStatus: "resolved" }), expectOk: true },
    { name: "genuine zero-review absence", overrides: zeroExportReviewFields(), expectOk: true },
    { name: "wrong priority", overrides: { ...authentic(), export_review_priority: "high" }, expectOk: false },
    { name: "non-null blocked_reason", overrides: { ...authentic(), export_review_blocked_reason: "blocked" }, expectOk: false },
    { name: "wrong summary", overrides: { ...authentic(), export_review_summary: "tampered summary" }, expectOk: false },
    { name: "wrong required_action", overrides: { ...authentic(), export_review_required_action: "tampered action" }, expectOk: false },
    { name: "non-empty queue_metadata", overrides: { ...authentic(), export_review_queue_metadata: { note: "x" } }, expectOk: false },
    { name: "non-null created_by", overrides: { ...authentic(), export_review_created_by: "90000000-0000-4000-8000-000000000009" }, expectOk: false },
    { name: "wrong created_by_type", overrides: { ...authentic(), export_review_created_by_type: "human" }, expectOk: false },
    { name: "wrong queue_type", overrides: { ...authentic(), export_review_queue_type: "generated_content_review" }, expectOk: false },
    { name: "wrong target_object_type", overrides: { ...authentic(), export_review_target_object_type: "claim" }, expectOk: false },
    { name: "target_object_id mismatch (cross-draft)", overrides: { ...authentic(), export_review_target_object_id: "00000000-0000-4000-8000-000000000999" }, expectOk: false },
    { name: "organization_id mismatch (cross-tenant)", overrides: { ...authentic(), export_review_organization_id: otherOrganizationId }, expectOk: false },
    { name: "invalid lifecycle pair", overrides: { ...authentic(), export_review_queue_status: "blocked", export_review_status: "needs_gk_review" }, expectOk: false },
    { name: "mismatched lifecycle pair (open queue, resolved review)", overrides: { ...authentic(), export_review_queue_status: "open", export_review_status: "resolved" }, expectOk: false },
    { name: "partially populated LEFT JOIN (id present, rest null)", overrides: { ...zeroExportReviewFields(), export_review_queue_item_id: queueItemId }, expectOk: false },
    { name: "partially populated LEFT JOIN (id absent, one field leaks)", overrides: { ...zeroExportReviewFields(), export_review_priority: "medium" }, expectOk: false },
  ];

  for (const { name, overrides, expectOk } of cases) {
    const result = await evaluate(overrides);
    assert.equal(result.ok, expectOk, `${name}: expected ok=${expectOk}, got ${JSON.stringify(result.error || result.data)}`);
    if (!expectOk) assert.equal(result.error.code, "system_error", `${name}: expected system_error`);
  }
});

test("Generated Drafts library service pins draftStatus=draft even for a resolved review lifecycle", async () => {
  const deps = {
    env: enabledEnv,
    async listGeneratedDraftLibraryIndex() {
      return [draftRow({ queue_status: "resolved", review_status: "resolved" })];
    },
  };
  const result = await listGeneratedDraftLibraryIndex(
    { organizationId, limit: 25, afterGeneratedContentDraftId: null, actorContext },
    deps,
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.items[0].draftStatus, "draft");
  assert.equal(result.data.items[0].queueStatus, "resolved");
  assert.equal(result.data.items[0].reviewStatus, "resolved");
  assert.equal(generatedDraftReviewLabel(result.data.items[0].queueStatus, result.data.items[0].reviewStatus), "Review completed");
});

test("Generated Drafts read model is bounded, organization-scoped, deterministically ordered, and read-only", async () => {
  let observed = null;
  await readGeneratedDraftLibraryIndex(organizationId, { limit: 25, afterGeneratedContentDraftId: draftId }, {
    async query(sql, params) {
      observed = { sql, params };
      return { rows: [] };
    },
  });
  assert.match(observed.sql, /WHERE d\.organization_id = \$1::uuid/);
  assert.match(observed.sql, /AND d\.content_type IN \('evidence_summary', 'impact_narrative', 'readiness_assessment', 'data_gap_memo', 'case_for_support'\)/);
  assert.match(observed.sql, /AND d\.requested_audience = 'internal'/);
  assert.match(observed.sql, /AND d\.draft_status = 'draft'/);
  assert.match(observed.sql, /AND q\.priority = 'medium'/);
  assert.match(observed.sql, /AND q\.assigned_to IS NULL/);
  assert.match(observed.sql, /AND q\.due_at IS NULL/);
  assert.match(observed.sql, /AND q\.created_by_type = 'system'/);
  assert.match(observed.sql, /\(q\.queue_status = 'open' AND q\.review_status = 'needs_gk_review'\)/);
  assert.match(observed.sql, /\(q\.queue_status = 'in_progress' AND q\.review_status = 'needs_gk_review'\)/);
  assert.match(observed.sql, /\(q\.queue_status = 'resolved' AND q\.review_status = 'resolved'\)/);
  assert.match(observed.sql, /AND d\.generated_content_draft_id > \$3::uuid/);
  assert.match(observed.sql, /ORDER BY d\.generated_content_draft_id ASC/);
  assert.match(observed.sql, /LIMIT \$2::int/);
  assert.deepEqual(observed.params, [organizationId, 26, draftId]);
  assert.doesNotMatch(observed.sql, /\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bTRUNCATE\b|FOR UPDATE/i);

  // The batched export_review LEFT JOIN reuses the exact same organization +
  // generated_content_draft_id -> 0-or-1-row relationship the single-draft
  // read path (loadExportReviewQueueRows) already established, joined once
  // across the whole page instead of a per-draft follow-up call.
  assert.match(observed.sql, /LEFT JOIN kai\.review_queue_items eq/);
  assert.match(observed.sql, /ON eq\.organization_id = d\.organization_id/);
  assert.match(observed.sql, /AND eq\.queue_type = 'export_review'/);
  assert.match(observed.sql, /AND eq\.target_object_type = 'generated_content_draft'/);
  assert.match(observed.sql, /AND eq\.target_object_id = d\.generated_content_draft_id/);
  assert.match(observed.sql, /eq\.review_queue_item_id::text AS export_review_queue_item_id/);

  // The full internal export_review contract field set is selected too - not
  // for the public list DTO, but so the service can validate the joined row
  // against the same isExportReviewQueueContractRow static contract the
  // single-draft read applies.
  assert.match(observed.sql, /eq\.organization_id::text AS export_review_organization_id/);
  assert.match(observed.sql, /eq\.queue_type AS export_review_queue_type/);
  assert.match(observed.sql, /eq\.target_object_type AS export_review_target_object_type/);
  assert.match(observed.sql, /eq\.target_object_id::text AS export_review_target_object_id/);
  assert.match(observed.sql, /eq\.priority AS export_review_priority/);
  assert.match(observed.sql, /eq\.blocked_reason AS export_review_blocked_reason/);
  assert.match(observed.sql, /eq\.assigned_to::text AS export_review_assigned_to/);
  assert.match(observed.sql, /eq\.due_at AS export_review_due_at/);
  assert.match(observed.sql, /eq\.summary AS export_review_summary/);
  assert.match(observed.sql, /eq\.required_action AS export_review_required_action/);
  assert.match(observed.sql, /eq\.queue_metadata AS export_review_queue_metadata/);
  assert.match(observed.sql, /eq\.created_by::text AS export_review_created_by/);
  assert.match(observed.sql, /eq\.created_by_type AS export_review_created_by_type/);
});

test("Generated Drafts review-label mapping reflects open/in_progress/resolved server states", () => {
  assert.equal(generatedDraftReviewLabel("open", "needs_gk_review"), "Needs review");
  assert.equal(generatedDraftReviewLabel("in_progress", "needs_gk_review"), "In review");
  assert.equal(generatedDraftReviewLabel("resolved", "resolved"), "Review completed");
});

test("Generated Drafts frontend projection strips unsafe fields and preserves safe list fields", () => {
  const items = projectGeneratedDraftLibraryItems({
    items: [{
      generatedContentDraftId: draftId,
      contentType: "evidence_summary",
      requestedAudience: "internal",
      draftStatus: "draft",
      reviewQueueItemId,
      queueStatus: "open",
      reviewStatus: "needs_gk_review",
      createdAt: "2026-08-15T10:00:00.000Z",
      raw_content: "must not render",
      signed_url: "must not render",
    }],
  });
  assert.equal(items.length, 1);
  assert.equal(JSON.stringify(items).includes("must not render"), false);
  assert.equal(
    generatedDraftLibraryIndexPath(organizationId),
    `${basePath}/admin/organizations/${organizationId}/generated-content-drafts?limit=25`,
  );
  assert.equal(generatedDraftContentTypeLabel("evidence_summary", "internal"), "Evidence Summary · Internal");
  assert.equal(generatedDraftContentTypeLabel("impact_narrative", "internal"), "Impact Narrative · Internal");
  assert.equal(generatedDraftContentTypeLabel("readiness_assessment", "internal"), "Readiness Assessment · Internal");
  assert.equal(generatedDraftContentTypeLabel("data_gap_memo", "internal"), "Data Gap Memo · Internal");
  assert.equal(generatedDraftContentTypeLabel("case_for_support", "internal"), "Case for Support · Internal");
  assert.equal(generatedDraftContentTypeLabel("case_for_support", "funder"), "Case for Support · funder");
  assert.notEqual(generatedDraftLibraryIndexPath(organizationId), generatedDraftReviewPacketPath(organizationId, draftId));
});

test("Generated Drafts library source causes no model/provider call and no unsafe field rendering", () => {
  const serviceSource = readFileSync("Backend/kai/services/kaiGeneratedDraftLibraryService.js", "utf8");
  const readModelSource = readFileSync("Backend/kai/db/kaiGeneratedDraftLibraryReadModels.js", "utf8");
  const uiSource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");
  const logicSource = readFileSync("frontend/impactEvidenceLibraryLogic.js", "utf8");

  assert.doesNotMatch(serviceSource, /kaiEvidenceSummaryDraftGenerator|draftGenerator|createEvidenceSummaryDraft/i);
  assert.doesNotMatch(readModelSource, /\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bTRUNCATE\b|FOR UPDATE/i);
  assert.match(uiSource, /Generated Drafts/);
  assert.match(uiSource + logicSource, /generatedDraftLibraryIndexPath|generated-content-drafts\?limit/);

  // A1C-2: the old file-wide `/\bfinal\b|\bapproved\b|export-ready/i` ban
  // regressed once A1/A1C-1 legitimately added human-review wire vocabulary
  // ("approved", "approved_with_limitation") - plus the safety disclaimer
  // that spells out this very invariant in prose ("not final ... release
  // authority") - elsewhere in these two SHARED component files. That
  // vocabulary is legitimate and must not be renamed just to satisfy a test.
  // The test boundary is repaired, not the vocabulary: the ban is narrowed to
  // exactly the Generated-Drafts-only source regions, located by stable,
  // unique code markers (not line numbers) so the slice tracks the file
  // instead of a snapshot of it.
  function sliceBetween(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    assert.ok(start !== -1, `A1C-2 test-boundary marker not found: ${startMarker}`);
    if (endMarker === null) return source.slice(start);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.ok(end !== -1, `A1C-2 test-boundary marker not found: ${endMarker}`);
    return source.slice(start, end);
  }

  const generatedDraftsUiSurface = [
    sliceBetween(uiSource, "const loadGeneratedDrafts = useCallback", "const loadRequirementsReadiness = useCallback"),
    sliceBetween(uiSource, '<h5 className="mb-0">Generated Drafts</h5>', '<div className="admin-card'),
    sliceBetween(uiSource, "{generatedDraftPacket ? (", null),
  ].join("\n");
  const generatedDraftsLogicSurface = [
    sliceBetween(logicSource, "export function generatedDraftLibraryIndexPath", "export function evidenceExtractionPath"),
    sliceBetween(logicSource, "export function generatedContentReviewStartPath", "export function reviewTransitionBody"),
    sliceBetween(logicSource, "export function projectGeneratedDraftPacket", null),
  ].join("\n");
  const generatedDraftsSurface = generatedDraftsUiSurface + generatedDraftsLogicSurface;

  // Does not expose final/export-ready/released state, and does not infer
  // release authority from claim approval: "approved" is legitimate
  // vocabulary elsewhere in these files, but nothing in the Generated-Drafts-
  // only surface needs to reason about claim/evidence approval to decide what
  // a generated draft looks like, so it must never appear here either.
  assert.doesNotMatch(generatedDraftsSurface, /\bfinal\b|export-ready|\breleased?\b|\bapproved\b/i);
  // Does not expose prohibited/raw/private fields (whole-file: legitimate
  // nowhere in this component).
  assert.doesNotMatch(uiSource + logicSource, /raw_content|signed_url|storage_object|api[_-]?key|secret/i);

  assert.deepEqual(
    [...__generatedDraftLibraryServiceContract.GENERATED_DRAFT_LIBRARY_READ_ROLES],
    ["gk_admin", "gk_reviewer"],
  );
  assert.equal(__generatedDraftLibraryServiceContract.GENERATED_DRAFT_LIBRARY_READ_OPERATION, "get_generated_draft_review_packet");
  assert.equal(typeof generatedDraftLibraryServiceTestables.responseDraftSummary, "function");
});

test("A1C-2 regression: a claim review decision of 'approved' is real wire vocabulary, and it confers no final/export/release authority on generated drafts", async () => {
  // Fact 1: "approved" is legitimate, current claim-review wire vocabulary -
  // not something this suite may rename or remove - and the traceability
  // projection surfaces it verbatim.
  assert.ok(CLAIM_REVIEW_DECISIONS.includes("approved"));
  const traceability = projectTraceability({
    requestedAudience: "internal",
    eligible: true,
    blockerCodes: [],
    affectedDimensionKeys: [],
    affectedObjectIds: [],
    claim: { audience_gates: {} },
    evidence: {},
    claim_review: {},
    dimensions: {},
    gap_items: [],
    client_followup_workflows: [],
    potential_conflict_groups: [],
    claim_review_decision: {
      decision_id: "00000000-0000-4000-8000-000000000902",
      decision_outcome: "approved",
      approved_audiences: ["internal", "funder"],
    },
  });
  assert.equal(traceability.claimReviewDecision.decisionOutcome, "approved");

  // Fact 2: that same approved claim decision has zero bearing on what a
  // generated draft is allowed to look like. The generated-draft projection
  // and the read-only service both still pin draftStatus to "draft" and
  // requestedAudience to "internal" regardless, and expose no final/export/
  // released/approved field of their own.
  const packet = projectGeneratedDraftPacket({
    generatedContentDraftId: draftId,
    contentType: "evidence_summary",
    draftStatus: "draft",
    requestedAudience: "internal",
    reviewQueueItemId,
    queueStatus: "resolved",
    reviewStatus: "resolved",
    currentUseEligible: true,
    blocks: [{ ordinal: 1, text: "Enrollment increased.", citations: [] }],
  });
  assert.equal(packet.draftStatus, "draft");
  assert.doesNotMatch(JSON.stringify(packet), /\bfinal\b|export-ready|\breleased?\b|\bapproved\b/i);

  const deps = {
    env: enabledEnv,
    async listGeneratedDraftLibraryIndex() {
      // Simulating the read model returning a draft whose linked claim has
      // already been through an "approved" human review - the read model
      // itself never even carries a decision_outcome/approved field, since
      // it is scoped to kai.generated_content_drafts + its own review queue.
      return [draftRow({ queue_status: "resolved", review_status: "resolved" })];
    },
  };
  const result = await listGeneratedDraftLibraryIndex(
    { organizationId, limit: 25, afterGeneratedContentDraftId: null, actorContext },
    deps,
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.items[0].draftStatus, "draft");
  assert.equal(result.data.items[0].requestedAudience, "internal");
  assert.doesNotMatch(JSON.stringify(result), /\bfinal\b|export-ready|\breleased?\b|\bapproved\b/i);
});

// CONFLICTS_GAPS traceability-repair proof: the review packet's own
// per-citation `affectedDimensionKeys`/`affectedObjectIds` (the specific
// coverage-dimension/conflict-or-gap object ids a citation's blockerCodes
// refer to - postgresClaimTraceabilityRepository.js's `affectedDimensionKeys`/
// `affectedObjectIds` sets, carried verbatim through
// postgresGeneratedContentRepository.js's `toReviewPacket` citation shape and
// the service DTO's CITATION_KEYS) already reached
// `projectGeneratedDraftPacket`'s per-citation projection (asserted below,
// unchanged), but the one generic selected-draft review-packet render
// location (`{generatedDraftPacket ? (` in ImpactEvidenceLibrary.jsx) never
// rendered either field to the reviewer - only the opaque `blockerCodes`
// array, with no specific affected dimension/object identifying which
// coverage gap or conflict a code refers to. This is a render-only repair:
// no DTO, service, repository, schema, or projection-function change. Proved
// horizontally for all four current content types, since this render
// location and the citation shape are exactly the same code for all four
// (content_type is only ever displayed as a label here, never branched on).
test("Generated Drafts selected-draft review surface now renders affectedDimensionKeys/affectedObjectIds for every citation, for all four content types (CONFLICTS_GAPS repair)", () => {
  const uiSource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");

  function sliceBetween(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    assert.ok(start !== -1, `test-boundary marker not found: ${startMarker}`);
    if (endMarker === null) return source.slice(start);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.ok(end !== -1, `test-boundary marker not found: ${endMarker}`);
    return source.slice(start, end);
  }

  // RENDER_LOCATION: the generic selected-draft review packet block, the
  // same one the existing A1C-2 test above slices with the identical marker.
  const selectedDraftReviewSurface = sliceBetween(uiSource, "{generatedDraftPacket ? (", null);
  assert.match(selectedDraftReviewSurface, /citation\.affectedDimensionKeys\.join\(", "\)/);
  assert.match(selectedDraftReviewSurface, /citation\.affectedObjectIds\.join\(", "\)/);
  // Still renders the pre-existing WHY_CAN_KAI_SAY_THIS/SOURCE/
  // EVIDENCE_STRENGTH/REVIEWER_STATUS fields this repair must not regress.
  assert.match(selectedDraftReviewSurface, /citation\.claimId/);
  assert.match(selectedDraftReviewSurface, /citation\.sourceId/);
  assert.match(selectedDraftReviewSurface, /citation\.supportStrength/);
  assert.match(selectedDraftReviewSurface, /generatedDraftPacket\.queueStatus.*generatedDraftPacket\.reviewStatus/);

  // FRONTEND_FIELD: projectGeneratedDraftPacket already carries both fields
  // through untouched, for all four content types (this function does not
  // branch on contentType at all - proved directly here rather than assumed).
  for (const contentType of ["evidence_summary", "impact_narrative", "readiness_assessment", "data_gap_memo"]) {
    const packet = projectGeneratedDraftPacket({
      generatedContentDraftId: draftId,
      contentType,
      draftStatus: "draft",
      requestedAudience: "internal",
      reviewQueueItemId,
      queueStatus: "resolved",
      reviewStatus: "resolved",
      currentUseEligible: true,
      blocks: [{
        ordinal: 1,
        text: "Enrollment increased.",
        citations: [{
          claimId: "00000000-0000-4000-8000-000000000901",
          evidenceItemId: "00000000-0000-4000-8000-000000000902",
          sourceId: "00000000-0000-4000-8000-000000000903",
          sourceVersionId: "00000000-0000-4000-8000-000000000904",
          supportStrength: "reviewed_supported",
          claimReviewStatus: "reviewed",
          evidenceReviewStatus: "reviewed",
          currentEligible: false,
          blockerCodes: ["coverage_dimension_unresolved", "potential_conflict_review_unresolved"],
          affectedDimensionKeys: ["financial_health"],
          affectedObjectIds: ["00000000-0000-4000-8000-000000000905"],
        }],
      }],
    });
    const citation = packet.blocks[0].citations[0];
    assert.deepEqual(citation.affectedDimensionKeys, ["financial_health"]);
    assert.deepEqual(citation.affectedObjectIds, ["00000000-0000-4000-8000-000000000905"]);
  }
});

// SOURCE + ALLOWED_AUDIENCE traceability-repair proof: `sourceCode` (the
// governed human-readable source identity, `evaluated.source.source_code`
// - already computed by the same evaluator `toReviewPacket` calls, and
// already rendered elsewhere in this same file for the separate Data
// Sources browser, `source.sourceCode` ~L4364) and `approvedAudiences` (the
// claim's own current authoritative audience approval,
// `evaluated.claim_review_decision.approved_audiences` - distinct from the
// draft-level `requestedAudience`, which is only what generation was
// originally requested for) were both computed by the traceability
// evaluator but dropped inside `toReviewPacket`'s citation builder
// (postgresGeneratedContentRepository.js) before ever reaching the service
// DTO. This proof, plus the widened `CITATION_KEYS` in
// kaiGeneratedContentService.js/kaiExportReviewService.js and the widened
// `projectGeneratedDraftPacket` projection, closes both gaps end to end: no
// new schema, no new migration, no new product-semantic decision - both
// values already existed in the same evaluator output `toReviewPacket`
// already reads.
test("Generated Drafts selected-draft review surface now renders sourceCode and approvedAudiences for every citation, for all four content types (SOURCE + ALLOWED_AUDIENCE repair)", () => {
  const uiSource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");

  function sliceBetween(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    assert.ok(start !== -1, `test-boundary marker not found: ${startMarker}`);
    if (endMarker === null) return source.slice(start);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.ok(end !== -1, `test-boundary marker not found: ${endMarker}`);
    return source.slice(start, end);
  }

  // RENDER_LOCATION: the same generic selected-draft review packet block.
  const selectedDraftReviewSurface = sliceBetween(uiSource, "{generatedDraftPacket ? (", null);
  assert.match(selectedDraftReviewSurface, /citation\.sourceCode/);
  assert.match(selectedDraftReviewSurface, /citation\.approvedAudiences/);
  // The raw sourceId/sourceVersionId identity is preserved alongside the new
  // human-readable sourceCode - never replaced.
  assert.match(selectedDraftReviewSurface, /citation\.sourceId/);
  assert.match(selectedDraftReviewSurface, /citation\.sourceVersionId/);

  // SERVICE/API_DTO: the widened citation contract accepts a real citation
  // carrying both fields, for both a recorded and an absent audience
  // decision, and rejects a citation missing either field outright (proving
  // this is now a required, not merely tolerated, part of the contract).
  const validCitation = {
    claimId: "00000000-0000-4000-8000-000000000901",
    evidenceItemId: "00000000-0000-4000-8000-000000000902",
    sourceId: "00000000-0000-4000-8000-000000000903",
    sourceCode: "annual-report-2026",
    sourceVersionId: "00000000-0000-4000-8000-000000000904",
    supportStrength: "reviewed_supported",
    claimReviewStatus: "reviewed",
    evidenceReviewStatus: "reviewed",
    currentEligible: true,
    blockerCodes: [],
    affectedDimensionKeys: [],
    affectedObjectIds: [],
    approvedAudiences: ["internal", "funder"],
  };
  function packetWithCitation(citation) {
    return {
      generationRunId: "00000000-0000-4000-8000-000000000700",
      generatedContentDraftId: draftId,
      contentType: "evidence_summary",
      draftStatus: "draft",
      requestedAudience: "internal",
      reviewQueueItemId,
      queueStatus: "resolved",
      reviewStatus: "resolved",
      reviewUpdatedAt: "2026-09-17T09:00:00.000Z",
      currentUseEligible: true,
      exportReviewQueueItemId: null,
      exportReviewQueueStatus: null,
      exportReviewStatus: null,
      blocks: [{ ordinal: 1, text: "Enrollment increased.", citations: [citation] }],
    };
  }
  const { isGeneratedDraftReviewPacketDto } = __generatedContentReviewPacketServiceTestables;
  assert.equal(isGeneratedDraftReviewPacketDto(packetWithCitation(validCitation)), true);
  assert.equal(isGeneratedDraftReviewPacketDto(packetWithCitation({ ...validCitation, approvedAudiences: null })), true);
  const { sourceCode, ...missingSourceCode } = validCitation;
  assert.equal(isGeneratedDraftReviewPacketDto(packetWithCitation(missingSourceCode)), false);
  const { approvedAudiences, ...missingApprovedAudiences } = validCitation;
  assert.equal(isGeneratedDraftReviewPacketDto(packetWithCitation(missingApprovedAudiences)), false);

  // FRONTEND_FIELD: projectGeneratedDraftPacket carries both fields through,
  // for all four content types, including the null/no-decision-yet case.
  for (const contentType of ["evidence_summary", "impact_narrative", "readiness_assessment", "data_gap_memo"]) {
    const packet = projectGeneratedDraftPacket({
      ...packetWithCitation(validCitation),
      contentType,
    });
    const citation = packet.blocks[0].citations[0];
    assert.equal(citation.sourceCode, "annual-report-2026");
    assert.deepEqual(citation.approvedAudiences, ["internal", "funder"]);

    const noDecisionPacket = projectGeneratedDraftPacket({
      ...packetWithCitation({ ...validCitation, sourceCode: null, approvedAudiences: null }),
      contentType,
    });
    const noDecisionCitation = noDecisionPacket.blocks[0].citations[0];
    assert.equal(noDecisionCitation.sourceCode, null);
    assert.equal(noDecisionCitation.approvedAudiences, null);
  }
});
