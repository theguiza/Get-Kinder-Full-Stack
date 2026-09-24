import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { readFileSync } from "node:fs";

import accessAdministrationRouter, { __testables } from "../Backend/kai/routes/kaiAccessAdministrationApi.js";

const BASE_PATH = "/api/kai/sprint2/access-administration";
const ORG_A = "00000000-0000-4000-8000-0000000000aa";
const REQUEST_ID = "00000000-0000-4000-8000-000000000301";
const OTHER_USER = "90000000-0000-4000-8000-000000000009";
const routeSource = readFileSync("Backend/kai/routes/kaiAccessAdministrationApi.js", "utf8");
const indexSource = readFileSync("index.js", "utf8");
const actorContext = Object.freeze({ actorType: "human", actorUserId: "90000000-0000-4000-8000-000000000002", organizationMemberships: [] });

async function withServer({ authenticated = true, enabled = true, result } = {}, work) {
  const previous = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = enabled ? "true" : "false";
  const calls = [];
  const respond = (name) => async (input) => {
    calls.push([name, input]);
    return result || { ok: true, data: { items: [] }, error: null };
  };
  const restore = __testables.setAccessAdministrationServiceForTest({
    listPendingOrganizationJoinRequestsForReviewer: respond("list"),
    approveOrganizationJoinRequest: respond("approve"),
    declineOrganizationJoinRequest: respond("decline"),
  });
  const app = express();
  app.use(express.json());
  app.use(BASE_PATH, (req, res, next) => {
    req.isAuthenticated = () => authenticated;
    if (authenticated) {
      req.user = { id: 46 };
      req.kaiSprint2ActorContext = actorContext;
    }
    next();
  });
  app.use(BASE_PATH, accessAdministrationRouter);
  const server = await new Promise((resolve, reject) => {
    const listening = app.listen(0, "127.0.0.1");
    listening.once("listening", () => resolve(listening));
    listening.once("error", reject);
  });
  try {
    const { port } = server.address();
    const call = async (method, path, body) => {
      const response = await fetch(`http://127.0.0.1:${port}${BASE_PATH}${path}`, {
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

test("queue route forwards only the attached actor context and canonical organization id", async () => {
  await withServer({}, async (call, calls) => {
    assert.equal((await call("GET", `/organizations/${ORG_A}/join-requests?requester_user_id=${OTHER_USER}`)).status, 200);
    assert.deepEqual(calls[0], ["list", { actorContext, organizationId: ORG_A }]);
    assert.equal((await call("GET", `/organizations/${ORG_A.toUpperCase()}/join-requests`)).status, 422);
    assert.equal((await call("GET", "/organizations/not-a-uuid/join-requests")).status, 422);
    assert.equal(calls.length, 1);
  });
});

test("approve/decline routes accept no body fields; requester/reviewer/role/status can never be supplied", async () => {
  await withServer({}, async (call, calls) => {
    for (const decision of ["approve", "decline"]) {
      const path = `/organizations/${ORG_A}/join-requests/${REQUEST_ID}/${decision}`;
      assert.equal((await call("POST", path)).status, 200);
      assert.equal((await call("POST", path, {})).status, 200);
      for (const body of [
        { requester_user_id: OTHER_USER },
        { reviewer_user_id: OTHER_USER },
        { role_name: "client_admin" },
        { membership_status: "active" },
        { organization_id: ORG_A },
        [],
      ]) {
        assert.equal((await call("POST", path, body)).status, 422, `${decision} body ${JSON.stringify(body)} must be refused`);
      }
      assert.equal((await call("POST", `/organizations/${ORG_A}/join-requests/NOT-A-UUID/${decision}`)).status, 422);
    }
    assert.equal(calls.length, 4);
    const [name, input] = calls[0];
    assert.equal(name, "approve");
    assert.deepEqual(Object.keys(input).sort(), ["actorContext", "now", "organizationId", "organizationJoinRequestId"]);
    assert.equal(input.organizationJoinRequestId, REQUEST_ID);
    assert.equal(calls[2][0], "decline");
  });
});

test("routes surface service blockers and status codes", async () => {
  const result = {
    ok: false,
    data: null,
    error: { code: "membership_state_conflict" },
    blockers: [{ blocking_reason: "join_request_requester_already_authorized" }],
  };
  await withServer({ result }, async (call) => {
    const response = await call("POST", `/organizations/${ORG_A}/join-requests/${REQUEST_ID}/approve`);
    assert.equal(response.status, 409);
    assert.equal(response.body.blockers[0].blocking_reason, "join_request_requester_already_authorized");
  });
});

test("routes require authentication and KAI_SPRINT2_ENABLED", async () => {
  await withServer({ authenticated: false }, async (call, calls) => {
    assert.equal((await call("GET", `/organizations/${ORG_A}/join-requests`)).status, 401);
    assert.equal(calls.length, 0);
  });
  await withServer({ enabled: false }, async (call, calls) => {
    assert.equal((await call("POST", `/organizations/${ORG_A}/join-requests/${REQUEST_ID}/approve`)).status, 403);
    assert.equal(calls.length, 0);
  });
});

test("route source: reviewer operations live on the access-administration surface, service-backed, no SQL/DB helper", () => {
  assert.match(routeSource, /router\.get\("\/organizations\/:organizationId\/join-requests"/);
  assert.match(routeSource, /\/organizations\/:organizationId\/join-requests\/:organizationJoinRequestId\/\$\{decisionPath\}/);
  assert.match(routeSource, /from "\.\.\/services\/kaiOrganizationJoinRequestReviewService\.js"/);
  const routeCode = routeSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(routeCode, /\.query\(|\bpool\b|kaiDb\.js|db\/pg\.js|SELECT |INSERT |UPDATE |kai\.[a-z_]+/);
  assert.doesNotMatch(routeSource, /kaiOrganizationJoinRequestQueries/);
  assert.match(indexSource, /"\/api\/kai\/sprint2\/access-administration",\s*requireKaiSprint2Enabled,\s*requireKaiSprint2Authenticated,\s*kaiAccessAdministrationApiRouter/);
  const intakeRoutes = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
  assert.doesNotMatch(intakeRoutes, /approveOrganizationJoinRequest|declineOrganizationJoinRequest|join-requests\/:/);
});
