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
const routePath = "/admin/organizations/:organizationId/source-versions/:sourceVersionId/evidence-extraction";
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
const injectedExtractionDto = Object.freeze({
  sourceVersionId,
  evidenceItemCount: 3,
  sourceLocatorCount: 3,
  reviewQueueItemCount: 3,
  freshWriteCount: 3,
});

function concretePath(overrides = {}) {
  return `${basePath}/admin/organizations/${overrides.organizationId || organizationId}`
    + `/source-versions/${overrides.sourceVersionId || sourceVersionId}/evidence-extraction`;
}

function createScenario(overrides = {}) {
  return {
    authenticated: true,
    actorContext,
    serviceCalls: [],
    dependencyCalls: [],
    serviceResult: { ok: true, data: injectedExtractionDto, error: null },
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

test("P2-01 evidence-extraction route appears as exactly one mounted authenticated POST route", () => {
  const matches = sprint2IntakeApiRouter.stack
    .filter((layer) => layer.route?.path === routePath && layer.route?.methods?.post);
  assert.equal(matches.length, 1);
  assert.deepEqual(Object.keys(matches[0].route.methods), ["post"]);
});

test("P2-01 evidence-extraction route", async (t) => {
  let scenario = createScenario();
  const originalFeatureFlag = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "true";
  const restore = intakeRouteTestables.setIntakeServiceForTest({
    async extractEvidenceFromSourceVersion(input, dependencies) {
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

  await t.test("unauthenticated requests fail before the P2-01 write seam", async () => {
    scenario = createScenario({ authenticated: false });
    const response = await requestJson(server, concretePath());

    assert.equal(response.statusCode, 401);
    assert.equal(response.body.error.code, "unauthorized");
    assert.deepEqual(scenario.serviceCalls, []);
    assert.deepEqual(scenario.events, ["outer_feature_gate_passed", "canonical_http_authentication"]);
  });

  await t.test(
    "an authenticated mapped human in the correct organization reaches the service exactly once with server-resolved identity and a production metadataOnlyAudit dependency",
    async () => {
      scenario = createScenario();
      const before = Date.now();
      const response = await requestJson(server, concretePath());
      const after = Date.now();

      assert.equal(response.statusCode, 200);
      assert.equal(scenario.serviceCalls.length, 1);
      const call = scenario.serviceCalls[0];
      assert.deepEqual(call, {
        organizationId,
        sourceVersionId,
        actorContext,
        now: call.now,
      });
      assert.deepEqual(response.body, { ok: true, data: injectedExtractionDto, warnings: [] });

      assert.match(call.now, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      const nowMs = new Date(call.now).getTime();
      assert.ok(nowMs >= before && nowMs <= after, "now must be generated server-side within the request window");

      const dependencies = scenario.dependencyCalls[0];
      assert.equal(typeof dependencies.metadataOnlyAudit?.prepareMetadataOnlyAudit, "function");
      const prepared = dependencies.metadataOnlyAudit.prepareMetadataOnlyAudit({
        payload: { attempted_operation: "extract_evidence_lineage", object_type: "evidence_item" },
      });
      assert.equal(prepared.ok, true);
      assert.equal(typeof prepared.publish, "function");
    },
  );

  await t.test("request data cannot override server-resolved actor or tenant identity", async () => {
    scenario = createScenario();
    const response = await requestJson(
      server,
      `${concretePath()}?organization_id=00000000-0000-4000-8000-000000000999`,
      {
        body: {
          organization_id: "00000000-0000-4000-8000-000000000999",
          actorContext: { actorType: "system", actorUserId: "attacker" },
          now: "1999-01-01T00:00:00.000Z",
        },
      },
    );

    assert.equal(response.statusCode, 422);
    assert.equal(response.body.error.code, "validation_blocker");
    assert.deepEqual(scenario.serviceCalls, []);
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
    "unmapped/unauthorized/non-human service rejections fail before any write, with no leaked detail",
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

test("P2-01 evidence-extraction route: KAI_SPRINT2_ENABLED=false produces zero service/write activity", async (t) => {
  const originalFeatureFlag = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "false";
  let scenario = createScenario();
  const restore = intakeRouteTestables.setIntakeServiceForTest({
    async extractEvidenceFromSourceVersion(input, dependencies) {
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

test("P2-01 evidence-extraction route source imports no database or repository layer and performs no writes", () => {
  const source = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
  const slice = source.slice(
    source.indexOf("function sourceVersionEvidenceExtractionIdentifiers"),
    source.indexOf("export default router;"),
  );
  assert.match(source, /function sourceVersionEvidenceExtractionIdentifiers/);
  assert.match(slice, /extractEvidenceFromSourceVersion/);
  assert.doesNotMatch(slice, /from\s+["'][^"']*(?:db|repository|postgres|kaiDb|kaiQueries|kaiReadModels)[^"']*["']/i);
  assert.doesNotMatch(slice, /\b(?:SELECT|INSERT|UPDATE|DELETE)\b|\bpool\b|\bkaiDb\b|\brepository\b|\bkai\.(?!js\b)/i);
  assert.doesNotMatch(slice, /p2-02|p2-03|p2-04|p2-05|kaiClaimProposalService|kaiConflictReviewService|kaiExportCandidateService/i);
});
