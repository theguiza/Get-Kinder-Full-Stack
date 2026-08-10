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

const basePath = "/api/kai/sprint2/intake";
const routePath =
  "/admin/organizations/:organizationId/generated-content-drafts/:generatedContentDraftId/export-review-queue/:exportReviewQueueItemId/packet";
const organizationId = "00000000-0000-4000-8000-000000000001";
const generatedContentDraftId = "00000000-0000-4000-8000-000000000702";
const exportReviewQueueItemId = "00000000-0000-4000-8000-000000000710";
const actorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  source: "public.userdata",
  organizationMemberships: [
    { organization_id: organizationId, membership_status: "active", role_name: "gk_admin" },
  ],
});
const injectedPacketDto = Object.freeze({
  generatedContentDraftId,
  exportReviewQueueItemId,
  exportAudience: "internal",
  reviewReadiness: "ready",
  blocks: [
    {
      generatedContentBlockId: "00000000-0000-4000-8000-000000000703",
      ordinal: 1,
      text: "Visible export-review packet text.",
      citations: [
        {
          generatedContentCitationId: "00000000-0000-4000-8000-000000000704",
          claimId: "00000000-0000-4000-8000-000000000705",
          evidenceItemId: "00000000-0000-4000-8000-000000000706",
        },
      ],
    },
  ],
  validatorResult: {
    eligible: true,
    blockerCodes: [],
    affectedDimensionKeys: [],
    affectedObjectIds: [],
    truncated: false,
  },
  exportReviewUpdatedAt: "2026-08-06T09:00:00.000Z",
});

function concretePath(overrides = {}) {
  return `${basePath}/admin/organizations/${overrides.organizationId || organizationId}`
    + `/generated-content-drafts/${overrides.generatedContentDraftId || generatedContentDraftId}`
    + `/export-review-queue/${overrides.exportReviewQueueItemId || exportReviewQueueItemId}/packet`;
}

function createScenario(overrides = {}) {
  return {
    authenticated: true,
    actorContext,
    serviceCalls: [],
    serviceResult: { ok: true, data: injectedPacketDto, error: null },
    events: [],
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
      method: "GET",
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

test("P3-07 route appears as exactly one mounted authenticated GET route", () => {
  const matches = sprint2IntakeApiRouter.stack
    .filter((layer) => layer.route?.path === routePath && layer.route?.methods?.get);
  assert.equal(matches.length, 1);
  assert.deepEqual(Object.keys(matches[0].route.methods), ["get"]);
});

test("P3-07 route forwards only path identifiers and middleware actorContext once", async (t) => {
  let scenario = createScenario();
  const originalFeatureFlag = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "true";
  const restore = intakeRouteTestables.setIntakeServiceForTest({
    async getGeneratedDraftExportReviewPacket(input) {
      scenario.serviceCalls.push(input);
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

  await t.test("authentication failure prevents the service call", async () => {
    scenario = createScenario({ authenticated: false });
    const response = await requestJson(server, concretePath());

    assert.equal(response.statusCode, 401);
    assert.equal(response.body.error.code, "unauthorized");
    assert.deepEqual(scenario.serviceCalls, []);
    assert.deepEqual(scenario.events, ["outer_feature_gate_passed", "canonical_http_authentication"]);
  });

  await t.test("exact path values and middleware actorContext are forwarded once", async () => {
    scenario = createScenario();
    const response = await requestJson(server, concretePath());

    assert.equal(response.statusCode, 200);
    assert.equal(scenario.serviceCalls.length, 1);
    assert.deepEqual(scenario.serviceCalls[0], {
      organizationId,
      generatedContentDraftId,
      exportReviewQueueItemId,
      actorContext,
    });
    assert.deepEqual(response.body, { ok: true, data: injectedPacketDto, warnings: [] });
  });

  await t.test("query and body fields do not enter the service input", async () => {
    scenario = createScenario();
    const response = await requestJson(
      server,
      `${concretePath()}?organization_id=00000000-0000-4000-8000-000000000999&actorContext=forbidden`,
      { body: { actorContext: { actorType: "system" }, exportReviewQueueItemId: "forbidden" } },
    );

    assert.equal(response.statusCode, 200);
    assert.deepEqual(scenario.serviceCalls, [{
      organizationId,
      generatedContentDraftId,
      exportReviewQueueItemId,
      actorContext,
    }]);
  });

  await t.test("malformed path values use the existing safe invalid_request response", async () => {
    for (const path of [
      concretePath({ organizationId: "not-a-uuid" }),
      concretePath({ generatedContentDraftId: "a0000000-0000-4000-8000-000000000702".toUpperCase() }),
      concretePath({ exportReviewQueueItemId: "a0000000-0000-4000-8000-000000000710".toUpperCase() }),
    ]) {
      scenario = createScenario();
      const response = await requestJson(server, path);
      assert.equal(response.statusCode, 400, path);
      assert.deepEqual(response.body, buildKaiError("invalid_request"));
      assert.deepEqual(scenario.serviceCalls, [], path);
    }
  });

  await t.test("every listed service error maps through the existing safe envelope", async () => {
    for (const code of [
      "feature_disabled",
      "invalid_request",
      "unauthorized",
      "mapped_kai_user_required",
      "authorization_denied",
      "tenant_boundary_violation",
      "not_found",
      "conflict_current_state_changed",
      "system_error",
    ]) {
      scenario = createScenario({
        serviceResult: buildKaiError(code, {
          data: { partial: "must not leak" },
          blockers: [{ validator_key: "unsafe", evidence: { secret: true } }],
          warnings: [{ code: "unsafe_warning", message: "must not leak" }],
        }),
      });
      const response = await requestJson(server, concretePath());

      assert.equal(response.statusCode, KAI_ERROR_STATUS[code], code);
      assert.equal(response.body.ok, false, code);
      assert.equal(response.body.error.code, code);
      assert.equal(response.body.data, null, code);
      assert.equal(JSON.stringify(response.body).includes("must not leak"), false, code);
      assert.equal(JSON.stringify(response.body).includes("partial"), false, code);
      assert.equal(scenario.serviceCalls.length, 1, code);
    }
  });
});

test("P3-07 route source imports no database or repository layer and performs no writes", () => {
  const source = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
  const slice = source.slice(
    source.indexOf("async function getExportReviewService"),
    source.indexOf('router.post("/admin/batches"'),
  );
  assert.match(source, /function exportReviewPacketIdentifiers/);
  assert.match(source, /function sprint2MappedActorContext/);
  assert.doesNotMatch(slice, /from\s+["'][^"']*(?:db|repository|postgres|kaiDb|kaiQueries|kaiReadModels)[^"']*["']/i);
  assert.doesNotMatch(slice, /\b(?:SELECT|INSERT|UPDATE|DELETE)\b|\bpool\b|\bkaiDb\b|\brepository\b|\bkai\.(?!js\b)/i);
  assert.doesNotMatch(slice, /audit|queue transition|approval|export-authority|final-gate|manifest|writeFile|createWriteStream|signed_url/i);
});
