// Board Reporting browser-facing API composition: closes the gap between
// the mounted Board HTTP surface (which previously began only after a
// boardReportingCandidateId already existed) and the existing authoritative
// services kaiBoardReportingPacketService.getBoardReportingPacket and
// kaiBoardReportingCandidateService.{createBoardReportingCandidate,
// readBoardReportingCandidate}. Three thin, organization+engagement scoped
// routes are added:
//   GET  /admin/organizations/:organizationId/engagements/:engagementId/board-reporting
//   POST /admin/organizations/:organizationId/engagements/:engagementId/board-reporting/candidates
//   GET  /admin/organizations/:organizationId/engagements/:engagementId/board-reporting/candidates/:boardReportingCandidateId
// None of the three constructs packet membership, fingerprints, review
// outcome, authority, eligibility, or manifest data - every route delegates
// exactly once to the existing authoritative service. This spec proves HTTP
// wiring (feature flag, authentication, exact request/response shape),
// idempotency-contract preservation, and no direct kai.* access, mirroring
// the existing kai-sprint2-board-reporting-candidate-export-manifest-service-route.spec.js
// route-wiring conventions.

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

const basePath = "/api/kai/sprint2/intake";
const ORG = "00000000-0000-4000-8000-000000000001";
const ENGAGEMENT = "00000000-0000-4000-8000-000000000201";
const CANDIDATE = "00000000-0000-4000-8000-000000000301";
const ACTOR = "90000000-0000-4000-8000-000000000001";

const gkAdminActorContext = Object.freeze({
  actorType: "human",
  actorUserId: ACTOR,
  organizationMemberships: [
    { organization_id: ORG, membership_status: "active", role_name: "gk_admin" },
  ],
});

const packetRoutePath = "/admin/organizations/:organizationId/engagements/:engagementId/board-reporting";
const createCandidateRoutePath = "/admin/organizations/:organizationId/engagements/:engagementId/board-reporting/candidates";
const readCandidateRoutePath = "/admin/organizations/:organizationId/engagements/:engagementId/board-reporting/candidates/:boardReportingCandidateId";

function packetResult(overrides = {}) {
  return {
    ok: true,
    data: {
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      packetAudience: "internal",
      supportedContentTypes: ["evidence_summary", "impact_narrative"],
      members: [],
      ...overrides,
    },
    error: null,
  };
}

function createResult(overrides = {}) {
  return {
    ok: true,
    data: {
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      boardReportingCandidateId: CANDIDATE,
      packetAudience: "internal",
      fingerprintContractVersion: "kai-sprint2-br-02-board-reporting-candidate-fingerprint-v1",
      canonicalFingerprint: "b".repeat(64),
      memberCount: 2,
      replayed: false,
      ...overrides,
    },
    error: null,
  };
}

function readResult(overrides = {}) {
  return {
    ok: true,
    data: {
      boardReportingCandidateId: CANDIDATE,
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      packetAudience: "internal",
      candidateStatus: "created",
      members: [{ generatedContentDraftId: "00000000-0000-4000-8000-000000000401", ordinal: 0 }],
      ...overrides,
    },
    error: null,
  };
}

async function withRunningApp(t, { actorContext = gkAdminActorContext, authenticated = true } = {}) {
  const scenario = { authenticated, actorContext, serviceCalls: [], dependencyCalls: [] };
  const restoreFeatureFlag = (() => {
    const original = process.env.KAI_SPRINT2_ENABLED;
    process.env.KAI_SPRINT2_ENABLED = "true";
    return () => {
      if (original === undefined) delete process.env.KAI_SPRINT2_ENABLED;
      else process.env.KAI_SPRINT2_ENABLED = original;
    };
  })();

  const app = express();
  app.use(basePath, setKaiSprint2NoStore, requireKaiSprint2Enabled, kaiSprint2MetadataJsonParser);
  app.use(basePath, handleKaiSprint2JsonParserError);
  app.use(basePath, (req, res, next) => {
    req.isAuthenticated = () => scenario.authenticated;
    if (scenario.authenticated) {
      req.user = { id: 46 };
      req.kaiSprint2ActorContext = scenario.actorContext;
    }
    next();
  });
  app.use(
    basePath,
    requireKaiSprint2Enabled,
    kaiSprint2OrganizationMutationLimiter,
    kaiSprint2ActorMutationLimiter,
    requireKaiSprint2Authenticated,
    sprint2IntakeApiRouter,
  );
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, "127.0.0.1");
    listener.once("listening", () => resolve(listener));
    listener.once("error", reject);
  });
  t.after(async () => {
    restoreFeatureFlag();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  async function requestJson(path, { method = "GET", body } = {}) {
    const { port } = server.address();
    const serialized = body === undefined ? undefined : JSON.stringify(body);
    return await new Promise((resolve, reject) => {
      const request = http.request({
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: serialized === undefined ? {} : {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(serialized),
        },
      }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve({
          statusCode: response.statusCode,
          body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
        }));
      });
      request.on("error", reject);
      if (serialized !== undefined) request.write(serialized);
      request.end();
    });
  }

  return { scenario, requestJson };
}

test("GET current Board packet delegates to getBoardReportingPacket and returns its data verbatim", async (t) => {
  const restoreService = intakeRouteTestables.setIntakeServiceForTest({
    async getBoardReportingPacket(input) {
      this.calls = this.calls || [];
      this.calls.push(input);
      return packetResult();
    },
  });
  t.after(restoreService);
  const { scenario, requestJson } = await withRunningApp(t);
  const path = `${basePath}/admin/organizations/${ORG}/engagements/${ENGAGEMENT}/board-reporting`;
  const response = await requestJson(path);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.data, packetResult().data);

  // unauthenticated caller fails closed before the service is reached
  const unauthorizedScenario = await withRunningApp(t, { authenticated: false });
  const unauthorized = await unauthorizedScenario.requestJson(path);
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(unauthorized.body.error.code, "unauthorized");

  // a query string is refused outright rather than silently ignored
  const withQuery = await requestJson(`${path}?foo=bar`);
  assert.equal(withQuery.statusCode, 422);
  assert.equal(withQuery.body.error.code, "validation_blocker");
});

test("POST create/reuse Board Reporting candidate: the client sends only idempotency_key - actor/now are server-derived, and no membership/fingerprint/authority field is ever accepted", async (t) => {
  const restoreService = intakeRouteTestables.setIntakeServiceForTest({
    async createBoardReportingCandidate(input, dependencies) {
      scenario.serviceCalls.push(input);
      scenario.dependencyCalls.push(dependencies);
      return createResult();
    },
  });
  t.after(restoreService);
  const { scenario, requestJson } = await withRunningApp(t);
  const path = `${basePath}/admin/organizations/${ORG}/engagements/${ENGAGEMENT}/board-reporting/candidates`;
  const before = Date.now();
  const response = await requestJson(path, { method: "POST", body: { idempotency_key: "browser-create-key-001" } });
  const after = Date.now();
  assert.equal(response.statusCode, 201);
  assert.equal(scenario.serviceCalls.length, 1);
  assert.deepEqual(scenario.serviceCalls[0], {
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    idempotencyKey: "browser-create-key-001",
    actorContext: gkAdminActorContext,
    now: scenario.serviceCalls[0].now,
  });
  const nowMs = new Date(scenario.serviceCalls[0].now).getTime();
  assert.ok(nowMs >= before && nowMs <= after);
  assert.equal(typeof scenario.dependencyCalls[0].metadataOnlyAudit?.prepareMetadataOnlyAudit, "function");
  assert.equal(response.body.data.boardReportingCandidateId, CANDIDATE);
  assert.equal(response.body.data.replayed, false);

  for (const badBody of [
    {},
    { idempotency_key: "short" },
    { idempotency_key: "has a space in it 12345" },
    { idempotency_key: "browser-create-key-001", canonicalFingerprint: "a".repeat(64) },
    { idempotency_key: "browser-create-key-001", generatedContentDraftIds: [CANDIDATE] },
    { idempotency_key: "browser-create-key-001", boardReportingCandidateId: CANDIDATE },
  ]) {
    scenario.serviceCalls = [];
    const rejected = await requestJson(path, { method: "POST", body: badBody });
    assert.equal(rejected.statusCode, 422, JSON.stringify(badBody));
    assert.equal(rejected.body.error.code, "validation_blocker");
    assert.deepEqual(scenario.serviceCalls, []);
  }
});

test("identical idempotency_key replay against the same route surfaces the service's replayed:true without a second distinguishable route behavior", async (t) => {
  let calls = 0;
  const restoreService = intakeRouteTestables.setIntakeServiceForTest({
    async createBoardReportingCandidate() {
      calls += 1;
      return createResult({ replayed: calls > 1 });
    },
  });
  t.after(restoreService);
  const { requestJson } = await withRunningApp(t);
  const path = `${basePath}/admin/organizations/${ORG}/engagements/${ENGAGEMENT}/board-reporting/candidates`;
  const first = await requestJson(path, { method: "POST", body: { idempotency_key: "browser-replay-key-001" } });
  const second = await requestJson(path, { method: "POST", body: { idempotency_key: "browser-replay-key-001" } });
  assert.equal(first.statusCode, 201);
  assert.equal(second.statusCode, 201);
  assert.equal(first.body.data.replayed, false);
  assert.equal(second.body.data.replayed, true);
  assert.equal(first.body.data.boardReportingCandidateId, second.body.data.boardReportingCandidateId);
});

test("GET exact Board Reporting candidate delegates to readBoardReportingCandidate authorized solely by the route's own boardReportingCandidateId", async (t) => {
  const restoreService = intakeRouteTestables.setIntakeServiceForTest({
    async readBoardReportingCandidate(input) {
      scenario.serviceCalls.push(input);
      return readResult();
    },
  });
  t.after(restoreService);
  const { scenario, requestJson } = await withRunningApp(t);
  const path = `${basePath}/admin/organizations/${ORG}/engagements/${ENGAGEMENT}/board-reporting/candidates/${CANDIDATE}`;
  const response = await requestJson(path);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(scenario.serviceCalls[0], {
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    boardReportingCandidateId: CANDIDATE,
    actorContext: gkAdminActorContext,
  });
  assert.deepEqual(response.body.data, readResult().data);

  const withQuery = await requestJson(`${path}?foo=bar`);
  assert.equal(withQuery.statusCode, 422);
  assert.equal(withQuery.body.error.code, "validation_blocker");

  const badId = await requestJson(
    `${basePath}/admin/organizations/${ORG}/engagements/${ENGAGEMENT}/board-reporting/candidates/not-a-uuid`,
  );
  assert.equal(badId.statusCode, 422);
  assert.equal(badId.body.error.code, "validation_blocker");
});

test("all three routes fail closed with feature_disabled while KAI_SPRINT2_ENABLED is off", async (t) => {
  const original = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "false";
  t.after(() => {
    if (original === undefined) delete process.env.KAI_SPRINT2_ENABLED;
    else process.env.KAI_SPRINT2_ENABLED = original;
  });

  const app = express();
  app.use(basePath, setKaiSprint2NoStore, requireKaiSprint2Enabled, kaiSprint2MetadataJsonParser);
  app.use(basePath, handleKaiSprint2JsonParserError);
  app.use(basePath, requireKaiSprint2Enabled, sprint2IntakeApiRouter);
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, "127.0.0.1");
    listener.once("listening", () => resolve(listener));
    listener.once("error", reject);
  });
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  async function get(path) {
    const { port } = server.address();
    return await new Promise((resolve, reject) => {
      http.get({ hostname: "127.0.0.1", port, path }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve({ statusCode: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }));
      }).on("error", reject);
    });
  }

  for (const path of [
    `${basePath}/admin/organizations/${ORG}/engagements/${ENGAGEMENT}/board-reporting`,
    `${basePath}/admin/organizations/${ORG}/engagements/${ENGAGEMENT}/board-reporting/candidates/${CANDIDATE}`,
  ]) {
    const response = await get(path);
    assert.equal(response.statusCode, 403);
    assert.equal(response.body.error.code, "feature_disabled");
  }
});

test("Board Reporting browser API composition routes contain no raw SQL and no direct kai.* access", () => {
  const routeSource = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
  for (const [path, method] of [
    [packetRoutePath, "get"],
    [createCandidateRoutePath, "post"],
    [readCandidateRoutePath, "get"],
  ]) {
    const layer = sprint2IntakeApiRouter.stack.find(
      (candidate) => candidate.route?.path === path && candidate.route?.methods?.[method],
    );
    assert.ok(layer, `${method.toUpperCase()} ${path} route is mounted exactly once`);
  }
  const start = routeSource.indexOf("function boardReportingEngagementIdentifier");
  const end = routeSource.indexOf("function boardReportingCandidateReviewIdentifier(req = {})");
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.ok(end > start);
  const slice = routeSource.slice(start, end);
  assert.doesNotMatch(slice, /\b(?:SELECT|INSERT|UPDATE|DELETE)\b[\s\S]{0,160}\bkai\./i);
  assert.doesNotMatch(slice, /\bkai\.(?!js\b)[a-z_]+\b/i);
  assert.doesNotMatch(slice, /\bnew\s+Pool\b|\bpool\.query\b/);
});

test("the six previously-existing Board routes remain unchanged", () => {
  const existingBoardRoutePaths = [
    ["/admin/organizations/:organizationId/engagements/:engagementId/board-reporting/candidates/:boardReportingCandidateId/review-request", "post"],
    ["/admin/organizations/:organizationId/engagements/:engagementId/board-reporting/candidates/:boardReportingCandidateId/final-release-authority", "post"],
    ["/admin/organizations/:organizationId/engagements/:engagementId/board-reporting/candidates/:boardReportingCandidateId/review-queue/:reviewQueueItemId/start", "post"],
    ["/admin/organizations/:organizationId/engagements/:engagementId/board-reporting/candidates/:boardReportingCandidateId/review-queue/:reviewQueueItemId/complete", "post"],
    ["/admin/organizations/:organizationId/engagements/:engagementId/board-reporting/candidates/:boardReportingCandidateId/export-manifests", "post"],
    ["/admin/organizations/:organizationId/board-reporting/export-manifests/:boardReportingCandidateExportManifestId/markdown", "get"],
  ];
  for (const [path, method] of existingBoardRoutePaths) {
    const matches = sprint2IntakeApiRouter.stack.filter(
      (layer) => layer.route?.path === path && layer.route?.methods?.[method],
    );
    assert.equal(matches.length, 1, `${method.toUpperCase()} ${path} remains mounted exactly once`);
  }
});
