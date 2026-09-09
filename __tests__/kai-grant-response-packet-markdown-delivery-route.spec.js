import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { readFileSync } from "node:fs";

import sprint2IntakeApiRouter, { __testables as intakeRouteTestables } from "../Backend/kai/routes/sprint2IntakeApi.js";
import { requireKaiSprint2Enabled } from "../Backend/kai/config/kaiSprint2Config.js";
import { buildKaiError } from "../Backend/kai/errors/kaiErrors.js";
import { requireKaiSprint2Authenticated } from "../Backend/kai/middleware/kaiSprint2Authentication.js";
import {
  handleKaiSprint2JsonParserError,
  kaiSprint2MetadataJsonParser,
  setKaiSprint2NoStore,
} from "../Backend/kai/middleware/kaiSprint2RequestSafety.js";

const basePath = "/api/kai/sprint2/intake";
const routePath = "/admin/organizations/:organizationId/engagements/:engagementId/grant-response-packet/markdown";
const organizationId = "00000000-0000-4000-8000-000000000001";
const otherOrganizationId = "00000000-0000-4000-8000-000000000002";
const engagementId = "00000000-0000-4000-8000-000000000701";
const markdown = "# Grant Response Packet\n\nDelivery class: `PREVIEW_READ_ONLY`\n";
const actorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  source: "public.userdata",
  organizationMemberships: [
    { organization_id: organizationId, membership_status: "active", role_name: "gk_admin" },
  ],
});

function downloadPath(overrides = {}) {
  return `${basePath}/admin/organizations/${overrides.organizationId || organizationId}`
    + `/engagements/${overrides.engagementId || engagementId}/grant-response-packet/markdown`
    + (overrides.query || "");
}

function createScenario(overrides = {}) {
  return {
    authenticated: true,
    actorContext,
    serviceCalls: [],
    serviceResult: {
      ok: true,
      data: {
        markdownContractVersion: "kai-sprint2-grant-response-packet-markdown-preview-v1",
        deliveryClass: "PREVIEW_READ_ONLY",
        markdown,
      },
      error: null,
    },
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
  app.use(basePath, requireKaiSprint2Enabled, requireKaiSprint2Authenticated, sprint2IntakeApiRouter);
  return app;
}

async function listen(app) {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1");
    server.once("listening", () => resolve(server));
    server.once("error", reject);
  });
}

async function requestDownload(server, path) {
  const { port } = server.address();
  return await new Promise((resolve, reject) => {
    const request = http.request({
      hostname: "127.0.0.1",
      port,
      path,
      method: "GET",
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        statusCode: response.statusCode,
        headers: response.headers,
        bodyText: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.on("error", reject);
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

test("Grant Response Packet Markdown preview route appears as exactly one authenticated GET route", () => {
  const matches = sprint2IntakeApiRouter.stack
    .filter((layer) => layer.route?.path === routePath && layer.route?.methods?.get);
  assert.equal(matches.length, 1);
  assert.deepEqual(Object.keys(matches[0].route.methods), ["get"]);
});

test("authorized human request returns deterministic packet Markdown preview from organizationId + engagementId only", async (t) => {
  let scenario = createScenario();
  const restoreFeatureFlag = withFeatureFlagEnabled();
  const restoreService = intakeRouteTestables.setIntakeServiceForTest({
    async serializeGrantResponsePacketToMarkdown(input) {
      scenario.serviceCalls.push(input);
      return scenario.serviceResult;
    },
  });
  const app = createApplication(() => scenario);
  const server = await listen(app);

  t.after(async () => {
    restoreService();
    restoreFeatureFlag();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const response = await requestDownload(server, downloadPath());

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "text/markdown; charset=utf-8");
  assert.equal(response.headers["content-disposition"], 'attachment; filename="kai-grant-response-packet.md"');
  assert.equal(response.bodyText, markdown);
  assert.deepEqual(scenario.serviceCalls, [{
    organizationId,
    engagementId,
    actorContext,
  }]);
});

test("Grant Response Packet Markdown preview rejects query-selected membership and client-controlled filename before service", async (t) => {
  let scenario = createScenario();
  const restoreFeatureFlag = withFeatureFlagEnabled();
  const restoreService = intakeRouteTestables.setIntakeServiceForTest({
    async serializeGrantResponsePacketToMarkdown(input) {
      scenario.serviceCalls.push(input);
      return scenario.serviceResult;
    },
  });
  const app = createApplication(() => scenario);
  const server = await listen(app);

  t.after(async () => {
    restoreService();
    restoreFeatureFlag();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const response = await requestDownload(server, downloadPath({
    query: "?member_ids[]=00000000-0000-4000-8000-000000000911&filename=..%2Fsecret.md",
  }));

  assert.equal(response.statusCode, 422);
  assert.equal(JSON.parse(response.bodyText).error.code, "validation_blocker");
  assert.deepEqual(scenario.serviceCalls, []);
});

test("Grant Response Packet Markdown preview propagates service authority failures with no attachment", async (t) => {
  let scenario = createScenario();
  const restoreFeatureFlag = withFeatureFlagEnabled();
  const restoreService = intakeRouteTestables.setIntakeServiceForTest({
    async serializeGrantResponsePacketToMarkdown(input) {
      scenario.serviceCalls.push(input);
      return scenario.serviceResult;
    },
  });
  const app = createApplication(() => scenario);
  const server = await listen(app);

  t.after(async () => {
    restoreService();
    restoreFeatureFlag();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  for (const [code, statusCode] of [
    ["not_found", 404],
    ["authorization_denied", 403],
    ["feature_disabled", 403],
    ["tenant_boundary_violation", 403],
  ]) {
    scenario = createScenario({ serviceResult: buildKaiError(code, { data: null }) });
    const response = await requestDownload(server, downloadPath({
      organizationId: code === "not_found" ? otherOrganizationId : organizationId,
    }));
    assert.equal(response.statusCode, statusCode, code);
    assert.equal(JSON.parse(response.bodyText).error.code, code);
    assert.equal("content-disposition" in response.headers, false, code);
  }
});

test("Grant Response Packet Markdown preview route contains no SQL, mutation, finalization, or member-selection authority", () => {
  const routeSource = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
  const routeStart = routeSource.indexOf(`"${routePath}"`);
  assert.notEqual(routeStart, -1);
  // Bound the slice to exactly this route registration's own closing
  // "\n);\n" (the bare top-level router.get(...) call's close) rather than
  // the next unrelated function - this keeps the slice stable regardless of
  // what other routes are later added after this one in the file.
  const routeEnd = routeSource.indexOf("\n);\n", routeStart);
  assert.notEqual(routeEnd, -1);
  const routeSlice = routeSource.slice(routeStart, routeEnd);

  assert.match(routeSlice, /serializeGrantResponsePacketToMarkdown/);
  assert.doesNotMatch(routeSlice, /\b(?:SELECT|INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b|\bpool\b|\bkaiDb\b|\brepository\b|\bkai\.(?!js\b)/i);
  assert.doesNotMatch(routeSlice, /exportManifestId|exportCandidateId|memberIds|draftIds|latest|newest|preferred|LIMIT\s+1|ORDER BY/i);
  assert.doesNotMatch(routeSlice, /final-release|final release|createExportManifest|recordHumanFinalReleaseAuthorityDecision/i);
});
