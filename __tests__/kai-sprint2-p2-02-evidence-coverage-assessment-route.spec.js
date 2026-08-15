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
 * P2-02 evidence-coverage-assessment composition proof. Mirrors the existing
 * proven `kai-sprint2-p2-01-evidence-extraction-route.spec.js` pattern exactly.
 * P2-02's own read logic (the ten dimension assessors, the reused lineage/
 * permission gate) is not retested here - it remains owned by
 * `kai-sprint2-p2-02-evidence-coverage-assessment-boundary.spec.js` and the
 * P2-02 verifier script. This file proves only the new mounted boundary: the
 * route forwards server-resolved organizationId/sourceVersionId/actorContext
 * to the existing service, unchanged, with no persistence or audit path of
 * its own.
 */

const basePath = "/api/kai/sprint2/intake";
const routePath = "/admin/organizations/:organizationId/source-versions/:sourceVersionId/evidence-coverage-assessment";
const organizationId = "00000000-0000-4000-8000-000000000001";
const sourceVersionId = "00000000-0000-4000-8000-000000000801";
const actorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  source: "public.userdata",
  organizationMemberships: [
    { organization_id: organizationId, membership_status: "active", role_name: "gk_admin" },
  ],
});
const injectedAssessmentDto = Object.freeze({
  organization_id: organizationId,
  source_version_id: sourceVersionId,
  data_dictionary_id: "60000000-0000-4000-8000-000000000001",
  profile_canonical_sha256: "a".repeat(64),
  dimensions: { missingness: { ok: true } },
});

function concretePath(overrides = {}) {
  return `${basePath}/admin/organizations/${overrides.organizationId || organizationId}`
    + `/source-versions/${overrides.sourceVersionId || sourceVersionId}/evidence-coverage-assessment`;
}

function createScenario(overrides = {}) {
  return {
    authenticated: true,
    actorContext,
    serviceCalls: [],
    dependencyCalls: [],
    serviceResult: { ok: true, data: injectedAssessmentDto, error: null },
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

test("P2-02 evidence-coverage-assessment route appears as exactly one mounted authenticated GET route", () => {
  const matches = sprint2IntakeApiRouter.stack
    .filter((layer) => layer.route?.path === routePath && layer.route?.methods?.get);
  assert.equal(matches.length, 1);
  assert.deepEqual(Object.keys(matches[0].route.methods), ["get"]);
});

test("P2-02 evidence-coverage-assessment route", async (t) => {
  let scenario = createScenario();
  const originalFeatureFlag = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "true";
  const restore = intakeRouteTestables.setIntakeServiceForTest({
    async assessEvidenceCoverageForSourceVersion(input, dependencies) {
      scenario.serviceCalls.push(input);
      scenario.dependencyCalls.push(dependencies);
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

  await t.test("unauthenticated requests fail before the P2-02 read seam", async () => {
    scenario = createScenario({ authenticated: false });
    const response = await requestJson(server, concretePath());

    assert.equal(response.statusCode, 401);
    assert.equal(response.body.error.code, "unauthorized");
    assert.deepEqual(scenario.serviceCalls, []);
    assert.deepEqual(scenario.events, ["outer_feature_gate_passed", "canonical_http_authentication"]);
  });

  await t.test(
    "an authenticated mapped human in the correct organization reaches the service exactly once with server-resolved identity, no metadataOnlyAudit dependency",
    async () => {
      scenario = createScenario();
      const response = await requestJson(server, concretePath());

      assert.equal(response.statusCode, 200);
      assert.equal(scenario.serviceCalls.length, 1);
      const call = scenario.serviceCalls[0];
      assert.deepEqual(call, { organizationId, sourceVersionId, actorContext });
      assert.deepEqual(response.body, { ok: true, data: injectedAssessmentDto, warnings: [] });

      const dependencies = scenario.dependencyCalls[0];
      assert.equal(dependencies?.metadataOnlyAudit, undefined, "P2-02 is read-only and must not receive an audit dependency");
    },
  );

  await t.test("caller-supplied identifiers cannot replace the server-resolved actor or path-scoped tenant identity", async () => {
    scenario = createScenario();
    const response = await requestJson(
      server,
      `${concretePath()}?organization_id=00000000-0000-4000-8000-000000000999&actorContext=%7B%22actorType%22%3A%22system%22%7D`,
    );

    assert.equal(response.statusCode, 200);
    assert.equal(scenario.serviceCalls.length, 1);
    assert.deepEqual(scenario.serviceCalls[0], { organizationId, sourceVersionId, actorContext });
  });

  await t.test("malformed path values use the existing safe validation_blocker response", async () => {
    for (const path of [
      concretePath({ organizationId: "not-a-uuid" }),
      concretePath({ sourceVersionId: "not-a-uuid" }),
      concretePath({ organizationId: "a0000000-0000-4000-8000-000000000001".toUpperCase() }),
      concretePath({ sourceVersionId: "a0000000-0000-4000-8000-000000000801".toUpperCase() }),
    ]) {
      scenario = createScenario();
      const response = await requestJson(server, path);
      assert.equal(response.statusCode, 422, path);
      assert.equal(response.body.error.code, "validation_blocker", path);
      assert.deepEqual(scenario.serviceCalls, [], path);
    }
  });

  await t.test(
    "unmapped/unauthorized/non-human/cross-tenant service rejections fail closed before any leak",
    async () => {
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
    },
  );
});

test("P2-02 evidence-coverage-assessment route: KAI_SPRINT2_ENABLED=false produces zero P2-02 service activity", async (t) => {
  const originalFeatureFlag = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "false";
  let scenario = createScenario();
  const restore = intakeRouteTestables.setIntakeServiceForTest({
    async assessEvidenceCoverageForSourceVersion(input, dependencies) {
      scenario.serviceCalls.push(input);
      scenario.dependencyCalls.push(dependencies);
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

test("P2-02 evidence-coverage-assessment route source imports no database/repository layer, performs no writes, and invokes no P2-03+ service", () => {
  const source = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
  const slice = source.slice(
    source.indexOf("async function getEvidenceCoverageAssessmentService"),
    source.indexOf("export default router;"),
  );
  assert.match(slice, /assessEvidenceCoverageForSourceVersion/);
  assert.doesNotMatch(slice, /from\s+["'][^"']*(?:db|repository|postgres|kaiDb|kaiQueries|kaiReadModels)[^"']*["']/i);
  assert.doesNotMatch(slice, /\b(?:SELECT|INSERT|UPDATE|DELETE)\b|\bpool\b|\bkaiDb\b|\brepository\b|\bkai\.(?!js\b)/i);
  assert.doesNotMatch(slice, /metadataOnlyAudit/i);
  assert.doesNotMatch(slice, /p2-03|p2-04|p2-05|p2-06|p2-07|p2-08|kaiClaimProposalService|kaiConflictReviewService|kaiExportCandidateService|kaiClaimGapFollowupService/i);
});
