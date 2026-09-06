import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { readFileSync } from "node:fs";

import sprint2IntakeApiRouter, { __testables as intakeRouteTestables } from "../Backend/kai/routes/sprint2IntakeApi.js";
import { requireKaiSprint2Enabled } from "../Backend/kai/config/kaiSprint2Config.js";
import { KAI_ERROR_STATUS, buildKaiError } from "../Backend/kai/errors/kaiErrors.js";
import { requireKaiSprint2Authenticated } from "../Backend/kai/middleware/kaiSprint2Authentication.js";
import {
  handleKaiSprint2JsonParserError,
  kaiSprint2ActorMutationLimiter,
  kaiSprint2MetadataJsonParser,
  kaiSprint2OrganizationMutationLimiter,
  setKaiSprint2NoStore,
} from "../Backend/kai/middleware/kaiSprint2RequestSafety.js";
import { requestGeneratedDraftExportReview } from "../Backend/kai/services/kaiExportReviewService.js";
import { createGeneratedDraftExportCandidate } from "../Backend/kai/services/kaiExportCandidateService.js";

const basePath = "/api/kai/sprint2/intake";
const exportReviewRequestRoutePath =
  "/admin/organizations/:organizationId/generated-content-drafts/:generatedContentDraftId/export-review-request";
const exportCandidateRoutePath =
  "/admin/organizations/:organizationId/generated-content-drafts/:generatedContentDraftId/export-candidates";
const organizationId = "00000000-0000-4000-8000-000000000001";
const otherOrganizationId = "00000000-0000-4000-8000-000000000002";
const generatedContentDraftId = "00000000-0000-4000-8000-000000000702";
const exportReviewQueueItemId = "00000000-0000-4000-8000-000000000710";
const exportCandidateId = "00000000-0000-4000-8000-000000000810";
const limitationSnapshotId = "00000000-0000-4000-8000-000000000811";
const canonicalFingerprint = "a".repeat(64);
const enabledEnv = Object.freeze({
  KAI_SPRINT2_ENABLED: "true",
  KAI_GENERATION_ENABLED: "true",
  KAI_PUBLIC_EXPORT_ENABLED: "true",
});
const actorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  source: "public.userdata",
  organizationMemberships: [
    { organization_id: organizationId, membership_status: "active", role_name: "gk_admin" },
  ],
});
const gkReviewerActorContext = Object.freeze({
  ...actorContext,
  actorUserId: "90000000-0000-4000-8000-000000000002",
  organizationMemberships: [
    { organization_id: organizationId, membership_status: "active", role_name: "gk_reviewer" },
  ],
});
const injectedExportReviewRequestDto = Object.freeze({
  generatedContentDraftId,
  requestedExportAudience: "internal",
  exportReviewRequestAccepted: true,
  replayed: false,
  reviewQueueItemId: exportReviewQueueItemId,
  queueStatus: "open",
  reviewStatus: "needs_gk_review",
  validatorResult: {
    validator_key: "VAL-EXP-001",
    severity: "info",
    object_type: "generated_content_draft",
    object_code: "export_manifest_eligibility",
    object_id: generatedContentDraftId,
    message: "Eligible.",
    blocking_reason: null,
    required_fix: null,
    evidence: { failed_gates: [] },
  },
});
const injectedExportCandidateDto = Object.freeze({
  exportCandidateId,
  generatedContentDraftId,
  requestedAudience: "internal",
  limitationSnapshotId,
  canonicalFingerprint,
  replayed: false,
});

function exportReviewRequestPath(overrides = {}) {
  return `${basePath}/admin/organizations/${overrides.organizationId || organizationId}`
    + `/generated-content-drafts/${overrides.generatedContentDraftId || generatedContentDraftId}/export-review-request`;
}

function exportCandidatePath(overrides = {}) {
  return `${basePath}/admin/organizations/${overrides.organizationId || organizationId}`
    + `/generated-content-drafts/${overrides.generatedContentDraftId || generatedContentDraftId}/export-candidates`;
}

function createScenario(overrides = {}) {
  return {
    authenticated: true,
    actorContext,
    serviceCalls: [],
    dependencyCalls: [],
    events: [],
    repositoryResult: null,
    ...overrides,
  };
}

function createAssembledApplication(getScenario) {
  const app = express();
  app.use(basePath, setKaiSprint2NoStore, requireKaiSprint2Enabled, kaiSprint2MetadataJsonParser);
  app.use(basePath, handleKaiSprint2JsonParserError);
  app.use(basePath, (req, res, next) => {
    const scenario = getScenario();
    scenario.events.push("outer_feature_gate_passed");
    req.isAuthenticated = () => {
      scenario.events.push("canonical_http_authentication");
      return scenario.authenticated;
    };
    if (scenario.authenticated) {
      req.user = { id: 46 };
      req.kaiSprint2ActorContext = scenario.actorContext;
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

async function requestJson(server, path, { body = null } = {}) {
  const { port } = server.address();
  const serialized = body == null ? null : JSON.stringify(body);
  return await new Promise((resolve, reject) => {
    const request = http.request({
      hostname: "127.0.0.1",
      port,
      path,
      method: "POST",
      headers: serialized
        ? { "content-type": "application/json", "content-length": Buffer.byteLength(serialized) }
        : {},
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        statusCode: response.statusCode,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
      }));
    });
    request.on("error", reject);
    if (serialized) request.write(serialized);
    request.end();
  });
}

function withFeatureFlagEnabled() {
  const original = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "true";
  return () => {
    if (original === undefined) delete process.env.KAI_SPRINT2_ENABLED;
    else process.env.KAI_SPRINT2_ENABLED = original;
  };
}

test("export operational composition routes appear as exactly one mounted authenticated POST route each", () => {
  for (const routePath of [exportReviewRequestRoutePath, exportCandidateRoutePath]) {
    const matches = sprint2IntakeApiRouter.stack
      .filter((layer) => layer.route?.path === routePath && layer.route?.methods?.post);
    assert.equal(matches.length, 1, routePath);
    assert.deepEqual(Object.keys(matches[0].route.methods), ["post"], routePath);
  }
});

test("export-review request route delegates to the existing requestGeneratedDraftExportReview service", async (t) => {
  let scenario = createScenario({
    repositoryResult: { ok: true, data: injectedExportReviewRequestDto, error: null },
  });
  const restoreFeatureFlag = withFeatureFlagEnabled();
  const restoreService = intakeRouteTestables.setIntakeServiceForTest({
    async requestGeneratedDraftExportReview(input, dependencies) {
      scenario.serviceCalls.push(input);
      scenario.dependencyCalls.push(dependencies);
      return requestGeneratedDraftExportReview(input, {
        ...dependencies,
        env: enabledEnv,
        generatedContentRepository: {
          async requestGeneratedDraftExportReview() {
            return scenario.repositoryResult;
          },
        },
      });
    },
  });
  const app = createAssembledApplication(() => scenario);
  const server = await listen(app);

  t.after(async () => {
    restoreService();
    restoreFeatureFlag();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  await t.test("authentication failure prevents the service call", async () => {
    scenario = createScenario({ authenticated: false });
    const response = await requestJson(server, exportReviewRequestPath(), {
      body: { requested_export_audience: "internal" },
    });

    assert.equal(response.statusCode, 401);
    assert.equal(response.body.error.code, "unauthorized");
    assert.deepEqual(scenario.serviceCalls, []);
  });

  await t.test("route forwards only path audience, middleware actorContext, server now, and audit dependency", async () => {
    scenario = createScenario({
      repositoryResult: { ok: true, data: injectedExportReviewRequestDto, error: null },
    });
    const before = Date.now();
    const response = await requestJson(server, exportReviewRequestPath(), {
      body: { requested_export_audience: "internal" },
    });
    const after = Date.now();

    assert.equal(response.statusCode, 201);
    assert.equal(scenario.serviceCalls.length, 1);
    const call = scenario.serviceCalls[0];
    assert.deepEqual(call, {
      organizationId,
      generatedContentDraftId,
      requestedExportAudience: "internal",
      actorContext,
      now: call.now,
    });
    assert.equal(typeof scenario.dependencyCalls[0].metadataOnlyAudit?.prepareMetadataOnlyAudit, "function");
    assert.deepEqual(response.body, { ok: true, data: injectedExportReviewRequestDto, warnings: [] });

    const nowMs = new Date(call.now).getTime();
    assert.ok(nowMs >= before && nowMs <= after, "now must be generated server-side within the request window");
  });

  await t.test("cross-tenant actor context is rejected by the reused service before repository behavior", async () => {
    scenario = createScenario({ actorContext });
    const response = await requestJson(server, exportReviewRequestPath({ organizationId: otherOrganizationId }), {
      body: { requested_export_audience: "internal" },
    });

    assert.equal(response.statusCode, 403);
    assert.equal(response.body.error.code, "authorization_denied");
  });

  await t.test("malformed body input uses the route validator and does not call the service", async () => {
    scenario = createScenario();
    const response = await requestJson(server, exportReviewRequestPath(), {
      body: { requested_export_audience: "internal", actorContext: { actorType: "system" } },
    });

    assert.equal(response.statusCode, 422);
    assert.equal(response.body.error.code, "validation_blocker");
    assert.deepEqual(scenario.serviceCalls, []);
  });
});

test("export-candidate route delegates to the existing createGeneratedDraftExportCandidate service", async (t) => {
  let scenario = createScenario({
    repositoryResult: { ok: true, data: injectedExportCandidateDto, error: null },
  });
  const restoreFeatureFlag = withFeatureFlagEnabled();
  const restoreService = intakeRouteTestables.setIntakeServiceForTest({
    async createGeneratedDraftExportCandidate(input, dependencies) {
      scenario.serviceCalls.push(input);
      scenario.dependencyCalls.push(dependencies);
      return createGeneratedDraftExportCandidate(input, {
        ...dependencies,
        env: enabledEnv,
        exportCandidateRepository: {
          async createExportCandidate() {
            return scenario.repositoryResult;
          },
        },
      });
    },
  });
  const app = createAssembledApplication(() => scenario);
  const server = await listen(app);

  t.after(async () => {
    restoreService();
    restoreFeatureFlag();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  await t.test("exact path, middleware actorContext, server now, and audit dependency are forwarded", async () => {
    scenario = createScenario({
      repositoryResult: { ok: true, data: injectedExportCandidateDto, error: null },
    });
    const before = Date.now();
    const response = await requestJson(server, exportCandidatePath(), { body: {} });
    const after = Date.now();

    assert.equal(response.statusCode, 201);
    assert.equal(scenario.serviceCalls.length, 1);
    const call = scenario.serviceCalls[0];
    assert.deepEqual(call, {
      organizationId,
      generatedContentDraftId,
      actorContext,
      now: call.now,
    });
    assert.equal(typeof scenario.dependencyCalls[0].metadataOnlyAudit?.prepareMetadataOnlyAudit, "function");
    assert.deepEqual(response.body, { ok: true, data: injectedExportCandidateDto, warnings: [] });
    assert.equal("humanReleaseAuthorityId" in response.body.data, false);
    assert.equal("finalGate" in response.body.data, false);

    const nowMs = new Date(call.now).getTime();
    assert.ok(nowMs >= before && nowMs <= after, "now must be generated server-side within the request window");
  });

  await t.test("unauthorized gk_reviewer actor fails through the reused service", async () => {
    scenario = createScenario({ actorContext: gkReviewerActorContext });
    const response = await requestJson(server, exportCandidatePath(), { body: {} });

    assert.equal(response.statusCode, 403);
    assert.equal(response.body.error.code, "authorization_denied");
  });

  await t.test("cross-tenant actor context is rejected by the reused service", async () => {
    scenario = createScenario({ actorContext });
    const response = await requestJson(server, exportCandidatePath({ organizationId: otherOrganizationId }), {
      body: {},
    });

    assert.equal(response.statusCode, 403);
    assert.equal(response.body.error.code, "authorization_denied");
  });

  await t.test("existing review/currentness gates still surface as candidate conflict without route reinterpretation", async () => {
    scenario = createScenario({
      repositoryResult: buildKaiError("conflict_current_state_changed", { data: null }),
    });
    const response = await requestJson(server, exportCandidatePath(), { body: {} });

    assert.equal(response.statusCode, KAI_ERROR_STATUS.conflict_current_state_changed);
    assert.equal(response.body.error.code, "conflict_current_state_changed");
    assert.equal(scenario.serviceCalls.length, 1);
  });

  await t.test("client-supplied authority, finalGate, artifact, or manifest fields are rejected before service", async () => {
    scenario = createScenario();
    const response = await requestJson(server, exportCandidatePath(), {
      body: {
        finalGate: true,
        manifest: { create: true },
        humanReleaseAuthority: true,
      },
    });

    assert.equal(response.statusCode, 422);
    assert.equal(response.body.error.code, "validation_blocker");
    assert.deepEqual(scenario.serviceCalls, []);
  });
});

test("export operational composition route source stays service-only and does not implement final release authority", () => {
  const source = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
  const slice = source.slice(
    source.indexOf("async function getExportReviewService"),
    source.indexOf('router.get(\n  "/admin/organizations/:organizationId/generated-content-drafts/:generatedContentDraftId/export-review-queue/:exportReviewQueueItemId/packet"'),
  );
  assert.match(slice, /requestGeneratedDraftExportReview/);
  assert.match(slice, /createGeneratedDraftExportCandidate/);
  assert.doesNotMatch(slice, /from\s+["'][^"']*(?:db|repository|postgres|kaiDb|kaiQueries|kaiReadModels)[^"']*["']/i);
  assert.doesNotMatch(slice, /\b(?:SELECT|INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b|\bpool\b|\bkaiDb\b|\brepository\b|\bkai\.(?!js\b)/i);
  assert.doesNotMatch(slice, /finalGate\s*:\s*true|final_gate|human[-_ ]release[-_ ]authority|manifest|artifact|writeFile|createWriteStream/i);
});
