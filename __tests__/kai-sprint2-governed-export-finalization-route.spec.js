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
const routePath = "/admin/organizations/:organizationId/export-candidates/:exportCandidateId/export-manifests";
const ORG = "00000000-0000-4000-8000-000000000001";
const CANDIDATE = "00000000-0000-4000-8000-000000000701";
const QUEUE_ITEM = "00000000-0000-4000-8000-000000000703";
const MANIFEST = "00000000-0000-4000-8000-000000000901";
const ACTOR = "90000000-0000-4000-8000-000000000001";

const gkAdminActorContext = Object.freeze({
  actorType: "human",
  actorUserId: ACTOR,
  organizationMemberships: [
    { organization_id: ORG, membership_status: "active", role_name: "gk_admin" },
  ],
});

async function startServer(scenario) {
  const restoreFeatureFlag = (() => {
    const original = process.env.KAI_SPRINT2_ENABLED;
    process.env.KAI_SPRINT2_ENABLED = "true";
    return () => {
      if (original === undefined) delete process.env.KAI_SPRINT2_ENABLED;
      else process.env.KAI_SPRINT2_ENABLED = original;
    };
  })();
  const restoreService = intakeRouteTestables.setIntakeServiceForTest({
    async createExportManifest(input, dependencies) {
      scenario.serviceCalls.push(input);
      scenario.dependencyCalls.push(dependencies);
      return scenario.result;
    },
  });
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
  return {
    server,
    async close() {
      restoreService();
      restoreFeatureFlag();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

async function requestJson(server, path, body) {
  const { port } = server.address();
  const serialized = JSON.stringify(body);
  return await new Promise((resolve, reject) => {
    const request = http.request({
      hostname: "127.0.0.1",
      port,
      path,
      method: "POST",
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(serialized) },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        statusCode: response.statusCode,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
      }));
    });
    request.on("error", reject);
    request.write(serialized);
    request.end();
  });
}

test("governed export finalization route delegates to createExportManifest and returns the exact exportManifestId", async (t) => {
  const scenario = {
    authenticated: true,
    actorContext: gkAdminActorContext,
    serviceCalls: [],
    dependencyCalls: [],
    result: {
      ok: true,
      data: {
        exportManifestId: MANIFEST,
        exportCandidateId: CANDIDATE,
        effectiveAuthorityDecisionId: "00000000-0000-4000-8000-000000000902",
        fingerprintContractVersion: 1,
        canonicalFingerprint: "deadbeef",
        replayed: false,
      },
      error: null,
    },
  };
  const { server, close } = await startServer(scenario);
  t.after(close);

  const path = `${basePath}/admin/organizations/${ORG}/export-candidates/${CANDIDATE}/export-manifests`;
  const before = Date.now();
  const response = await requestJson(server, path, { export_review_queue_item_id: QUEUE_ITEM });
  const after = Date.now();

  assert.equal(response.statusCode, 201);
  assert.equal(scenario.serviceCalls.length, 1);
  assert.deepEqual(scenario.serviceCalls[0], {
    organizationId: ORG,
    exportCandidateId: CANDIDATE,
    exportReviewQueueItemId: QUEUE_ITEM,
    actorContext: gkAdminActorContext,
    now: scenario.serviceCalls[0].now,
  });
  assert.equal(typeof scenario.dependencyCalls[0].metadataOnlyAudit?.prepareMetadataOnlyAudit, "function");
  assert.equal(response.body.data.exportManifestId, MANIFEST);
  assert.equal(response.body.data.exportCandidateId, CANDIDATE);
  const nowMs = new Date(scenario.serviceCalls[0].now).getTime();
  assert.ok(nowMs >= before && nowMs <= after);
});

test("governed export finalization route rejects missing/unknown body fields before service", async (t) => {
  const scenario = { authenticated: true, actorContext: gkAdminActorContext, serviceCalls: [], dependencyCalls: [], result: { ok: true, data: {}, error: null } };
  const { server, close } = await startServer(scenario);
  t.after(close);
  const path = `${basePath}/admin/organizations/${ORG}/export-candidates/${CANDIDATE}/export-manifests`;

  const missing = await requestJson(server, path, {});
  assert.equal(missing.statusCode, 422);
  assert.equal(missing.body.error.code, "validation_blocker");

  const unknown = await requestJson(server, path, { export_review_queue_item_id: QUEUE_ITEM, finalGate: true });
  assert.equal(unknown.statusCode, 422);
  assert.equal(unknown.body.error.code, "validation_blocker");

  assert.deepEqual(scenario.serviceCalls, []);
});

test("governed export finalization route propagates a P3-19 structured blocker without creating a manifest", async (t) => {
  const scenario = {
    authenticated: true,
    actorContext: gkAdminActorContext,
    serviceCalls: [],
    dependencyCalls: [],
    result: { ok: false, error: { code: "conflict_current_state_changed" }, data: null },
  };
  const { server, close } = await startServer(scenario);
  t.after(close);
  const path = `${basePath}/admin/organizations/${ORG}/export-candidates/${CANDIDATE}/export-manifests`;

  const response = await requestJson(server, path, { export_review_queue_item_id: QUEUE_ITEM });
  assert.equal(response.body.error.code, "conflict_current_state_changed");
  assert.equal(response.body.ok, false);
});

test("governed export finalization route requires authentication", async (t) => {
  const scenario = { authenticated: false, actorContext: gkAdminActorContext, serviceCalls: [], dependencyCalls: [], result: { ok: true, data: {}, error: null } };
  const { server, close } = await startServer(scenario);
  t.after(close);
  const path = `${basePath}/admin/organizations/${ORG}/export-candidates/${CANDIDATE}/export-manifests`;

  const response = await requestJson(server, path, { export_review_queue_item_id: QUEUE_ITEM });
  assert.equal(response.statusCode, 401);
  assert.deepEqual(scenario.serviceCalls, []);
});

test("governed export finalization route is mounted exactly once and delegates to the service only", () => {
  const matches = sprint2IntakeApiRouter.stack
    .filter((layer) => layer.route?.path === routePath && layer.route?.methods?.post);
  assert.equal(matches.length, 1);
  assert.deepEqual(Object.keys(matches[0].route.methods), ["post"]);

  const routeSource = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
  const routeStart = routeSource.indexOf(`"${routePath}"`);
  assert.notEqual(routeStart, -1);
  const routeEnd = routeSource.indexOf("async function getExportManifestMarkdownService(", routeStart);
  const routeSlice = routeSource.slice(routeStart, routeEnd);
  assert.match(routeSlice, /service\.createExportManifest/);
  assert.doesNotMatch(routeSlice, /\b(?:SELECT|INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b|\bpool\b|\bkaiDb\b|\brepository\b|\bkai\.(?!js\b)/i);
});

test("kaiExportManifestService remains the sole authority: no manifest-selection-by-timestamp/latest logic in the route", () => {
  const routeSource = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
  const routeStart = routeSource.indexOf(`"${routePath}"`);
  const routeEnd = routeSource.indexOf("async function getExportManifestMarkdownService(", routeStart);
  const routeSlice = routeSource.slice(routeStart, routeEnd);
  assert.doesNotMatch(routeSlice, /ORDER BY|LIMIT 1|latest|most recent|current\s*=\s*true|active\s*=\s*true/i);
});
