import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

import impactEvaluationApiRouter, { __testables as impactEvaluationRouteTestables } from "../Backend/kai/routes/impactEvaluationApi.js";
import { requireKaiSprint2Enabled } from "../Backend/kai/config/kaiSprint2Config.js";
import { requireKaiSprint2Authenticated } from "../Backend/kai/middleware/kaiSprint2Authentication.js";

/**
 * A2.3 MOUNTED-ROUTE proof: this is the actual "authenticated internal
 * Impact Library service/route" A2 is exposed through (the assistant-tool
 * surface is not usable for this -- see the docstring in
 * Backend/kai/routes/impactEvaluationApi.js). The service-layer gating and
 * repository/validator/persistence behavior are already proven directly in
 * kai-sprint2-a2-1-impact-evaluation-boundary.spec.js and
 * kai-sprint2-a2-2-impact-evaluation-persistence.spec.js; this file closes
 * the remaining gap -- the real mounted Express composition (feature gate,
 * authentication, actor-context attachment, request parsing, response
 * shaping) -- with only the service layer stubbed through the route's own
 * setImpactEvaluationServiceForTest(...) injection seam, following the exact
 * idiom already established by every other Package 1/2/3 KAI route.
 */

const basePath = "/api/kai/sprint2/impact-evaluation";
const organizationId = "00000000-0000-4000-8000-000000000001";
const impactOutcomeContextId = "00000000-0000-4000-8000-000000000010";
const frameworkVersionId = "00000000-0000-4000-8000-000000000020";
const claimId = "00000000-0000-4000-8000-000000000101";
const actorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  source: "public.userdata",
  organizationMemberships: [
    { organization_id: organizationId, membership_status: "active", role_name: "gk_reviewer" },
  ],
});

function requestBody() {
  return {
    impact_outcome_context_id: impactOutcomeContextId,
    framework_version_id: frameworkVersionId,
    requested_audience: "internal",
    claim_ids: [claimId],
  };
}

function createScenario(overrides = {}) {
  return {
    authenticated: true,
    actorContext,
    serviceCalls: [],
    serviceResult: { ok: true, data: { impactOutcomeContextId, frameworkVersionId, results: [] }, error: null },
    events: [],
    ...overrides,
  };
}

function createAssembledApplication(getScenario) {
  const app = express();
  app.use(express.json());
  app.use(basePath, requireKaiSprint2Enabled);
  app.use(basePath, (req, res, next) => {
    const scenario = getScenario();
    scenario.events.push("feature_gate_passed");
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
  app.use(basePath, requireKaiSprint2Enabled, requireKaiSprint2Authenticated, impactEvaluationApiRouter);
  return app;
}

async function listen(app) {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1");
    server.once("listening", () => resolve(server));
    server.once("error", reject);
  });
}

async function requestJson(server, path, { body = null, method = "POST" } = {}) {
  const { port } = server.address();
  const serialized = body == null ? null : JSON.stringify(body);
  return await new Promise((resolve, reject) => {
    const request = http.request({
      hostname: "127.0.0.1",
      port,
      path,
      method,
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

test("A2.3 route: exactly two mounted POST routes -- read-only preview and persisting create", () => {
  const routes = impactEvaluationApiRouter.stack
    .filter((layer) => layer.route)
    .map((layer) => ({ path: layer.route.path, methods: Object.keys(layer.route.methods) }));
  assert.deepEqual(routes, [
    { path: "/organizations/:organizationId/impact-evaluations/preview", methods: ["post"] },
    { path: "/organizations/:organizationId/impact-evaluations", methods: ["post"] },
  ]);
});

test("A2.3 route: feature-disabled path fails closed before authentication or the service is ever reached", async (t) => {
  let scenario = createScenario();
  const originalFeatureFlag = process.env.KAI_SPRINT2_ENABLED;
  delete process.env.KAI_SPRINT2_ENABLED;
  const restore = impactEvaluationRouteTestables.setImpactEvaluationServiceForTest({
    async evaluateImpactOutcomeContext() { throw new Error("must not call"); },
    async createImpactEvaluation() { throw new Error("must not call"); },
  });
  const app = createAssembledApplication(() => scenario);
  const server = await listen(app);
  t.after(async () => {
    restore();
    if (originalFeatureFlag === undefined) delete process.env.KAI_SPRINT2_ENABLED;
    else process.env.KAI_SPRINT2_ENABLED = originalFeatureFlag;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const response = await requestJson(server, `${basePath}/organizations/${organizationId}/impact-evaluations`, { body: requestBody() });
  assert.equal(response.statusCode, 403);
  assert.equal(response.body.error.code, "feature_disabled");
  assert.deepEqual(scenario.events, []);
});

test("A2.3 route: unauthenticated requests fail before the service is ever reached", async (t) => {
  let scenario = createScenario({ authenticated: false });
  const originalFeatureFlag = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "true";
  const restore = impactEvaluationRouteTestables.setImpactEvaluationServiceForTest({
    async evaluateImpactOutcomeContext() { throw new Error("must not call"); },
    async createImpactEvaluation() { throw new Error("must not call"); },
  });
  const app = createAssembledApplication(() => scenario);
  const server = await listen(app);
  t.after(async () => {
    restore();
    if (originalFeatureFlag === undefined) delete process.env.KAI_SPRINT2_ENABLED;
    else process.env.KAI_SPRINT2_ENABLED = originalFeatureFlag;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const response = await requestJson(server, `${basePath}/organizations/${organizationId}/impact-evaluations`, { body: requestBody() });
  assert.equal(response.statusCode, 401);
  assert.equal(response.body.error.code, "unauthorized");
  assert.deepEqual(scenario.events, ["feature_gate_passed", "canonical_http_authentication"]);
});

test("A2.3 route: an authenticated mapped human reaches the read-only preview and the persisting create exactly once each, with server-resolved identity", async (t) => {
  let scenario = createScenario();
  const originalFeatureFlag = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "true";
  const restore = impactEvaluationRouteTestables.setImpactEvaluationServiceForTest({
    async evaluateImpactOutcomeContext(input) {
      scenario.serviceCalls.push({ op: "preview", input });
      return scenario.serviceResult;
    },
    async createImpactEvaluation(input) {
      scenario.serviceCalls.push({ op: "create", input });
      return scenario.serviceResult;
    },
  });
  const app = createAssembledApplication(() => scenario);
  const server = await listen(app);
  t.after(async () => {
    restore();
    if (originalFeatureFlag === undefined) delete process.env.KAI_SPRINT2_ENABLED;
    else process.env.KAI_SPRINT2_ENABLED = originalFeatureFlag;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const previewResponse = await requestJson(server, `${basePath}/organizations/${organizationId}/impact-evaluations/preview`, { body: requestBody() });
  assert.equal(previewResponse.statusCode, 200);
  assert.equal(previewResponse.body.ok, true);

  const createResponse = await requestJson(server, `${basePath}/organizations/${organizationId}/impact-evaluations`, { body: requestBody() });
  assert.equal(createResponse.statusCode, 201);
  assert.equal(createResponse.body.ok, true);

  assert.equal(scenario.serviceCalls.length, 2);
  assert.equal(scenario.serviceCalls[0].op, "preview");
  assert.deepEqual(scenario.serviceCalls[0].input.actorContext, actorContext);
  assert.equal(scenario.serviceCalls[0].input.organizationId, organizationId);
  assert.equal(scenario.serviceCalls[1].op, "create");
  assert.deepEqual(scenario.serviceCalls[1].input.actorContext, actorContext);
  assert.equal(typeof scenario.serviceCalls[1].input.now, "string");
});

test("A2.3 route: a malformed request body never reaches the service", async (t) => {
  let scenario = createScenario();
  const originalFeatureFlag = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "true";
  const restore = impactEvaluationRouteTestables.setImpactEvaluationServiceForTest({
    async evaluateImpactOutcomeContext() { throw new Error("must not call"); },
    async createImpactEvaluation() { throw new Error("must not call"); },
  });
  const app = createAssembledApplication(() => scenario);
  const server = await listen(app);
  t.after(async () => {
    restore();
    if (originalFeatureFlag === undefined) delete process.env.KAI_SPRINT2_ENABLED;
    else process.env.KAI_SPRINT2_ENABLED = originalFeatureFlag;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const response = await requestJson(server, `${basePath}/organizations/${organizationId}/impact-evaluations`, { body: { claim_ids: [] } });
  assert.equal(response.statusCode, 422);
  assert.equal(response.body.error.code, "validation_blocker");
  assert.deepEqual(scenario.serviceCalls, []);
});
