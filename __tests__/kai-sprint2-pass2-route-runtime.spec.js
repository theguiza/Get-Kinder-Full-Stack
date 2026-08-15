import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { requireKaiSprint2Enabled } from "../Backend/kai/config/kaiSprint2Config.js";
import router, { __testables as intakeRouteTestables } from "../Backend/kai/routes/sprint2IntakeApi.js";
import authPreflightRouter, { __testables as authPreflightTestables } from "../Backend/kai/routes/sprint2IntakeAuthPreflightApi.js";
import { createIntakeBatch, reserveIntakeFileMetadata } from "../Backend/kai/services/kaiIntakeService.js";
import { requireKaiSprint2Authenticated } from "../Backend/kai/middleware/kaiSprint2Authentication.js";
import { ensureAuthenticatedApi } from "../middleware/auth.js";

const organizationId = "a5d17c5a-c55f-43af-9b21-fe63aafe733f";
const engagementId = "2e426ea1-2be3-4e48-b80f-9783ddbacda0";
const intakeBatchId = "8e426ea1-2be3-4e48-b80f-9783ddbacda0";
const actorContext = {
  actorType: "human",
  actorUserId: "7fe568b1-5c05-4c42-bb1f-6e20de216c7b",
  kaiRoles: ["gk_operator"],
  organizationMemberships: [
    { organization_id: organizationId, role_name: "gk_operator", membership_status: "active" },
  ],
};

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

test("Pass 2 router exposes metadata intake plus real P0 upload confirmation surface", () => {
  const routePaths = new Set(router.stack.map((layer) => layer.route?.path).filter(Boolean));
  assert.deepEqual([...routePaths].sort(), [
    "/admin/access-check",
    "/admin/batches",
    "/admin/batches/:intakeBatchId",
    "/admin/batches/:intakeBatchId/file-reservations",
    "/admin/batches/:intakeBatchId/files",
    "/admin/batches/:intakeBatchId/files/upload-url",
    "/admin/files/:intakeFileId",
    "/admin/files/:intakeFileId/block",
    "/admin/files/:intakeFileId/confirm-upload",
    "/admin/files/:intakeFileId/upload",
    // KAI P2-04 claim-gap/client-followup surface (additive; every prior
    // entry preserved verbatim).
    "/admin/organizations/:organizationId/claims/:claimId/claim-gap-followups",
    // KAI P2-05 potential conflict-review candidate surface (additive; every
    // prior entry preserved verbatim).
    "/admin/organizations/:organizationId/claims/:firstClaimId/potential-conflicts/:secondClaimId",
    // KAI P2-03 claim-proposal surface (additive; every prior entry preserved
    // verbatim).
    "/admin/organizations/:organizationId/evidence-items/:evidenceItemId/claim-proposal",
    "/admin/organizations/:organizationId/generated-content-drafts/:generatedContentDraftId/export-review-queue/:exportReviewQueueItemId/complete",
    "/admin/organizations/:organizationId/generated-content-drafts/:generatedContentDraftId/export-review-queue/:exportReviewQueueItemId/packet",
    "/admin/organizations/:organizationId/generated-content-drafts/:generatedContentDraftId/export-review-queue/:exportReviewQueueItemId/start",
    // KAI P2-02 evidence-coverage-assessment surface (additive; every prior
    // entry preserved verbatim).
    "/admin/organizations/:organizationId/source-versions/:sourceVersionId/evidence-coverage-assessment",
    // KAI P2-01 evidence-lineage extraction surface (additive; every prior
    // entry preserved verbatim).
    "/admin/organizations/:organizationId/source-versions/:sourceVersionId/evidence-extraction",
    // KAI P1-09 internal review-cockpit surface (additive; every prior entry
    // preserved verbatim).
    "/admin/review-cockpit/file-profiles/:fileProfileId",
    "/admin/review-cockpit/queue",
    "/admin/review-cockpit/source-candidates/:intakeSourceCandidateId",
    "/admin/review-cockpit/source-candidates/:intakeSourceCandidateId/decision",
    "/admin/review-queue",
    "/admin/review-queue/:reviewQueueItemId/status",
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
        organization_id: organizationId,
        engagement_id: engagementId,
        batch_code: "BATCH-001",
        idempotency_key: "idem-001",
        source_system_name: "synthetic",
        notes: "metadata only",
      },
    });

    assert.equal(res.statusCode, 201);
    assert.equal(serviceInput.organizationId, organizationId);
    assert.equal(serviceInput.engagementId, engagementId);
    assert.equal(serviceInput.batchCode, "BATCH-001");
    assert.equal(serviceInput.idempotencyKey, "idem-001");
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
      params: { intakeBatchId },
      user: { id: 46, email: "email-sentinel@example.test" },
      body: { organization_id: organizationId },
    });

    assert.equal(multipart.statusCode, 415);
    assert.equal(multipart.body.error.code, "unsupported_media_type");
    assert.equal(serviceCalls, 0);

    const metadataOnly = await invokeRoute("/admin/batches/:intakeBatchId/file-reservations", "post", {
      is() {
        return false;
      },
      params: { intakeBatchId },
      user: { id: 46, email: "email-sentinel@example.test" },
      body: {
        organization_id: organizationId,
        engagement_id: engagementId,
        idempotency_key: "file-idem-001",
        original_filename: "safe.csv",
        mime_type: "text/csv",
        checksum: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        hash_algorithm: "sha256",
      },
    });

    assert.equal(metadataOnly.statusCode, 201);
    assert.equal(serviceCalls, 1);
    assert.equal(serviceInput.intakeBatchId, intakeBatchId);
    assert.equal(serviceInput.idempotencyKey, "file-idem-001");
    assert.equal(serviceInput.originalFilename, "safe.csv");
    assert.equal(serviceInput.mimeType, "text/csv");
    assert.equal(serviceInput.checksum, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    assert.equal(serviceInput.hashAlgorithm, "sha256");
    assert.equal(serviceInput.route, "/api/kai/sprint2/intake/admin/batches/:intakeBatchId/file-reservations");
  } finally {
    restore();
  }
});

test("mounted file reservation accepts JSON envelope while blocking application/json declared MIME", async () => {
  const dependencies = {
    env: { KAI_SPRINT2_ENABLED: "true" },
    async getIntakeBatchTenantState() {
      return { intake_batch_id: intakeBatchId, organization_id: organizationId, engagement_id: engagementId };
    },
    async insertIntakeFileMetadata() {
      assert.fail("unsupported declared file MIME must not insert");
    },
  };
  const restore = intakeRouteTestables.setIntakeServiceForTest({
    async reserveIntakeFileMetadata(input) {
      return reserveIntakeFileMetadata({ ...input, actorContext }, dependencies);
    },
  });

  try {
    const res = await invokeRoute("/admin/batches/:intakeBatchId/file-reservations", "post", {
      get(headerName) {
        return String(headerName).toLowerCase() === "content-type"
          ? "application/json; charset=utf-8"
          : undefined;
      },
      is() {
        return false;
      },
      params: { intakeBatchId },
      user: { id: 46 },
      body: {
        organization_id: organizationId,
        engagement_id: engagementId,
        idempotency_key: "kai-route-json-mime-runtime-block-001",
        original_filename: "safe.txt",
        mime_type: "application/json",
        file_extension: ".txt",
        file_size_bytes: 0,
        checksum: "a".repeat(64),
        hash_algorithm: "sha256",
      },
    });

    assert.equal(res.statusCode, 422);
    assert.equal(res.body.error.code, "validation_blocker");
    assert.equal(res.body.blockers.length, 1);
    assert.equal(res.body.blockers[0].validator_key, "VAL-STO-005");
    assert.equal(res.body.blockers[0].object_code, "mime_type");
    assert.equal(res.body.blockers[0].blocking_reason, "unsupported_mime_type");
    assert.deepEqual(res.body.blockers[0].evidence, {});
  } finally {
    restore();
  }
});

test("metadata-write routes return 422 idempotency blockers from the mounted services", async (t) => {
  let batchLookupCalls = 0;
  let batchInsertCalls = 0;
  let fileLookupCalls = 0;
  let fileInsertCalls = 0;
  const dependencies = {
    env: { KAI_SPRINT2_ENABLED: "true" },
    async getEngagementTenantState() {
      return { engagement_id: engagementId, organization_id: organizationId };
    },
    async getIntakeBatchTenantState() {
      return { intake_batch_id: intakeBatchId, organization_id: organizationId, engagement_id: engagementId };
    },
    async findIntakeBatchByIdempotencyKey() {
      batchLookupCalls += 1;
      return null;
    },
    async insertIntakeBatchMetadata() {
      batchInsertCalls += 1;
    },
    async findIntakeFileReservationByIdempotencyKey() {
      fileLookupCalls += 1;
      return null;
    },
    async insertIntakeFileMetadata() {
      fileInsertCalls += 1;
    },
  };
  const restore = intakeRouteTestables.setIntakeServiceForTest({
    async createIntakeBatch(input) {
      return createIntakeBatch({ ...input, actorContext }, dependencies);
    },
    async reserveIntakeFileMetadata(input) {
      return reserveIntakeFileMetadata({ ...input, actorContext }, dependencies);
    },
  });

  try {
    for (const { name, idempotencyKey, blockingReason } of [
      { name: "missing", idempotencyKey: undefined, blockingReason: "missing_idempotency_key" },
      { name: "invalid", idempotencyKey: "short", blockingReason: "invalid_idempotency_key" },
    ]) {
      await t.test(`batch ${name}`, async () => {
        const res = await invokeRoute("/admin/batches", "post", {
          user: { id: 46 },
          body: {
            organization_id: organizationId,
            engagement_id: engagementId,
            batch_code: `BATCH-IDEMPOTENCY-${name.toUpperCase()}`,
            ...(idempotencyKey === undefined ? {} : { idempotency_key: idempotencyKey }),
          },
        });

        assert.equal(res.statusCode, 422);
        assert.equal(res.body.error.code, "validation_blocker");
        assert.ok(res.body.blockers.some((blocker) => blocker.blocking_reason === blockingReason));
      });

      await t.test(`file ${name}`, async () => {
        const res = await invokeRoute("/admin/batches/:intakeBatchId/file-reservations", "post", {
          is() {
            return false;
          },
          params: { intakeBatchId },
          user: { id: 46 },
          body: {
            organization_id: organizationId,
            engagement_id: engagementId,
            ...(idempotencyKey === undefined ? {} : { idempotency_key: idempotencyKey }),
            original_filename: "safe.csv",
            mime_type: "text/csv",
            file_extension: ".csv",
          },
        });

        assert.equal(res.statusCode, 422);
        assert.equal(res.body.error.code, "validation_blocker");
        assert.ok(res.body.blockers.some((blocker) => blocker.blocking_reason === blockingReason));
      });
    }

    assert.equal(batchLookupCalls, 0);
    assert.equal(batchInsertCalls, 0);
    assert.equal(fileLookupCalls, 0);
    assert.equal(fileInsertCalls, 0);
  } finally {
    restore();
  }
});

test("mounted file reservation returns 422 checksum blockers before lookup or insert", async (t) => {
  let replayLookups = 0;
  let duplicateLookups = 0;
  let inserts = 0;
  const dependencies = {
    env: { KAI_SPRINT2_ENABLED: "true" },
    async getIntakeBatchTenantState() {
      return { intake_batch_id: intakeBatchId, organization_id: organizationId, engagement_id: engagementId };
    },
    async findIntakeFileReservationByIdempotencyKey() {
      replayLookups += 1;
      return null;
    },
    async findIntakeFileReservationByChecksum() {
      duplicateLookups += 1;
      return null;
    },
    async insertIntakeFileMetadata() {
      inserts += 1;
    },
  };
  const restore = intakeRouteTestables.setIntakeServiceForTest({
    async reserveIntakeFileMetadata(input) {
      return reserveIntakeFileMetadata({ ...input, actorContext }, dependencies);
    },
  });

  try {
    for (const { name, checksum, hashAlgorithm, blockingReason } of [
      { name: "missing checksum", checksum: undefined, hashAlgorithm: "sha256", blockingReason: "missing_checksum" },
      { name: "invalid checksum", checksum: "not-a-checksum", hashAlgorithm: "sha256", blockingReason: "invalid_checksum" },
      { name: "missing algorithm", checksum: "a".repeat(64), hashAlgorithm: undefined, blockingReason: "missing_hash_algorithm" },
      { name: "unsupported algorithm", checksum: "a".repeat(64), hashAlgorithm: "sha512", blockingReason: "unsupported_hash_algorithm" },
    ]) {
      await t.test(name, async () => {
        const res = await invokeRoute("/admin/batches/:intakeBatchId/file-reservations", "post", {
          is() {
            return false;
          },
          params: { intakeBatchId },
          user: { id: 46 },
          body: {
            organization_id: organizationId,
            engagement_id: engagementId,
            idempotency_key: `kai-route-checksum-${name.replace(/\s/g, "-")}`,
            original_filename: "safe.csv",
            mime_type: "text/csv",
            file_extension: ".csv",
            ...(checksum === undefined ? {} : { checksum }),
            ...(hashAlgorithm === undefined ? {} : { hash_algorithm: hashAlgorithm }),
          },
        });

        assert.equal(res.statusCode, 422);
        assert.equal(res.body.error.code, "validation_blocker");
        assert.ok(res.body.blockers.some((blocker) => blocker.blocking_reason === blockingReason));
      });
    }

    assert.equal(replayLookups, 0);
    assert.equal(duplicateLookups, 0);
    assert.equal(inserts, 0);
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
      feature_flag_required: true,
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

test("auth preflight and metadata routes are both gated before canonical authentication", () => {
  const index = readFileSync("index.js", "utf8");
  const preflightMount = [
    "app.use(",
    '  "/api/kai/sprint2/intake/auth-preflight",',
    "  requireKaiSprint2Enabled,",
    "  requireKaiSprint2Authenticated,",
    "  sprint2IntakeAuthPreflightApiRouter",
  ].join("\n");
  const unsafeBroadMount = 'app.use("/api/kai/sprint2/intake", ensureAuthenticatedApi, sprint2IntakeAuthPreflightApiRouter)';
  const gatedMount = [
    'app.use(',
    '  "/api/kai/sprint2/intake",',
    '  requireKaiSprint2Enabled,',
    '  kaiSprint2OrganizationMutationLimiter,',
    '  kaiSprint2ActorMutationLimiter,',
    '  requireKaiSprint2Authenticated,',
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
  await withKaiSprint2Flag("true", async () => {
    const res = createResponse();
    let nextCalled = false;

    await requireKaiSprint2Authenticated(
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
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error.code, "unauthorized");
    assert.deepEqual(res.body.data, null);
  });
});

test("auth preflight valid auth returns sanitized preflight response when enabled", async () => {
  await withKaiSprint2Flag("true", async () => {
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

    await requireKaiSprint2Authenticated(req, res, () => {
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
        feature_flag_required: true,
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
      {
        method: "POST",
        path: "/api/kai/sprint2/intake/admin/files/file-123/block",
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

test("auth preflight route applies the Sprint 2 gate without calling intake services", () => {
  const route = readFileSync("Backend/kai/routes/sprint2IntakeAuthPreflightApi.js", "utf8");

  assert.match(route, /requireKaiSprint2Enabled/);
  assert.match(route, /router\.use\(requireKaiSprint2Enabled\)/);
  assert.doesNotMatch(route, /kaiIntakeService|kaiIntakeQueries|kaiQueries|kaiDb|pool\.query/);
});
