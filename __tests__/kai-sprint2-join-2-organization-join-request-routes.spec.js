import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { readFileSync } from "node:fs";

import sprint2IntakeApiRouter, { __testables as intakeRouteTestables } from "../Backend/kai/routes/sprint2IntakeApi.js";
import { requireKaiSprint2Enabled } from "../Backend/kai/config/kaiSprint2Config.js";
import { requireKaiSprint2Authenticated } from "../Backend/kai/middleware/kaiSprint2Authentication.js";
import {
  handleKaiSprint2JsonParserError,
  kaiSprint2MetadataJsonParser,
  setKaiSprint2NoStore,
} from "../Backend/kai/middleware/kaiSprint2RequestSafety.js";

const basePath = "/api/kai/sprint2/intake";
const ORG_TARGET = "00000000-0000-4000-8000-0000000000aa";
const OTHER_USER = "90000000-0000-4000-8000-000000000002";
const routeSource = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");

function createApplication(scenario) {
  const app = express();
  app.use(basePath, setKaiSprint2NoStore, requireKaiSprint2Enabled, kaiSprint2MetadataJsonParser);
  app.use(basePath, handleKaiSprint2JsonParserError);
  app.use(basePath, (req, res, next) => {
    req.isAuthenticated = () => scenario.authenticated;
    if (scenario.authenticated) req.user = { id: 46, email: "user@example.test", role: "admin" };
    return next();
  });
  app.use(basePath, requireKaiSprint2Enabled, requireKaiSprint2Authenticated, sprint2IntakeApiRouter);
  return app;
}

async function withServer(scenario, work) {
  const previous = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = scenario.enabled === false ? "false" : "true";
  const calls = [];
  const result = (name) => scenario.results?.[name] || { ok: true, data: { items: [] }, error: null };
  const restore = intakeRouteTestables.setIntakeServiceForTest({
    async searchJoinableOrganizations(input) {
      calls.push(["search", input]);
      return result("search");
    },
    async submitOrganizationJoinRequest(input) {
      calls.push(["submit", input]);
      return result("submit");
    },
    async listMyOrganizationJoinRequests(input) {
      calls.push(["mine", input]);
      return result("mine");
    },
  });
  const server = await new Promise((resolve, reject) => {
    const listening = createApplication({ authenticated: true, ...scenario }).listen(0, "127.0.0.1");
    listening.once("listening", () => resolve(listening));
    listening.once("error", reject);
  });
  try {
    const { port } = server.address();
    const call = async (method, path, body) => {
      const response = await fetch(`http://127.0.0.1:${port}${basePath}${path}`, {
        method,
        headers: body === undefined ? {} : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json().catch(() => null) };
    };
    await work(call, calls);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    restore();
    if (previous === undefined) delete process.env.KAI_SPRINT2_ENABLED;
    else process.env.KAI_SPRINT2_ENABLED = previous;
  }
}

test("discovery route forwards only the q term and the authenticated user id", async () => {
  await withServer({}, async (call, calls) => {
    const response = await call("GET", `/admin/organization-join/organizations?q=Target&user_id=${OTHER_USER}&limit=500`);
    assert.equal(response.status, 200);
    assert.deepEqual(calls[0], ["search", { searchTerm: "Target", req: { user: { id: 46 } } }]);
    const noTerm = await call("GET", "/admin/organization-join/organizations?q[]=a");
    assert.equal(noTerm.status, 200);
    assert.equal(calls[1][1].searchTerm, "");
  });
});

test("submit route accepts only organization_id; requester/role fields are rejected before the service", async () => {
  await withServer({ results: { submit: { ok: true, data: { outcome: "created" }, error: null } } }, async (call, calls) => {
    const created = await call("POST", "/admin/organization-join/requests", { organization_id: ORG_TARGET });
    assert.equal(created.status, 200);
    assert.deepEqual(calls[0], ["submit", { organizationId: ORG_TARGET, req: { user: { id: 46 } } }]);

    for (const body of [
      { organization_id: ORG_TARGET, requester_user_id: OTHER_USER },
      { organization_id: ORG_TARGET, user_id: OTHER_USER },
      { organization_id: ORG_TARGET, role_name: "client_admin" },
      { organization_id: ORG_TARGET, requested_role: "client_reviewer" },
      { organization_id: "not-a-uuid" },
    ]) {
      const refused = await call("POST", "/admin/organization-join/requests", body);
      assert.equal(refused.status, 400, `body ${JSON.stringify(body)} must be refused`);
    }
    assert.equal(calls.length, 1);
  });
});

test("submit route surfaces structured blockers from the service", async () => {
  const blocked = {
    ok: false,
    error: { code: "membership_state_conflict", message: "An organization administrator must review your existing membership.", status: 409 },
    blockers: [{
      validator_key: "VAL-KAI-ORG-JOIN-001",
      object_type: "organization_join_request",
      object_code: "organization_id",
      blocking_reason: "join_request_administrator_action_required",
      message: "An organization administrator must review your existing membership.",
      required_fix: "Contact an administrator of this organization to restore your access.",
    }],
  };
  await withServer({ results: { submit: blocked } }, async (call) => {
    const response = await call("POST", "/admin/organization-join/requests", { organization_id: ORG_TARGET });
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, "membership_state_conflict");
    assert.equal(response.body.blockers[0].blocking_reason, "join_request_administrator_action_required");
  });
});

test("my-requests route forwards no query/body identity", async () => {
  await withServer({}, async (call, calls) => {
    const response = await call("GET", `/admin/organization-join/requests/mine?requester_user_id=${OTHER_USER}`);
    assert.equal(response.status, 200);
    assert.deepEqual(calls[0], ["mine", { req: { user: { id: 46 } } }]);
  });
});

test("routes require authentication and KAI_SPRINT2_ENABLED", async () => {
  await withServer({ authenticated: false }, async (call, calls) => {
    assert.equal((await call("GET", "/admin/organization-join/requests/mine")).status, 401);
    assert.equal(calls.length, 0);
  });
  await withServer({ enabled: false }, async (call, calls) => {
    assert.equal((await call("GET", "/admin/organization-join/organizations?q=ab")).status, 403);
    assert.equal(calls.length, 0);
  });
});

test("route source: no SQL, no admin role gate, identity only from safeAuthenticatedUser", () => {
  const start = routeSource.indexOf('router.get("/admin/organization-join/organizations"');
  const end = routeSource.indexOf('router.get("/admin/organization-join/requests/mine"');
  assert.ok(start > -1 && end > start);
  const slice = routeSource.slice(start, routeSource.indexOf("});\n", end) + 4);
  assert.doesNotMatch(slice, /SELECT|INSERT|UPDATE|DELETE|kai\.|pool|\.query\(/);
  assert.doesNotMatch(slice, /ensureAdmin|client_admin|gk_admin|requireKaiAccessAdministration|allowedRoles/);
  assert.doesNotMatch(slice, /req\.params|user_id|role/);
  assert.equal((slice.match(/req: \{ user: safeAuthenticatedUser\(req\) \}/g) || []).length, 3);
});
