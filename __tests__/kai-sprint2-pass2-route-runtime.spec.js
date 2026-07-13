import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { requireKaiSprint2Enabled } from "../Backend/kai/config/kaiSprint2Config.js";
import router, { __testables as intakeRouteTestables } from "../Backend/kai/routes/sprint2IntakeApi.js";
import authPreflightRouter, { __testables as authPreflightTestables } from "../Backend/kai/routes/sprint2IntakeAuthPreflightApi.js";
import { ensureAuthenticatedApi } from "../middleware/auth.js";

function createResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return body;
    },
  };
}

function withKaiSprint2Flag(value, callback) {
  const original = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = value;
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      process.env.KAI_SPRINT2_ENABLED = original;
    });
}

function runFeatureGateBeforeAuth({ authenticated = false } = {}) {
  const res = createResponse();
  let authMiddlewareReached = false;

  requireKaiSprint2Enabled(
    {
      isAuthenticated() {
        return authenticated;
      },
    },
    res,
    () => {
      authMiddlewareReached = true;
    },
  );

  return { res, authMiddlewareReached };
}

function routeHandler(path, method) {
  const layer = router.stack.find((candidate) => candidate.route?.path === path && candidate.route?.methods?.[method]);
  assert.ok(layer, `${method.toUpperCase()} ${path} route exists`);
  return layer.route.stack[0].handle;
}

async function invokeRoute(path, method, req) {
  const res = createResponse();
  await routeHandler(path, method)(req, res);
  return res;
}

test("feature flag OFF returns 403 feature_disabled before Sprint 2 route execution", () => {
  const original = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "false";
  const res = createResponse();
  let nextCalled = false;

  requireKaiSprint2Enabled({}, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error.code, "feature_disabled");
  assert.equal(res.body.data, null);
  process.env.KAI_SPRINT2_ENABLED = original;
});

test("Pass 2 router exposes only metadata-intake admin surface", () => {
  const routePaths = new Set(router.stack.map((layer) => layer.route?.path).filter(Boolean));
  assert.deepEqual([...routePaths].sort(), [
    "/admin/access-check",
    "/admin/batches",
    "/admin/batches/:intakeBatchId/file-reservations",
    "/status",
  ]);
});

test("admin batch list route delegates sanitized query scope with no direct database behavior", async () => {
  let serviceInput = null;
  const restore = intakeRouteTestables.setIntakeServiceForTest({
    async listIntakeBatchesForOrganization(input) {
      serviceInput = input;
      return {
        ok: true,
        data: { organization_id: "org-1", batches: [] },
        warnings: [],
      };
    },
  });

  try {
    const originalReq = {
      query: { organization_id: "org-1" },
      headers: { cookie: "session=secret-cookie-sentinel" },
      cookies: { session: "secret-cookie-sentinel" },
      session: { id: "session-value-sentinel" },
      user: {
        id: 46,
        email: "email-sentinel@example.test",
        token: "secret-token-sentinel",
      },
    };

    const res = await invokeRoute("/admin/batches", "get", originalReq);

    assert.equal(res.statusCode, 200);
    assert.equal(serviceInput.organizationId, "org-1");
    assert.equal(serviceInput.route, "/api/kai/sprint2/intake/admin/batches");
    assert.notEqual(serviceInput.req, originalReq);
    assert.deepEqual(serviceInput.req, { user: { id: 46 } });
    assert.deepEqual(serviceInput.payload, {});
    assert.equal("headers" in serviceInput, false);
    assert.equal("cookies" in serviceInput, false);
    assert.equal("session" in serviceInput, false);
    assert.deepEqual(res.body, {
      ok: true,
      data: { organization_id: "org-1", batches: [] },
      warnings: [],
    });

    const routeSource = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
    assert.doesNotMatch(routeSource, /from ["']\.\.\/db\//);
    assert.doesNotMatch(routeSource, /\b(?:pool|db)\.query\s*\(/);
    assert.doesNotMatch(routeSource, /\b(?:SELECT|INSERT|UPDATE|DELETE)\b/i);
  } finally {
    restore();
  }
});

test("admin access route delegates to checkAdminAccess with sanitized request context", async () => {
  let serviceInput = null;
  const restore = intakeRouteTestables.setIntakeServiceForTest({
    async checkAdminAccess(input) {
      serviceInput = input;
      return { ok: true, data: { metadata_only: true }, warnings: [] };
    },
  });

  try {
    const originalReq = {
      query: {
        organization_id: "org-1",
        engagement_id: "eng-1",
      },
      headers: { cookie: "session=secret-cookie-sentinel" },
      cookies: { session: "secret-cookie-sentinel" },
      session: { id: "session-value-sentinel" },
      user: {
        id: 46,
        email: "email-sentinel@example.test",
        firstname: "First",
        lastname: "Last",
        token: "secret-token-sentinel",
      },
    };

    const res = await invokeRoute("/admin/access-check", "get", originalReq);

    assert.equal(res.statusCode, 200);
    assert.equal(serviceInput.organizationId, "org-1");
    assert.equal(serviceInput.engagementId, "eng-1");
    assert.notEqual(serviceInput.req, originalReq);
    assert.deepEqual(serviceInput.req, {
      user: {
        id: 46,
      },
    });
    assert.equal("headers" in serviceInput, false);
    assert.equal("cookies" in serviceInput, false);
    assert.equal("session" in serviceInput, false);
  } finally {
    restore();
  }
});

test("admin batch route delegates to createIntakeBatch without direct DB access", async () => {
  let serviceInput = null;
  const restore = intakeRouteTestables.setIntakeServiceForTest({
    async createIntakeBatch(input) {
      serviceInput = input;
      return { ok: true, data: { intake_batch_id: "batch-1", metadata_only: true }, warnings: [] };
    },
  });

  try {
    const res = await invokeRoute("/admin/batches", "post", {
      user: { id: 46, email: "email-sentinel@example.test" },
      body: {
        organization_id: "org-1",
        engagement_id: "eng-1",
        batch_code: "BATCH-001",
        idempotency_key: "idem-1",
        source_system_name: "synthetic",
        notes: "metadata only",
      },
    });

    assert.equal(res.statusCode, 201);
    assert.equal(serviceInput.organizationId, "org-1");
    assert.equal(serviceInput.engagementId, "eng-1");
    assert.equal(serviceInput.batchCode, "BATCH-001");
    assert.equal(serviceInput.idempotencyKey, "idem-1");
    assert.equal(serviceInput.route, "/api/kai/sprint2/intake/admin/batches");
  } finally {
    restore();
  }
});

test("file reservation route rejects multipart before service and otherwise delegates metadata only", async () => {
  let serviceCalls = 0;
  let serviceInput = null;
  const restore = intakeRouteTestables.setIntakeServiceForTest({
    async reserveIntakeFileMetadata(input) {
      serviceCalls += 1;
      serviceInput = input;
      return { ok: true, data: { intake_file_id: "file-1", metadata_only: true }, warnings: [] };
    },
  });

  try {
    const multipart = await invokeRoute("/admin/batches/:intakeBatchId/file-reservations", "post", {
      is(contentType) {
        return contentType === "multipart/form-data";
      },
      params: { intakeBatchId: "batch-1" },
      user: { id: 46, email: "email-sentinel@example.test" },
      body: { organization_id: "org-1" },
    });

    assert.equal(multipart.statusCode, 400);
    assert.equal(multipart.body.error.code, "invalid_request");
    assert.equal(serviceCalls, 0);

    const metadataOnly = await invokeRoute("/admin/batches/:intakeBatchId/file-reservations", "post", {
      is() {
        return false;
      },
      params: { intakeBatchId: "batch-1" },
      user: { id: 46, email: "email-sentinel@example.test" },
      body: {
        organization_id: "org-1",
        engagement_id: "eng-1",
        original_filename: "safe.csv",
        mime_type: "text/csv",
        checksum: "sha256abc",
      },
    });

    assert.equal(metadataOnly.statusCode, 201);
    assert.equal(serviceCalls, 1);
    assert.equal(serviceInput.intakeBatchId, "batch-1");
    assert.equal(serviceInput.originalFilename, "safe.csv");
    assert.equal(serviceInput.mimeType, "text/csv");
    assert.equal(serviceInput.route, "/api/kai/sprint2/intake/admin/batches/:intakeBatchId/file-reservations");
  } finally {
    restore();
  }
});

test("auth preflight router exposes only the no-write preflight surface", () => {
  const routePaths = authPreflightRouter.stack.map((layer) => layer.route?.path).filter(Boolean);
  assert.deepEqual(routePaths, ["/"]);
});

test("auth preflight route returns only sanitized booleans", () => {
  const res = createResponse();

  authPreflightTestables.sendAuthPreflight(
    {
      isAuthenticated() {
        return true;
      },
      user: {
        id: 123,
        email: "should-not-appear@example.test",
        roles: ["admin"],
      },
    },
    res,
  );

  assert.equal(res.statusCode, null);
  assert.deepEqual(res.body, {
    ok: true,
    data: {
      authenticated: true,
      session_authenticated: true,
      feature_flag_required: false,
    },
    blockers: [],
    warnings: [],
  });

  const serialized = JSON.stringify(res.body);
  for (const forbidden of ["id", "email", "role", "user", "cookie", "token", "session_id", "secret"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("missing auth reaches existing API auth middleware 401 behavior", async () => {
  const res = createResponse();
  let nextCalled = false;

  await ensureAuthenticatedApi(
    {
      get() {
        return null;
      },
      isAuthenticated() {
        return false;
      },
    },
    res,
    () => {
      nextCalled = true;
    },
  );

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: "unauthorized" });
});

test("auth preflight is exact-route mounted before the Sprint 2 feature flag gate", () => {
  const index = readFileSync("index.js", "utf8");
  const preflightMount = [
    "app.use(",
    '  "/api/kai/sprint2/intake/auth-preflight",',
    "  ensureAuthenticatedApi,",
    "  sprint2IntakeAuthPreflightApiRouter",
  ].join("\n");
  const unsafeBroadMount = 'app.use("/api/kai/sprint2/intake", ensureAuthenticatedApi, sprint2IntakeAuthPreflightApiRouter)';
  const gatedMount = [
    'app.use(',
    '  "/api/kai/sprint2/intake",',
    '  requireKaiSprint2Enabled,',
    '  ensureAuthenticatedApi,',
    '  sprint2IntakeApiRouter',
  ].join("\n");

  assert.match(index, /import sprint2IntakeAuthPreflightApiRouter from "\.\/Backend\/kai\/routes\/sprint2IntakeAuthPreflightApi\.js";/);
  assert.ok(index.includes(preflightMount));
  assert.equal(index.includes(unsafeBroadMount), false);
  assert.ok(index.includes(gatedMount));
  assert.ok(index.indexOf(preflightMount) < index.indexOf(gatedMount));
});

test("feature-OFF status returns 403 feature_disabled before auth without a session", async () => {
  await withKaiSprint2Flag("false", async () => {
    const { res, authMiddlewareReached } = runFeatureGateBeforeAuth({ authenticated: false });

    assert.equal(authMiddlewareReached, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error.code, "feature_disabled");
    assert.equal(res.body.data, null);
  });
});

test("feature-OFF status returns 403 feature_disabled before auth with a valid session", async () => {
  await withKaiSprint2Flag("false", async () => {
    const { res, authMiddlewareReached } = runFeatureGateBeforeAuth({ authenticated: true });

    assert.equal(authMiddlewareReached, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error.code, "feature_disabled");
    assert.equal(res.body.data, null);
  });
});

test("auth preflight missing auth returns existing API auth middleware 401", async () => {
  await withKaiSprint2Flag("false", async () => {
    const res = createResponse();
    let nextCalled = false;

    await ensureAuthenticatedApi(
      {
        get() {
          return null;
        },
        isAuthenticated() {
          return false;
        },
      },
      res,
      () => {
        nextCalled = true;
      },
    );

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { error: "unauthorized" });
  });
});

test("auth preflight valid auth returns sanitized preflight response", async () => {
  await withKaiSprint2Flag("false", async () => {
    const req = {
      isAuthenticated() {
        return true;
      },
      user: {
        id: 123,
        email: "should-not-appear@example.test",
        roles: ["admin"],
      },
    };
    const res = createResponse();
    let nextCalled = false;

    await ensureAuthenticatedApi(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
    authPreflightTestables.sendAuthPreflight(req, res);

    assert.equal(res.statusCode, null);
    assert.deepEqual(res.body, {
      ok: true,
      data: {
        authenticated: true,
        session_authenticated: true,
        feature_flag_required: false,
      },
      blockers: [],
      warnings: [],
    });
  });
});

test("auth preflight middleware does not intercept sibling Sprint 2 intake routes", async () => {
  await withKaiSprint2Flag("false", async () => {
    const siblingRoutes = [
      { method: "GET", path: "/api/kai/sprint2/intake/status" },
      { method: "GET", path: "/api/kai/sprint2/intake/admin/access-check" },
      { method: "GET", path: "/api/kai/sprint2/intake/admin/batches?organization_id=org-1" },
      { method: "POST", path: "/api/kai/sprint2/intake/admin/batches" },
      {
        method: "POST",
        path: "/api/kai/sprint2/intake/admin/batches/batch-123/file-reservations",
      },
    ];

    for (const route of siblingRoutes) {
      const { res, authMiddlewareReached } = runFeatureGateBeforeAuth({ authenticated: false });
      assert.equal(authMiddlewareReached, false, `${route.method} ${route.path}`);
      assert.equal(res.statusCode, 403, `${route.method} ${route.path}`);
      assert.equal(res.body.error.code, "feature_disabled", `${route.method} ${route.path}`);
      assert.equal(res.body.data, null, `${route.method} ${route.path}`);
    }
  });
});

test("auth preflight route does not import or call Sprint 2 gate or intake services", () => {
  const route = readFileSync("Backend/kai/routes/sprint2IntakeAuthPreflightApi.js", "utf8");

  assert.doesNotMatch(route, /requireKaiSprint2Enabled/);
  assert.doesNotMatch(route, /kaiIntakeService|kaiIntakeQueries|kaiQueries|kaiDb|pool\.query/);
});
