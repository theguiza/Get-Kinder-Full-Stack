import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { readFileSync } from "node:fs";

import sprint2IntakeApiRouter, { __testables as intakeRouteTestables } from "../Backend/kai/routes/sprint2IntakeApi.js";
import { requireKaiSprint2Enabled } from "../Backend/kai/config/kaiSprint2Config.js";
import { requireKaiSprint2Authenticated } from "../Backend/kai/middleware/kaiSprint2Authentication.js";
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
import { listGeneratedDraftLibraryIndex as readGeneratedDraftLibraryIndex } from "../Backend/kai/db/kaiGeneratedDraftLibraryReadModels.js";
import {
  generatedDraftLibraryIndexPath,
  generatedDraftReviewLabel,
  generatedDraftReviewPacketPath,
  projectGeneratedDraftLibraryItems,
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
      req.kaiSprint2ActorContext = current.actorContext;
    }
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
  const server = await listen(createApp(() => current));

  t.after(async () => {
    restore();
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
  assert.match(observed.sql, /AND d\.content_type = 'evidence_summary'/);
  assert.match(observed.sql, /AND d\.requested_audience = 'internal'/);
  assert.match(observed.sql, /AND d\.generated_content_draft_id > \$3::uuid/);
  assert.match(observed.sql, /ORDER BY d\.generated_content_draft_id ASC/);
  assert.match(observed.sql, /LIMIT \$2::int/);
  assert.deepEqual(observed.params, [organizationId, 26, draftId]);
  assert.doesNotMatch(observed.sql, /\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bTRUNCATE\b|FOR UPDATE/i);
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
  assert.doesNotMatch(uiSource + logicSource, /\bfinal\b|\bapproved\b|export-ready/i);
  assert.doesNotMatch(uiSource + logicSource, /raw_content|signed_url|storage_object|api[_-]?key|secret/i);

  assert.deepEqual(
    [...__generatedDraftLibraryServiceContract.GENERATED_DRAFT_LIBRARY_READ_ROLES],
    ["gk_admin", "gk_reviewer"],
  );
  assert.equal(__generatedDraftLibraryServiceContract.GENERATED_DRAFT_LIBRARY_READ_OPERATION, "get_generated_draft_review_packet");
  assert.equal(typeof generatedDraftLibraryServiceTestables.responseDraftSummary, "function");
});
