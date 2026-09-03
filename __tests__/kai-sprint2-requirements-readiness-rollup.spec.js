import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

import sprint2IntakeApiRouter, { __testables as intakeRouteTestables } from "../Backend/kai/routes/sprint2IntakeApi.js";
import { requireKaiSprint2Enabled } from "../Backend/kai/config/kaiSprint2Config.js";
import { createAttachKaiSprint2ActorContext, requireKaiSprint2Authenticated } from "../Backend/kai/middleware/kaiSprint2Authentication.js";
import {
  handleKaiSprint2JsonParserError,
  kaiSprint2ActorMutationLimiter,
  kaiSprint2MetadataJsonParser,
  kaiSprint2OrganizationMutationLimiter,
  setKaiSprint2NoStore,
} from "../Backend/kai/middleware/kaiSprint2RequestSafety.js";
import { organizationRequirementsReadinessPath, projectRequirementsReadiness } from "../frontend/impactEvidenceLibraryLogic.js";
import { listOrganizationRequirementsReadiness } from "../Backend/kai/services/kaiRequirementAssessmentService.js";

const basePath = "/api/kai/sprint2/intake";
const organizationId = "00000000-0000-4000-8000-000000000001";
const requirementId = "00000000-0000-4000-8000-000000000501";
const actorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  organizationMemberships: [
    { organization_id: organizationId, membership_status: "active", role_name: "gk_reviewer" },
  ],
});

function scenario(overrides = {}) {
  return {
    authenticated: true,
    actorContext,
    calls: [],
    result: { ok: true, data: { requirements: [] }, error: null },
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
    if (current.authenticated) req.user = { id: 46 };
    return next();
  });
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

test("Requirements readiness rollup route is mounted once as authenticated read-only GET", () => {
  const matches = sprint2IntakeApiRouter.stack
    .filter((layer) => layer.route?.path === "/admin/organizations/:organizationId/requirements" && layer.route?.methods?.get);
  assert.equal(matches.length, 1);
  assert.deepEqual(Object.keys(matches[0].route.methods), ["get"]);
});

test("Requirements readiness rollup route delegates to the requirement-assessment service and rejects an invalid organization id", async (t) => {
  let current = scenario({
    result: {
      ok: true,
      data: {
        requirements: [
          { requirement_id: requirementId, requirement_key: "ir_pur_001", requirement_label: "Intended outcome is explicitly defined", assessed: false, assessment: null },
        ],
      },
      error: null,
    },
  });
  const restore = intakeRouteTestables.setIntakeServiceForTest({
    async assessOrganizationRequirement() {
      throw new Error("must not be called by this route");
    },
    async listOrganizationRequirementsReadiness(input) {
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

  const rejected = await requestJson(server, `${basePath}/admin/organizations/not-a-uuid/requirements`);
  assert.equal(rejected.statusCode, 422);
  assert.deepEqual(current.calls, []);

  const ok = await requestJson(server, `${basePath}/admin/organizations/${organizationId}/requirements`);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.data.requirements[0].requirement_key, "ir_pur_001");
  assert.deepEqual(current.calls, [{ organizationId, actorContext }]);

  assert.deepEqual(projectRequirementsReadiness(ok.body.data), [{
    requirementId,
    requirementKey: "ir_pur_001",
    requirementLabel: "Intended outcome is explicitly defined",
    assessed: false,
    assessmentState: null,
    assessmentExplanation: null,
    assessedAt: null,
  }]);
});

test("listOrganizationRequirementsReadiness service denies an actor with no active membership in the organization", async () => {
  const outsiderContext = {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000099",
    organizationMemberships: [],
  };
  const result = await listOrganizationRequirementsReadiness(
    { organizationId, actorContext: outsiderContext },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      requirementAssessmentRepository: {
        async listOrganizationRequirementsReadiness() {
          throw new Error("must not be called when authorization is denied");
        },
      },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("listOrganizationRequirementsReadiness service delegates to the repository for an authorized gk_operator (read-only role)", async () => {
  const operatorContext = {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000098",
    organizationMemberships: [
      { organization_id: organizationId, membership_status: "active", role_name: "gk_operator" },
    ],
  };
  let calls = [];
  const result = await listOrganizationRequirementsReadiness(
    { organizationId, actorContext: operatorContext },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      requirementAssessmentRepository: {
        async listOrganizationRequirementsReadiness(input) {
          calls.push(input);
          return { ok: true, data: { requirements: [] }, error: null };
        },
      },
    },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [{ organizationId }]);
});

test("organizationRequirementsReadinessPath builds the org-scoped requirements listing path", () => {
  assert.equal(
    organizationRequirementsReadinessPath(organizationId),
    `${basePath}/admin/organizations/${organizationId}/requirements`,
  );
});

test("projectRequirementsReadiness surfaces an already-assessed requirement's state and explanation", () => {
  const projected = projectRequirementsReadiness({
    requirements: [
      {
        requirement_id: requirementId,
        requirement_key: "ir_stk_001",
        requirement_label: "The stakeholder experiencing the intended outcome is identified",
        assessed: true,
        assessment: {
          assessment_state: "met",
          assessment_explanation: "Stakeholder is documented for every current outcome context.",
          created_at: "2026-08-15T10:00:00.000Z",
        },
      },
    ],
  });
  assert.deepEqual(projected, [{
    requirementId,
    requirementKey: "ir_stk_001",
    requirementLabel: "The stakeholder experiencing the intended outcome is identified",
    assessed: true,
    assessmentState: "met",
    assessmentExplanation: "Stakeholder is documented for every current outcome context.",
    assessedAt: "2026-08-15T10:00:00.000Z",
  }]);
});
