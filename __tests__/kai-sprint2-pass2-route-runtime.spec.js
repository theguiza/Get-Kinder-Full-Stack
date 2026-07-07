import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { requireKaiSprint2Enabled } from "../Backend/kai/config/kaiSprint2Config.js";
import router from "../Backend/kai/routes/sprint2IntakeApi.js";
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
  const routePaths = router.stack.map((layer) => layer.route?.path).filter(Boolean);
  assert.deepEqual(routePaths.sort(), [
    "/admin/access-check",
    "/admin/batches",
    "/admin/batches/:intakeBatchId/file-reservations",
    "/status",
  ]);
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
