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

/**
 * P2-06 human claim-traceability read composition proof. Mirrors the existing
 * proven `kai-sprint2-p2-04-claim-gap-followup-route.spec.js` pattern exactly,
 * as a GET route instead of a POST route. The P2-06 service's own evaluator,
 * blocker ordering, traceability DTO, tenant/role rules, and REPEATABLE READ
 * READ ONLY transaction behavior are not retested here - they remain owned by
 * `kai-sprint2-p2-06-claim-traceability-boundary.spec.js`,
 * `kai-sprint2-p2-06-claim-traceability.integration.spec.js`, and the P2-06
 * verifier script. This file proves only the new mounted boundary: the route
 * forwards server-resolved organizationId/claimId/actorContext plus the
 * caller-supplied requestedAudience to the existing service, unchanged,
 * exactly once, with no persistence and no audit write.
 */

const basePath = "/api/kai/sprint2/intake";
const routePath = "/admin/organizations/:organizationId/claims/:claimId/traceability";
const organizationId = "00000000-0000-4000-8000-000000000001";
const claimId = "a0000000-0000-4000-8000-000000000001";
const actorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  source: "public.userdata",
  organizationMemberships: [
    { organization_id: organizationId, membership_status: "active", role_name: "gk_reviewer" },
  ],
});
const injectedTraceabilityDto = Object.freeze({
  claim: { claim_id: claimId, claim_status: "proposed" },
  eligible: true,
  blockerCodes: [],
});

function concretePath(overrides = {}) {
  const query = overrides.requestedAudience === undefined
    ? "?requested_audience=internal"
    : overrides.requestedAudience === null
      ? ""
      : `?requested_audience=${encodeURIComponent(overrides.requestedAudience)}`;
  return `${basePath}/admin/organizations/${overrides.organizationId || organizationId}`
    + `/claims/${overrides.claimId || claimId}/traceability${query}`;
}

function createScenario(overrides = {}) {
  return {
    authenticated: true,
    actorContext,
    serviceCalls: [],
    serviceResult: { ok: true, data: injectedTraceabilityDto, error: null },
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

async function requestJson(server, path, { method = "GET" } = {}) {
  const { port } = server.address();
  return await new Promise((resolve, reject) => {
    const request = http.request({
      hostname: "127.0.0.1",
      port,
      path,
      method,
      headers: {},
    }, (response) => {
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

test("P2-06 claim-traceability route appears as exactly one mounted authenticated GET route", () => {
  const matches = sprint2IntakeApiRouter.stack
    .filter((layer) => layer.route?.path === routePath && layer.route?.methods?.get);
  assert.equal(matches.length, 1);
  assert.deepEqual(Object.keys(matches[0].route.methods), ["get"]);
});

test("P2-06 claim-traceability route", async (t) => {
  let scenario = createScenario();
  const originalFeatureFlag = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "true";
  const restore = intakeRouteTestables.setIntakeServiceForTest({
    async getClaimTraceabilitySummary(input) {
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

  await t.test("unauthenticated requests fail before the P2-06 service seam", async () => {
    scenario = createScenario({ authenticated: false });
    const response = await requestJson(server, concretePath());

    assert.equal(response.statusCode, 401);
    assert.equal(response.body.error.code, "unauthorized");
    assert.deepEqual(scenario.serviceCalls, []);
    assert.deepEqual(scenario.events, ["outer_feature_gate_passed", "canonical_http_authentication"]);
  });

  await t.test(
    "an authenticated mapped human in the correct organization reaches the service exactly once with the exact expected inputs",
    async () => {
      scenario = createScenario();
      const response = await requestJson(server, concretePath({ requestedAudience: "public" }));

      assert.equal(response.statusCode, 200);
      assert.equal(scenario.serviceCalls.length, 1);
      assert.deepEqual(scenario.serviceCalls[0], {
        organizationId,
        claimId,
        requestedAudience: "public",
        actorContext,
      });
      assert.deepEqual(response.body, { ok: true, data: injectedTraceabilityDto, warnings: [] });
    },
  );

  await t.test("actor/tenant identity cannot be overridden by caller-supplied data", async () => {
    scenario = createScenario();

    // Attempting to smuggle an alternate organization/actor identity alongside
    // requested_audience is an unknown-field combination, so the route's
    // exact-key query validation fails closed before the service is ever
    // called - the caller-supplied override values never reach the service.
    const smuggledResponse = await requestJson(
      server,
      `${concretePath()}&organization_id=00000000-0000-4000-8000-000000000999`
        + "&actorContext=%7B%22actorType%22%3A%22system%22%7D&actorType=system&roles=gk_admin",
    );
    assert.equal(smuggledResponse.statusCode, 422);
    assert.equal(smuggledResponse.body.error.code, "validation_blocker");
    assert.deepEqual(scenario.serviceCalls, []);

    // A clean request with only the accepted requested_audience field reaches
    // the service using exclusively the server-derived organizationId/claimId
    // (from the authenticated path) and actorContext (from the session) -
    // there is no field the caller can supply to change either.
    const cleanResponse = await requestJson(server, concretePath({ requestedAudience: "internal" }));
    assert.equal(cleanResponse.statusCode, 200);
    assert.equal(scenario.serviceCalls.length, 1);
    assert.deepEqual(scenario.serviceCalls[0], {
      organizationId,
      claimId,
      requestedAudience: "internal",
      actorContext,
    });
  });

  await t.test("invalid or missing requestedAudience fails closed before the service is called", async () => {
    for (const path of [
      concretePath({ requestedAudience: null }),
      concretePath({ requestedAudience: "partner" }),
      `${concretePath({ requestedAudience: null })}?requested_audience=internal&extra=1`,
    ]) {
      scenario = createScenario();
      const response = await requestJson(server, path);
      assert.equal(response.statusCode, 422, path);
      assert.equal(response.body.error.code, "validation_blocker", path);
      assert.deepEqual(scenario.serviceCalls, [], path);
    }
  });

  await t.test("malformed path values use the existing safe validation_blocker response", async () => {
    for (const path of [
      concretePath({ organizationId: "not-a-uuid" }),
      concretePath({ claimId: "not-a-uuid" }),
      concretePath({ claimId: claimId.toUpperCase() }),
    ]) {
      scenario = createScenario();
      const response = await requestJson(server, path);
      assert.equal(response.statusCode, 422, path);
      assert.equal(response.body.error.code, "validation_blocker", path);
      assert.deepEqual(scenario.serviceCalls, [], path);
    }
  });

  await t.test(
    "existing unauthorized/non-human/cross-tenant service rejections fail before any leak",
    async () => {
      for (const code of [
        "feature_disabled",
        "invalid_request",
        "unauthorized",
        "mapped_kai_user_required",
        "authorization_denied",
        "tenant_boundary_violation",
        "not_found",
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
    },
  );
});

test("P2-06 claim-traceability route: KAI_SPRINT2_ENABLED=false produces zero P2-06 service activity", async (t) => {
  const originalFeatureFlag = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "false";
  let scenario = createScenario();
  const restore = intakeRouteTestables.setIntakeServiceForTest({
    async getClaimTraceabilitySummary(input) {
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

  const response = await requestJson(server, concretePath());
  assert.equal(response.statusCode, 403);
  assert.deepEqual(scenario.serviceCalls, []);
});

test("P2-06 claim-traceability route source imports no database or repository layer, performs no writes/audit, and invokes no other P2 service", () => {
  const source = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
  const slice = source.slice(
    source.indexOf("let claimTraceabilityServicePromise"),
    source.indexOf("export default router;"),
  );
  assert.match(source, /async function getClaimTraceabilityService/);
  assert.match(slice, /getClaimTraceabilitySummary/);
  assert.doesNotMatch(slice, /from\s+["'][^"']*(?:db|repository|postgres|kaiDb|kaiQueries|kaiReadModels)[^"']*["']/i);
  assert.doesNotMatch(slice, /\b(?:SELECT|INSERT|UPDATE|DELETE)\b|\bpool\b|\bkaiDb\b|\brepository\b|\bkai\.(?!js\b)/i);
  assert.doesNotMatch(slice, /metadataOnlyAudit/i);
  assert.doesNotMatch(slice, /p2-07|p2-08|kaiEligibleClaimsForAudienceService|kaiAssistantClaimTraceabilityTool/i);
});

test("P2-06 claim-traceability route source never contains the literal token req.user", () => {
  const source = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
  const slice = source.slice(
    source.indexOf("let claimTraceabilityServicePromise"),
    source.indexOf("export default router;"),
  );
  assert.doesNotMatch(slice, /req\.user/);
});
