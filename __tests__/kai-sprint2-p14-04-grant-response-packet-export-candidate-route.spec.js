// P14-04: proves the authenticated POST sibling of the existing Grant
// Response Packet route family. Route wiring only - the underlying P14-03
// fingerprint/convergence/member-snapshot behavior is proven elsewhere
// (kai-sprint2-p14-03-grant-response-packet-export-candidate-foundation.integration.spec.js)
// and never reopened here; the service-layer role/tenant/exact-keys gate is
// proven in kai-sprint2-p14-04-grant-response-packet-export-candidate-service.spec.js
// and only spot-checked here through the real, unfaked service.

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
import { createGrantResponsePacketExportCandidate } from "../Backend/kai/services/kaiGrantResponsePacketExportCandidateService.js";
import { createPostgresGrantResponsePacketExportCandidateRepository } from "../Backend/kai/dictionary/postgresGrantResponsePacketExportCandidateRepository.js";

const basePath = "/api/kai/sprint2/intake";
const routePath = "/admin/organizations/:organizationId/engagements/:engagementId/grant-response-packet/export-candidates";
const organizationId = "00000000-0000-4000-8000-000000000001";
const otherOrganizationId = "00000000-0000-4000-8000-000000000002";
const engagementId = "14040000-0000-4000-8000-000000000001";
const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" });

const actorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  organizationMemberships: [
    { organization_id: organizationId, membership_status: "active", role_name: "gk_admin" },
  ],
});

const injectedCandidateDto = Object.freeze({
  organizationId,
  engagementId,
  grantResponsePacketExportCandidateId: "14040000-0000-4000-8000-000000000902",
  grantResponsePacketExportIdentityId: "14040000-0000-4000-8000-000000000903",
  fingerprintContractVersion: "kai-sprint2-p14-03-grant-response-packet-export-candidate-fingerprint-v1",
  canonicalFingerprint: "d".repeat(64),
  memberCount: 1,
  replayed: false,
});

function candidatesPath(overrides = {}) {
  return `${basePath}/admin/organizations/${overrides.organizationId || organizationId}`
    + `/engagements/${overrides.engagementId || engagementId}/grant-response-packet/export-candidates`;
}

function createScenario(overrides = {}) {
  return {
    authenticated: true,
    actorContext,
    serviceCalls: [],
    dependencyCalls: [],
    repositoryResult: { ok: true, data: {
      grantResponsePacketExportCandidateId: injectedCandidateDto.grantResponsePacketExportCandidateId,
      grantResponsePacketExportIdentityId: injectedCandidateDto.grantResponsePacketExportIdentityId,
      organizationId,
      engagementId,
      fingerprintContractVersion: injectedCandidateDto.fingerprintContractVersion,
      canonicalFingerprint: injectedCandidateDto.canonicalFingerprint,
      memberGeneratedContentDraftIds: ["14040000-0000-4000-8000-0000000000d1"],
      replayed: false,
    }, error: null },
    ...overrides,
  };
}

function createApplication(getScenario) {
  const app = express();
  app.use(basePath, setKaiSprint2NoStore, requireKaiSprint2Enabled, kaiSprint2MetadataJsonParser);
  app.use(basePath, handleKaiSprint2JsonParserError);
  app.use(basePath, (req, res, next) => {
    const scenario = getScenario();
    req.isAuthenticated = () => scenario.authenticated;
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

test("grant-response-packet export-candidates route appears as exactly one mounted authenticated POST route", () => {
  const matches = sprint2IntakeApiRouter.stack
    .filter((layer) => layer.route?.path === routePath && layer.route?.methods?.post);
  assert.equal(matches.length, 1);
  assert.deepEqual(Object.keys(matches[0].route.methods), ["post"]);
});

test("route disabled when KAI_SPRINT2_ENABLED is not set", async (t) => {
  const restoreFeatureFlag = (() => {
    const original = process.env.KAI_SPRINT2_ENABLED;
    delete process.env.KAI_SPRINT2_ENABLED;
    return () => {
      if (original !== undefined) process.env.KAI_SPRINT2_ENABLED = original;
    };
  })();
  const scenario = createScenario();
  const app = createApplication(() => scenario);
  const server = await listen(app);
  t.after(async () => {
    restoreFeatureFlag();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const response = await requestJson(server, candidatesPath(), { body: {} });
  assert.equal(response.statusCode, 403);
  assert.equal(response.body.error.code, "feature_disabled");
});

test("export-candidates route delegates to the existing P14-04 service, deriving actorContext/now server-side", async (t) => {
  let scenario = createScenario();
  const restoreFeatureFlag = withFeatureFlagEnabled();
  const restoreService = intakeRouteTestables.setIntakeServiceForTest({
    async createGrantResponsePacketExportCandidate(input, dependencies) {
      scenario.serviceCalls.push(input);
      scenario.dependencyCalls.push(dependencies);
      return createGrantResponsePacketExportCandidate(input, {
        ...dependencies,
        env: enabledEnv,
        grantResponsePacketExportCandidateRepository: {
          async createGrantResponsePacketExportCandidate() {
            return scenario.repositoryResult;
          },
        },
      });
    },
  });
  const app = createApplication(() => scenario);
  const server = await listen(app);

  t.after(async () => {
    restoreService();
    restoreFeatureFlag();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  await t.test("authentication failure prevents the service call", async () => {
    scenario = createScenario({ authenticated: false });
    const response = await requestJson(server, candidatesPath(), { body: {} });
    assert.equal(response.statusCode, 401);
    assert.equal(response.body.error.code, "unauthorized");
    assert.deepEqual(scenario.serviceCalls, []);
  });

  await t.test("route forwards only route organizationId/engagementId, middleware actorContext, server now, and audit dependency", async () => {
    scenario = createScenario();
    const before = Date.now();
    const response = await requestJson(server, candidatesPath(), { body: {} });
    const after = Date.now();

    assert.equal(response.statusCode, 201);
    assert.equal(scenario.serviceCalls.length, 1);
    const call = scenario.serviceCalls[0];
    assert.deepEqual(call, {
      organizationId,
      engagementId,
      actorContext,
      now: call.now,
    });
    assert.equal(typeof scenario.dependencyCalls[0].metadataOnlyAudit?.prepareMetadataOnlyAudit, "function");
    assert.equal(response.body.ok, true);
    assert.deepEqual(Object.keys(response.body.data).sort(), [
      "canonicalFingerprint",
      "engagementId",
      "fingerprintContractVersion",
      "grantResponsePacketExportCandidateId",
      "grantResponsePacketExportIdentityId",
      "memberCount",
      "organizationId",
      "replayed",
    ]);

    const nowMs = new Date(call.now).getTime();
    assert.ok(nowMs >= before && nowMs <= after, "now must be generated server-side within the request window");
  });

  await t.test("a non-empty body (client-supplied candidate composition) is rejected before the service is called", async () => {
    scenario = createScenario();
    for (const body of [
      { canonicalFingerprint: "a".repeat(64) },
      { memberIds: ["14040000-0000-4000-8000-0000000000d1"] },
      { packetAudience: "funder" },
      { grantResponsePacketExportCandidateId: "14040000-0000-4000-8000-000000000902" },
    ]) {
      const response = await requestJson(server, candidatesPath(), { body });
      assert.equal(response.statusCode, 422, JSON.stringify(body));
      assert.equal(response.body.error.code, "validation_blocker", JSON.stringify(body));
    }
    assert.deepEqual(scenario.serviceCalls, []);
  });

  await t.test("an unauthorized role is rejected by the reused service before repository behavior", async () => {
    scenario = createScenario({
      actorContext: {
        ...actorContext,
        actorUserId: "90000000-0000-4000-8000-000000000004",
        organizationMemberships: [
          { organization_id: organizationId, membership_status: "active", role_name: "gk_reviewer" },
        ],
      },
    });
    const response = await requestJson(server, candidatesPath(), { body: {} });
    assert.equal(response.statusCode, 403);
    assert.equal(response.body.error.code, "authorization_denied");
  });

  await t.test("cross-tenant actor context is rejected by the reused service before repository behavior", async () => {
    scenario = createScenario();
    const response = await requestJson(server, candidatesPath({ organizationId: otherOrganizationId }), { body: {} });
    assert.equal(response.statusCode, 403);
    assert.equal(response.body.error.code, "authorization_denied");
  });

  await t.test("malformed route identifiers never reach the service", async () => {
    scenario = createScenario();
    const response = await requestJson(server, candidatesPath({ engagementId: "not-a-uuid" }), { body: {} });
    assert.equal(response.statusCode, 422);
    assert.equal(response.body.error.code, "validation_blocker");
    assert.deepEqual(scenario.serviceCalls, []);
  });
});

test("export-candidates route fails closed for a zero-eligible-member packet through the existing structured KAI error, creating no candidate", async (t) => {
  const restoreFeatureFlag = withFeatureFlagEnabled();
  let transactionCalls = 0;
  const realRepository = createPostgresGrantResponsePacketExportCandidateRepository({
    runInTransaction: async () => {
      transactionCalls += 1;
      throw new Error("runInTransaction must not be called for a zero-member packet");
    },
  });
  const restoreService = intakeRouteTestables.setIntakeServiceForTest({
    async createGrantResponsePacketExportCandidate(input, dependencies) {
      return createGrantResponsePacketExportCandidate(input, {
        ...dependencies,
        env: enabledEnv,
        grantResponsePacketExportCandidateRepository: realRepository,
        composeRenderModel: async () => ({
          ok: true,
          data: {
            renderModelContractVersion: "kai-sprint2-grant-response-packet-render-model-v1",
            organizationId: input.organizationId,
            engagementId: input.engagementId,
            packetAudience: "funder",
            members: [],
          },
          error: null,
        }),
      });
    },
  });
  const scenario = { authenticated: true, actorContext };
  const app = createApplication(() => scenario);
  const server = await listen(app);

  t.after(async () => {
    restoreService();
    restoreFeatureFlag();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const response = await requestJson(server, candidatesPath(), { body: {} });
  assert.equal(response.statusCode, 422);
  assert.equal(response.body.error.code, "validation_blocker");
  assert.equal(transactionCalls, 0);
});

test("grant-response-packet export-candidates route contains no SQL, no direct DB access, and no client-selected membership/fingerprint/manifest authority", () => {
  const routeSource = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
  const routeStart = routeSource.indexOf(`"${routePath}"`);
  assert.notEqual(routeStart, -1);
  const routeEnd = routeSource.indexOf("function generatedContentReviewQueueIdentifier", routeStart);
  const routeSlice = routeSource.slice(routeStart, routeEnd);

  assert.match(routeSlice, /getGrantResponsePacketExportCandidateService/);
  assert.match(routeSlice, /createGrantResponsePacketExportCandidate/);
  assert.doesNotMatch(routeSlice, /\b(?:SELECT|INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b|\bpool\b|\bkaiDb\b|\brepository\b|\bkai\.(?!js\b)/i);
  assert.doesNotMatch(routeSlice, /req\.body\.(?:canonical_?fingerprint|member|packet_?audience|candidate_?id)/i);
  assert.doesNotMatch(routeSlice, /final-release|final release|createExportManifest|recordHumanFinalReleaseAuthorityDecision/i);
});
