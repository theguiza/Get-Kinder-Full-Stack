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
import { serializeExportManifestToPdf } from "../Backend/kai/services/kaiExportManifestPdfSerializer.js";

const basePath = "/api/kai/sprint2/intake";
const routePath = "/admin/organizations/:organizationId/export-manifests/:exportManifestId/pdf";
const organizationId = "00000000-0000-4000-8000-000000000001";
const otherOrganizationId = "00000000-0000-4000-8000-000000000002";
const exportManifestId = "00000000-0000-4000-8000-000000000601";
const pdfBytes = Buffer.from("%PDF-1.7\n%stub-pdf-body\n%%EOF", "latin1");
const enabledEnv = Object.freeze({
  KAI_SPRINT2_ENABLED: "true",
  KAI_GENERATION_ENABLED: "true",
  KAI_PUBLIC_EXPORT_ENABLED: "true",
});
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
    + `/export-manifests/${overrides.exportManifestId || exportManifestId}/pdf`
    + (overrides.query || "");
}

function createScenario(overrides = {}) {
  return {
    authenticated: true,
    actorContext,
    serviceCalls: [],
    serviceResult: { ok: true, data: { pdfContractVersion: "kai-sprint2-export-manifest-pdf-v1", pdf: pdfBytes }, error: null },
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
        bodyBuffer: Buffer.concat(chunks),
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

test("authorized PDF export delivery route appears as exactly one authenticated GET route", () => {
  const matches = sprint2IntakeApiRouter.stack
    .filter((layer) => layer.route?.path === routePath && layer.route?.methods?.get);
  assert.equal(matches.length, 1);
  assert.deepEqual(Object.keys(matches[0].route.methods), ["get"]);
});

test("authorized human request returns the exact governed PDF bytes as an attachment", async (t) => {
  let scenario = createScenario();
  const restoreFeatureFlag = withFeatureFlagEnabled();
  const restoreService = intakeRouteTestables.setIntakeServiceForTest({
    async serializeExportManifestToPdf(input) {
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
  assert.equal(response.headers["content-type"], "application/pdf");
  assert.equal(response.headers["content-disposition"], 'attachment; filename="kai-export-manifest.pdf"');
  assert.equal(response.bodyBuffer.equals(pdfBytes), true);
  assert.deepEqual(scenario.serviceCalls, [{
    organizationId,
    exportManifestId,
    actorContext,
  }]);
});

test("client-controlled filename or path material cannot enter the attachment filename", async (t) => {
  let scenario = createScenario();
  const restoreFeatureFlag = withFeatureFlagEnabled();
  const restoreService = intakeRouteTestables.setIntakeServiceForTest({
    async serializeExportManifestToPdf(input) {
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
    query: "?filename=..%2F..%2Fsecret.pdf&original_filename=client.pdf",
  }));

  assert.equal(response.statusCode, 200);
  const disposition = response.headers["content-disposition"];
  assert.equal(disposition, 'attachment; filename="kai-export-manifest.pdf"');
  assert.equal(disposition.includes(".."), false);
  assert.equal(disposition.includes("/"), false);
  assert.equal(disposition.includes("\\"), false);
  assert.equal(disposition.includes("secret"), false);
  assert.equal(disposition.includes("client"), false);
  assert.equal(disposition.includes(exportManifestId), false);
});

test("upstream failures propagate through the existing KAI API error convention with no attachment", async (t) => {
  let scenario = createScenario();
  const restoreFeatureFlag = withFeatureFlagEnabled();
  const restoreService = intakeRouteTestables.setIntakeServiceForTest({
    async serializeExportManifestToPdf(input) {
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
    ["conflict_current_state_changed", 409],
  ]) {
    scenario = createScenario({ serviceResult: buildKaiError(code, { data: null }) });
    const response = await requestDownload(server, downloadPath({
      organizationId: code === "not_found" ? otherOrganizationId : organizationId,
    }));
    assert.equal(response.statusCode, statusCode, code);
    assert.equal(JSON.parse(response.bodyBuffer.toString("utf8")).error.code, code);
    assert.equal("content-disposition" in response.headers, false, code);
    assert.notEqual(response.headers["content-type"], "application/pdf", code);
  }
});

test("authentication failure and malformed identifiers do not call the PDF service", async (t) => {
  let scenario = createScenario({ authenticated: false });
  const restoreFeatureFlag = withFeatureFlagEnabled();
  const restoreService = intakeRouteTestables.setIntakeServiceForTest({
    async serializeExportManifestToPdf(input) {
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

  const unauthorized = await requestDownload(server, downloadPath());
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(JSON.parse(unauthorized.bodyBuffer.toString("utf8")).error.code, "unauthorized");
  assert.deepEqual(scenario.serviceCalls, []);

  scenario = createScenario();
  const invalid = await requestDownload(server, downloadPath({ exportManifestId: "00000000-0000-4000-8000-000000000601X" }));
  assert.equal(invalid.statusCode, 422);
  assert.equal(JSON.parse(invalid.bodyBuffer.toString("utf8")).error.code, "validation_blocker");
  assert.deepEqual(scenario.serviceCalls, []);
});

test("AI/system actors are denied by the existing governed PDF wrapper before rendering", async () => {
  let renderCalls = 0;
  const result = await serializeExportManifestToPdf(
    { organizationId, exportManifestId, actorContext: { actorType: "system", actorUserId: "svc" } },
    {
      renderModelDependencies: {
        env: enabledEnv,
        repository: { async composeExportManifestRenderModel() { renderCalls += 1; throw new Error("must not render"); } },
      },
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
  assert.equal(renderCalls, 0);
});

test("route helper sends no attachment on malformed service success", () => {
  const headers = {};
  const res = {
    statusCode: null,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    send(body) { this.body = body; return this; },
    json(body) { this.body = body; return this; },
  };
  intakeRouteTestables.sendPdfAttachment(res, { ok: true, data: { pdfContractVersion: "v1" }, error: null });
  assert.equal(res.statusCode, 500);
  assert.equal(headers["content-disposition"], undefined);
});

test("route and package sources contain no SQL, direct KAI DB-helper access, artifact persistence, or storage download framework", () => {
  const routeSource = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
  const routeStart = routeSource.indexOf('"/admin/organizations/:organizationId/export-manifests/:exportManifestId/pdf"');
  const routeEnd = routeSource.indexOf('router.get(\n  "/admin/organizations/:organizationId/generated-content-drafts/:generatedContentDraftId/export-review-queue/:exportReviewQueueItemId/packet"');
  const routeSlice = routeSource.slice(routeStart, routeEnd);
  assert.match(routeSlice, /serializeExportManifestToPdf/);
  assert.doesNotMatch(routeSlice, /\b(?:SELECT|INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b|\bpool\b|\bkaiDb\b|\bkaiQueries\b|\bkai\./i);
  assert.doesNotMatch(routeSlice, /export_artifacts|artifact_id|storageKey|storagePath|signedUrl|downloadUrl|writeFile|createWriteStream|object storage/i);

  const allSources = [
    routeSource,
    readFileSync("Backend/kai/services/kaiExportManifestPdfSerializer.js", "utf8"),
    readFileSync("Backend/kai/services/kaiExportManifestRenderModelService.js", "utf8"),
  ].join("\n");
  assert.doesNotMatch(allSources, /export_artifacts|artifact table|artifact schema|signed URL|object storage|storage key|storage path/i);
});
