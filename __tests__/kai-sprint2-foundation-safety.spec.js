import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";

import express from "express";

import {
  confirmUpload,
  createIntakeBatch,
  requestUploadUrl,
  reserveIntakeFileMetadata,
} from "../Backend/kai/services/kaiIntakeService.js";
import router, {
  __testables as intakeRouteTestables,
  sendStatus,
} from "../Backend/kai/routes/sprint2IntakeApi.js";
import { requireKaiSprint2Authenticated } from "../Backend/kai/middleware/kaiSprint2Authentication.js";
import {
  createKaiMutationAttemptLimiter,
  handleKaiSprint2JsonParserError,
  kaiSprint2MetadataJsonParser,
  setKaiSprint2NoStore,
} from "../Backend/kai/middleware/kaiSprint2RequestSafety.js";
import { validateKaiSprint2MutationRequest } from "../Backend/kai/validators/kaiSprint2RequestSchemas.js";

const organizationId = "a5d17c5a-c55f-43af-9b21-fe63aafe733f";
const engagementId = "2e426ea1-2be3-4e48-b80f-9783ddbacda0";
const intakeBatchId = "8e426ea1-2be3-4e48-b80f-9783ddbacda0";
const intakeFileId = "9fe568b1-5c05-4c42-bb1f-6e20de216c7b";
const checksum = "a".repeat(64);

const humanActor = {
  actorType: "human",
  actorUserId: "7fe568b1-5c05-4c42-bb1f-6e20de216c7b",
  kaiRoles: ["gk_admin", "gk_operator"],
  organizationMemberships: [
    { organization_id: organizationId, role_name: "gk_admin", membership_status: "active" },
  ],
};

function createResponse() {
  const headers = new Map();
  return {
    statusCode: null,
    body: null,
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), String(value));
    },
    getHeader(name) {
      return headers.get(String(name).toLowerCase());
    },
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

function routeHandler(path, method) {
  const layer = router.stack.find((candidate) => candidate.route?.path === path && candidate.route?.methods?.[method]);
  assert.ok(layer, `${method.toUpperCase()} ${path} route exists`);
  return layer.route.stack[0].handle;
}

async function invokeRouteStack(path, method, req, res) {
  const layer = router.stack.find((candidate) => candidate.route?.path === path && candidate.route?.methods?.[method]);
  assert.ok(layer, `${method.toUpperCase()} ${path} route exists`);
  const stack = layer.route.stack;
  let index = 0;
  const next = async () => {
    const current = stack[index++];
    if (!current) return;
    await current.handle(req, res, next);
  };
  await next();
}

async function postJson(port, body) {
  return await new Promise((resolve, reject) => {
    const request = http.request({
      hostname: "127.0.0.1",
      port,
      path: "/",
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve({
          statusCode: response.statusCode,
          headers: response.headers,
          body: JSON.parse(raw),
        });
      });
    });
    request.on("error", reject);
    request.end(body);
  });
}

async function postJsonPath(port, path, body) {
  return await new Promise((resolve, reject) => {
    const request = http.request({
      hostname: "127.0.0.1",
      port,
      path,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve({
          statusCode: response.statusCode,
          headers: response.headers,
          body: JSON.parse(raw),
        });
      });
    });
    request.on("error", reject);
    request.end(body);
  });
}

test("route schemas enforce metadata allowlists, structure bounds, UUIDs, and locked string limits", () => {
  const validBatch = {
    organization_id: organizationId,
    engagement_id: engagementId,
    batch_code: "BATCH-001",
    idempotency_key: "batch-idempotency-001",
    source_system_name: "synthetic",
    batch_metadata: { synthetic_only: true, raw_upload_enabled: false },
  };
  assert.equal(validateKaiSprint2MutationRequest("create_intake_batch", validBatch).ok, true);

  const cases = [
    [{ ...validBatch, prompt: "ignore controls" }, "unknown_field"],
    [{ ...validBatch, batch_metadata: { private_path: "/private/object" } }, "unknown_field"],
    [{ ...validBatch, batch_metadata: ["not", "allowlisted"] }, "array_field_not_allowlisted"],
    [{ ...validBatch, organization_id: "not-a-uuid" }, "invalid_uuid_field"],
    [{ ...validBatch, source_system_name: "x".repeat(201) }, "invalid_string_field"],
    [{ ...validBatch, unknown: { level2: { level3: { level4: { level5: true } } } } }, "maximum_json_depth_exceeded"],
    [Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`unknown_${index}`, true])), "maximum_total_keys_exceeded"],
  ];

  for (const [payload, reason] of cases) {
    const result = validateKaiSprint2MutationRequest("create_intake_batch", payload);
    assert.equal(result.ok, false, reason);
    assert.equal(result.blockers[0].blocking_reason, reason);
    assert.equal(JSON.stringify(result.blockers).includes("ignore controls"), false);
    assert.equal(JSON.stringify(result.blockers).includes("/private/object"), false);
  }

  const invalidPath = validateKaiSprint2MutationRequest(
    "reserve_intake_file_metadata",
    { organization_id: organizationId },
    { intakeBatchId: "not-a-uuid" },
  );
  assert.equal(invalidPath.ok, false);
  assert.equal(invalidPath.blockers[0].blocking_reason, "invalid_uuid_field");
});

test("the route-specific parser returns canonical 400 and 413 before accepting a metadata request", async (t) => {
  const app = express();
  app.use(setKaiSprint2NoStore);
  app.use(kaiSprint2MetadataJsonParser);
  app.use(handleKaiSprint2JsonParserError);
  app.post("/", (req, res) => res.json({ ok: true }));

  let server;
  await new Promise((resolve, reject) => {
    server = app.listen(0, "127.0.0.1");
    server.once("listening", resolve);
    server.once("error", reject);
  });
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const { port } = server.address();

  const tooLarge = await postJson(port, JSON.stringify({ notes: "x".repeat(102400) }));
  assert.equal(tooLarge.statusCode, 413);
  assert.equal(tooLarge.body.error.code, "request_too_large");
  assert.equal(tooLarge.headers["cache-control"], "no-store, private");

  const malformed = await postJson(port, '{"notes":');
  assert.equal(malformed.statusCode, 400);
  assert.equal(malformed.body.error.code, "invalid_request");
});

test("separate actor and organization mutation limiters count safe attempts and emit canonical 429", () => {
  let now = 1_000;
  const actorLimiter = createKaiMutationAttemptLimiter({ scope: "actor", max: 1, windowMs: 60_000, now: () => now });
  const organizationLimiter = createKaiMutationAttemptLimiter({ scope: "organization", max: 1, windowMs: 60_000, now: () => now });

  for (const [limiter, req] of [
    [actorLimiter, { method: "POST", user: { id: 42 }, body: { organization_id: organizationId } }],
    [organizationLimiter, { method: "POST", user: { id: 42 }, body: { organization_id: organizationId } }],
  ]) {
    let nextCalls = 0;
    const first = createResponse();
    limiter(req, first, () => { nextCalls += 1; });
    assert.equal(nextCalls, 1);
    assert.equal(first.getHeader("ratelimit-limit"), "1");

    const second = createResponse();
    limiter(req, second, () => { nextCalls += 1; });
    assert.equal(nextCalls, 1);
    assert.equal(second.statusCode, 429);
    assert.equal(second.body.error.code, "abuse_limited");
    assert.equal(second.getHeader("retry-after"), "60");
    assert.equal(JSON.stringify(second.body).includes(organizationId), false);
    assert.equal(JSON.stringify(second.body).includes("actor:42"), false);
  }

  now += 60_000;
  const reset = createResponse();
  actorLimiter({ method: "POST", user: { id: 42 } }, reset, () => {});
  assert.equal(reset.statusCode, null);
});

test("status reports only the mounted metadata capability as enabled", () => {
  const res = createResponse();
  sendStatus({}, res);
  assert.equal(res.body.data.metadata_write_enabled, true);
  for (const field of [
    "file_upload_enabled",
    "upload_confirmation_enabled",
    "storage_provider_enabled",
    "storage_upload_enabled",
    "signed_upload_enabled",
    "signed_read_enabled",
    "parser_worker_enabled",
    "profiling_enabled",
    "data_dictionary_generation_enabled",
    "source_promotion_enabled",
    "evidence_creation_enabled",
    "claim_creation_enabled",
    "generation_enabled",
    "export_enabled",
    "client_review_enabled",
  ]) {
    assert.equal(res.body.data[field], false, field);
  }
});

test("status reports configured Gate B signed-upload capability from the mounted route guard config", () => {
  const res = createResponse();
  sendStatus({
    kaiSprint2StatusEnv: {
      KAI_SPRINT2_ENABLED: "true",
      KAI_FILE_UPLOAD_ENABLED: "true",
      KAI_GATE_B1_GCS_BUCKET_NAME: "valid-gate-b-bucket",
      KAI_GATE_B1_GCS_UPLOAD_SIGNER_TARGET_PRINCIPAL: "upload-signing@example.invalid",
    },
  }, res);

  assert.equal(res.body.data.metadata_write_enabled, true);
  assert.equal(res.body.data.file_upload_enabled, true);
  assert.equal(res.body.data.upload_confirmation_enabled, true);
  assert.equal(res.body.data.storage_provider_enabled, true);
  assert.equal(res.body.data.storage_upload_enabled, true);
  assert.equal(res.body.data.signed_upload_enabled, true);
  assert.equal(res.body.data.signed_read_enabled, false);
  assert.equal(res.body.data.parser_worker_enabled, false);
});

test("upload-url route remains blocked by the Sprint 2 feature gate when disabled", async (t) => {
  const previous = process.env.KAI_SPRINT2_ENABLED;
  delete process.env.KAI_SPRINT2_ENABLED;
  const app = express();
  app.use(router);

  let server;
  await new Promise((resolve, reject) => {
    server = app.listen(0, "127.0.0.1");
    server.once("listening", resolve);
    server.once("error", reject);
  });
  t.after(() => {
    if (previous === undefined) delete process.env.KAI_SPRINT2_ENABLED;
    else process.env.KAI_SPRINT2_ENABLED = previous;
    return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const response = await postJsonPath(
    server.address().port,
    `/admin/batches/${intakeBatchId}/files/upload-url`,
    JSON.stringify({ organization_id: organizationId, engagement_id: engagementId, intake_file_id: intakeFileId }),
  );
  assert.equal(response.statusCode, 403);
  assert.equal(response.body.error.code, "feature_disabled");
});

test("Sprint 2 authentication failures use the canonical KAI response shape", async () => {
  const res = createResponse();
  let nextCalled = false;
  await requireKaiSprint2Authenticated(
    {
      get() { return null; },
      isAuthenticated() { return false; },
    },
    res,
    () => { nextCalled = true; },
  );
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error.code, "unauthorized");
  assert.equal(res.body.error.status, 401);
});

test("ordinary file DTOs omit private storage identifiers and server-side storage data ignores caller values", async () => {
  let inserted = null;
  const result = await reserveIntakeFileMetadata(
    {
      actorContext: humanActor,
      organizationId,
      engagementId,
      intakeBatchId,
      intakeFileId,
      idempotencyKey: "file-reservation-idempotency-001",
      originalFilename: "safe.csv",
      checksum,
      hashAlgorithm: "sha256",
      storageProvider: "caller-provider",
      storageBucket: "caller-bucket",
      storageUri: "private://caller/object",
    },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      storageProvider: "gcs",
      storageBucket: "server-private-bucket",
      async getIntakeBatchTenantState() {
        return { intake_batch_id: intakeBatchId, organization_id: organizationId, engagement_id: engagementId };
      },
      async findIntakeFileReservationByIdempotencyKey() { return null; },
      async findIntakeFileReservationByChecksum() { return null; },
      async insertIntakeFileMetadata(file) {
        inserted = file;
        return {
          intake_file_id: file.intakeFileId,
          intake_batch_id: file.intakeBatchId,
          organization_id: file.organizationId,
          engagement_id: file.engagementId,
          safe_filename: file.safeFilename,
          storage_provider: file.storageProvider,
          storage_bucket: file.storageBucket,
          storage_object_key: file.storageObjectKey,
          storage_uri: file.storageUri,
          file_policy_status: file.filePolicyStatus,
          malware_scan_status: file.malwareScanStatus,
          processing_status: "quarantined",
          parse_status: "quarantined",
          review_status: "proposed",
        };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(inserted.storageProvider, "gcs");
  assert.equal(inserted.storageBucket, "server-private-bucket");
  assert.notEqual(inserted.storageUri, "private://caller/object");
  const serialized = JSON.stringify(result);
  for (const forbidden of ["storage_provider", "storage_bucket", "storage_object_key", "storage_uri", "server-private-bucket", "private://caller/object"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("assistant and generic system metadata mutations invoke no tenant or write dependency", async () => {
  for (const actorType of ["assistant", "ai", "system", "internal_service"]) {
    let dependencyCalls = 0;
    const result = await createIntakeBatch(
      {
        actorContext: { ...humanActor, actorType },
        organizationId,
        engagementId,
        batchCode: "BLOCKED-NON-HUMAN",
        idempotencyKey: "blocked-non-human-001",
      },
      {
        env: { KAI_SPRINT2_ENABLED: "true" },
        async getEngagementTenantState() { dependencyCalls += 1; },
        async findIntakeBatchByIdempotencyKey() { dependencyCalls += 1; },
        async insertIntakeBatchMetadata() { dependencyCalls += 1; },
      },
    );
    assert.equal(result.ok, false, actorType);
    assert.equal(result.error.code, "authorization_denied", actorType);
    assert.equal(result.blockers[0].blocking_reason, "assistant_boundary", actorType);
    assert.equal(dependencyCalls, 0, actorType);
  }
});

test("upload URL entry point requires both feature flags and remains storage-disabled", async () => {
  for (const env of [
    {},
    { KAI_SPRINT2_ENABLED: "true" },
    { KAI_FILE_UPLOAD_ENABLED: "true" },
  ]) {
    const result = await requestUploadUrl({}, { env });
    assert.equal(result.error.code, "feature_disabled");
  }

  const minimalActorContext = {
    actorType: "human",
    actorUserId: "7fe568b1-5c05-4c42-bb1f-6e20de216c7b",
    kaiRoles: ["gk_operator"],
    organizationMemberships: [
      {
        organization_id: "a5d17c5a-c55f-43af-9b21-fe63aafe733f",
        role_name: "gk_operator",
        membership_status: "active",
      },
    ],
  };
  const gated = await requestUploadUrl(
    {
      actorContext: minimalActorContext,
      organizationId: "a5d17c5a-c55f-43af-9b21-fe63aafe733f",
      intakeFileId: "9fe568b1-5c05-4c42-bb1f-6e20de216c7b",
    },
    {
      env: { KAI_SPRINT2_ENABLED: "true", KAI_FILE_UPLOAD_ENABLED: "true" },
      async getIntakeFileMetadata(organizationId, intakeFileId) {
        return { organization_id: organizationId, intake_file_id: intakeFileId };
      },
    },
  );
  assert.equal(gated.error.code, "storage_provider_not_configured");
});

test("real upload route streams through service boundary with safe identifiers", async () => {
  let serviceInput = null;
  const restore = intakeRouteTestables.setIntakeServiceForTest({
    async uploadReservedIntakeFile(input) {
      serviceInput = input;
      const chunks = [];
      for await (const chunk of input.byteSource) chunks.push(Buffer.from(chunk));
      assert.equal(Buffer.concat(chunks).toString("utf8"), "route upload bytes");
      return {
        ok: true,
        data: {
          organization_id: organizationId,
          intake_batch_id: intakeBatchId,
          intake_file_id: intakeFileId,
          upload_state: "uploaded_unconfirmed",
          object_version_id: "ov_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          size_bytes: 18,
          replayed: false,
        },
        warnings: [],
      };
    },
  });
  try {
    const req = Readable.from([Buffer.from("route upload bytes")]);
    Object.assign(req, {
      get(name) {
        return name.toLowerCase() === "content-type" ? "application/octet-stream" : null;
      },
      headers: { "content-type": "application/octet-stream" },
      query: { organization_id: organizationId, engagement_id: engagementId, intake_batch_id: intakeBatchId },
      params: { intakeFileId },
      body: undefined,
      user: { id: 46, private: "must-not-pass" },
    });
    const res = createResponse();
    res.once = () => res;
    await invokeRouteStack("/admin/files/:intakeFileId/upload", "post", req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.data.upload_state, "uploaded_unconfirmed");
    assert.equal(serviceInput.organizationId, organizationId);
    assert.equal(serviceInput.engagementId, engagementId);
    assert.equal(serviceInput.intakeBatchId, intakeBatchId);
    assert.equal(serviceInput.intakeFileId, intakeFileId);
    assert.equal(serviceInput.route, "/api/kai/sprint2/intake/admin/files/:intakeFileId/upload");
    assert.deepEqual(serviceInput.req.user, { id: 46, email: null });
    assert.equal(typeof serviceInput.signal.aborted, "boolean");
    assert.equal(JSON.stringify(res.body).includes("must-not-pass"), false);
  } finally {
    restore();
  }
});

test("real confirm-upload route rejects caller verification facts and delegates only safe identity", async () => {
  let serviceCalled = false;
  const restore = intakeRouteTestables.setIntakeServiceForTest({
    async confirmUpload(input) {
      serviceCalled = true;
      assert.equal(input.organizationId, organizationId);
      assert.equal(input.intakeFileId, intakeFileId);
      assert.equal(input.route, "/api/kai/sprint2/intake/admin/files/:intakeFileId/confirm-upload");
      assert.deepEqual(input.req.user, { id: 46, email: null });
      return {
        ok: true,
        data: {
          organization_id: organizationId,
          intake_batch_id: intakeBatchId,
          intake_file_id: intakeFileId,
          upload_state: "confirmed",
          object_version_id: "ov_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          verified_size_bytes: 18,
          replayed: false,
        },
        warnings: [],
      };
    },
  });
  try {
    const invalid = createResponse();
    await invokeRouteStack("/admin/files/:intakeFileId/confirm-upload", "post", {
      get() { return "application/json"; },
      query: { organization_id: organizationId },
      params: { intakeFileId },
      body: { organization_id: organizationId, checksum: checksum },
      user: { id: 46 },
    }, invalid);
    assert.equal(invalid.statusCode, 422);
    assert.equal(serviceCalled, false);

    const valid = createResponse();
    await invokeRouteStack("/admin/files/:intakeFileId/confirm-upload", "post", {
      get() { return "application/json"; },
      query: { organization_id: organizationId },
      params: { intakeFileId },
      body: { organization_id: organizationId },
      user: { id: 46, private: "must-not-pass" },
    }, valid);
    assert.equal(valid.statusCode, 200);
    assert.equal(valid.body.data.upload_state, "confirmed");
    assert.equal(serviceCalled, true);
    assert.equal(JSON.stringify(valid.body).includes("must-not-pass"), false);
  } finally {
    restore();
  }
});

test("real confirm-upload route returns a safe phase when the service throws", async () => {
  const restore = intakeRouteTestables.setIntakeServiceForTest({
    async confirmUpload() {
      throw new Error("private confirm-upload service failure with storage object detail");
    },
  });
  try {
    const res = createResponse();
    await invokeRouteStack("/admin/files/:intakeFileId/confirm-upload", "post", {
      get() { return "application/json"; },
      query: { organization_id: organizationId },
      params: { intakeFileId },
      body: { organization_id: organizationId },
      user: { id: 46 },
    }, res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error.code, "system_error");
    assert.deepEqual(res.body.data, { exact_verification_phase: "confirm_upload_route_service" });
    assert.doesNotMatch(JSON.stringify(res.body), /storage object detail/);
  } finally {
    restore();
  }
});

test("contract upload-url route rejects storage overrides and delegates only safe reservation identity", async () => {
  let serviceInput = null;
  const restore = intakeRouteTestables.setIntakeServiceForTest({
    async requestUploadUrl(input) {
      serviceInput = input;
      assert.equal(input.organizationId, organizationId);
      assert.equal(input.engagementId, engagementId);
      assert.equal(input.intakeBatchId, intakeBatchId);
      assert.equal(input.intakeFileId, intakeFileId);
      assert.equal(input.route, "/api/kai/sprint2/intake/admin/batches/:intakeBatchId/files/upload-url");
      assert.deepEqual(input.req.user, { id: 46, email: null });
      assert.equal(input.bucket, undefined);
      assert.equal(input.objectKey, undefined);
      assert.equal(input.storageObjectKey, undefined);
      assert.equal(input.mimeType, undefined);
      assert.equal(input.originalFilename, undefined);
      return {
        ok: true,
        data: {
          organization_id: organizationId,
          intake_batch_id: intakeBatchId,
          intake_file_id: intakeFileId,
          upload_url: "https://signed.example.test/upload",
          upload_method: "PUT",
          upload_headers: { "content-type": "application/pdf" },
          expires_in_seconds: 900,
        },
        warnings: [],
      };
    },
  });
  try {
    const invalid = createResponse();
    await invokeRouteStack("/admin/batches/:intakeBatchId/files/upload-url", "post", {
      get() { return "application/json"; },
      params: { intakeBatchId },
      body: {
        organization_id: organizationId,
        engagement_id: engagementId,
        intake_file_id: intakeFileId,
        bucket: "attacker-bucket",
      },
      user: { id: 46 },
    }, invalid);
    assert.equal(invalid.statusCode, 422);
    assert.equal(serviceInput, null);

    const valid = createResponse();
    await invokeRouteStack("/admin/batches/:intakeBatchId/files/upload-url", "post", {
      get() { return "application/json"; },
      params: { intakeBatchId },
      body: {
        organization_id: organizationId,
        engagement_id: engagementId,
        intake_file_id: intakeFileId,
      },
      user: { id: 46, private: "must-not-pass" },
    }, valid);
    assert.equal(valid.statusCode, 200);
    assert.equal(valid.body.data.upload_method, "PUT");
    assert.equal(serviceInput.payload.bucket, undefined);
    assert.equal(JSON.stringify(valid.body).includes("must-not-pass"), false);
  } finally {
    restore();
  }
});

test("upload confirmation entry point requires both feature flags and actor context before dependencies", async () => {
  for (const env of [
    {},
    { KAI_SPRINT2_ENABLED: "true" },
    { KAI_FILE_UPLOAD_ENABLED: "true" },
  ]) {
    const result = await confirmUpload({}, { env });
    assert.equal(result.error.code, "feature_disabled");
  }

  let metadataCalls = 0;
  let lifecycleReadCalls = 0;
  let lifecycleTransitionCalls = 0;
  let storageCalls = 0;
  const gated = await confirmUpload({}, {
    env: { KAI_SPRINT2_ENABLED: "true", KAI_FILE_UPLOAD_ENABLED: "true" },
    async getIntakeFileMetadata() {
      metadataCalls += 1;
      throw new Error("metadata read should not run without actor context");
    },
    uploadLifecycleRepository: {
      async getUploadLifecycle() {
        lifecycleReadCalls += 1;
        throw new Error("lifecycle read should not run without actor context");
      },
      async transitionUploadLifecycle() {
        lifecycleTransitionCalls += 1;
        throw new Error("lifecycle transition should not run without actor context");
      },
    },
    storageAdapter: {
      async openObjectVersionReadStream() {
        storageCalls += 1;
        throw new Error("storage should not run without actor context");
      },
    },
  });
  assert.equal(gated.error.code, "unauthorized");
  assert.equal(metadataCalls, 0);
  assert.equal(lifecycleReadCalls, 0);
  assert.equal(lifecycleTransitionCalls, 0);
  assert.equal(storageCalls, 0);
});

test("unexpected service failures return only the generic system error", async () => {
  const restore = intakeRouteTestables.setIntakeServiceForTest({
    async createIntakeBatch() {
      throw new Error("private://secret-bucket/object-key");
    },
  });
  try {
    const req = {
      get() { return "application/json"; },
      user: { id: 46 },
      body: {
        organization_id: organizationId,
        engagement_id: engagementId,
        batch_code: "FAIL-SAFELY",
        idempotency_key: "fail-safely-idempotency-001",
      },
    };
    const res = createResponse();
    await routeHandler("/admin/batches", "post")(req, res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error.code, "system_error");
    assert.equal(JSON.stringify(res.body).includes("secret-bucket"), false);
  } finally {
    restore();
  }
});

test("route responses omit internal audit context and sanitize unexpected returned errors", () => {
  const successRes = createResponse();
  intakeRouteTestables.sendServiceResult(successRes, {
    ok: true,
    data: { metadata_only: true },
    warnings: [],
    audit_context: { actor_user_id: "private-actor-id" },
  });
  assert.equal(JSON.stringify(successRes.body).includes("private-actor-id"), false);
  assert.equal("audit_context" in successRes.body, false);

  const errorRes = createResponse();
  intakeRouteTestables.sendServiceResult(errorRes, {
    ok: false,
    error: { code: "unexpected_private_failure", message: "private://secret/object", status: 418 },
    blockers: [{ evidence: { storage_uri: "private://secret/object" } }],
    warnings: [{ code: "private_warning", message: "private://secret/object" }],
  });
  assert.equal(errorRes.statusCode, 500);
  assert.equal(errorRes.body.error.code, "system_error");
  assert.equal(JSON.stringify(errorRes.body).includes("private://secret/object"), false);

  const storageErrorRes = createResponse();
  intakeRouteTestables.sendServiceResult(storageErrorRes, {
    ok: false,
    error: { code: "system_error", message: "private://secret/object", status: 500 },
    data: {
      operation: "create_signed_upload_url",
      provider: "gcs",
      contract: "kai_sprint2_gate_c1_gcs_provider_v1",
      failure_phase: "sign_v4_string",
      diagnostic_code: "signing_permission_denied",
      provider_http_status: 403,
      provider_status: "PERMISSION_DENIED",
      storage_uri: "gs://secret-bucket/private-object",
      raw_provider_response: { error: { message: "private://secret/object" } },
    },
  });
  assert.equal(storageErrorRes.statusCode, 500);
  assert.equal(storageErrorRes.body.error.code, "system_error");
  assert.deepEqual(storageErrorRes.body.data, {
    operation: "create_signed_upload_url",
    provider: "gcs",
    contract: "kai_sprint2_gate_c1_gcs_provider_v1",
    failure_phase: "sign_v4_string",
    diagnostic_code: "signing_permission_denied",
    provider_http_status: 403,
    provider_status: "PERMISSION_DENIED",
  });
  assert.equal(JSON.stringify(storageErrorRes.body).includes("secret-bucket"), false);
  assert.equal(JSON.stringify(storageErrorRes.body).includes("private://secret/object"), false);

  const exactGenerationErrorRes = createResponse();
  intakeRouteTestables.sendServiceResult(exactGenerationErrorRes, {
    ok: false,
    error: { code: "system_error", message: "private://secret/object", status: 500 },
    data: {
      operation: "open_exact_generation_read_stream",
      provider: "gcs",
      contract: "kai_sprint2_gate_c1_gcs_provider_v1",
      exact_verification_phase: "gcs_stream_exact_generation",
      storage_uri: "gs://secret-bucket/private-object",
      raw_provider_response: { error: { message: "private://secret/object" } },
    },
  });
  assert.equal(exactGenerationErrorRes.statusCode, 500);
  assert.equal(exactGenerationErrorRes.body.error.code, "system_error");
  assert.deepEqual(exactGenerationErrorRes.body.data, {
    operation: "open_exact_generation_read_stream",
    provider: "gcs",
    contract: "kai_sprint2_gate_c1_gcs_provider_v1",
    exact_verification_phase: "gcs_stream_exact_generation",
  });
  assert.equal(JSON.stringify(exactGenerationErrorRes.body).includes("secret-bucket"), false);

  const googleApiErrorRes = createResponse();
  intakeRouteTestables.sendServiceResult(googleApiErrorRes, {
    ok: false,
    error: { code: "system_error", message: "private://secret/object", status: 500 },
    data: {
      operation: "head_object",
      provider: "gcs",
      contract: "kai_sprint2_gate_c1_gcs_provider_v1",
      exact_verification_phase: "gcs_head_object",
      gcs_head_object_failure_code: "system_error",
      gcs_head_object_failure_reason: "provider_exception",
      provider_http_status: 403,
      provider_status: "PERMISSION_DENIED",
      google_api: "iamcredentials",
      error_info_reason: "IAM_PERMISSION_DENIED",
      error_info_domain: "iam.googleapis.com",
      error_info_service: "iamcredentials.googleapis.com",
      error_info_permission: "iam.serviceAccounts.getAccessToken",
    },
  });
  assert.deepEqual(googleApiErrorRes.body.data, {
    operation: "head_object",
    provider: "gcs",
    contract: "kai_sprint2_gate_c1_gcs_provider_v1",
    exact_verification_phase: "gcs_head_object",
    gcs_head_object_failure_code: "system_error",
    gcs_head_object_failure_reason: "provider_exception",
    provider_http_status: 403,
    provider_status: "PERMISSION_DENIED",
    google_api: "iamcredentials",
    error_info_reason: "IAM_PERMISSION_DENIED",
    error_info_domain: "iam.googleapis.com",
    error_info_service: "iamcredentials.googleapis.com",
    error_info_permission: "iam.serviceAccounts.getAccessToken",
  });

  const unsafeGoogleApiErrorRes = createResponse();
  intakeRouteTestables.sendServiceResult(unsafeGoogleApiErrorRes, {
    ok: false,
    error: { code: "system_error", message: "private://secret/object", status: 500 },
    data: {
      operation: "head_object",
      provider: "gcs",
      contract: "kai_sprint2_gate_c1_gcs_provider_v1",
      google_api: "https://iamcredentials.googleapis.com/private-path",
      error_info_reason: "not a safe token",
      error_info_domain: "<script>alert(1)</script>",
      error_info_service: "javascript:alert(1)",
      error_info_permission: "raw arbitrary metadata blob",
    },
  });
  assert.deepEqual(unsafeGoogleApiErrorRes.body.data, {
    operation: "head_object",
    provider: "gcs",
    contract: "kai_sprint2_gate_c1_gcs_provider_v1",
  });
  assert.equal(JSON.stringify(exactGenerationErrorRes.body).includes("private://secret/object"), false);

  const blockerRes = createResponse();
  intakeRouteTestables.sendServiceResult(blockerRes, {
    ok: false,
    error: { code: "validation_blocker" },
    blockers: [{
      validator_key: "VAL-STO-001",
      severity: "blocker",
      object_type: "intake_file",
      object_code: "storage_provider",
      object_id: "private-object-id",
      message: "Storage provider is invalid.",
      blocking_reason: "invalid_storage_provider",
      required_fix: "Use server configuration.",
      evidence: { storage_uri: "private://secret/object" },
    }],
  });
  assert.equal(blockerRes.statusCode, 422);
  assert.equal(blockerRes.body.blockers[0].blocking_reason, "invalid_storage_provider");
  assert.equal(blockerRes.body.blockers[0].object_id, null);
  assert.deepEqual(blockerRes.body.blockers[0].evidence, {});
  assert.equal(JSON.stringify(blockerRes.body).includes("private://secret/object"), false);
});

test("root parser order, canonical barrel, and mutation validator source remain aligned", () => {
  const indexSource = readFileSync("index.js", "utf8");
  const barrelSource = readFileSync("Backend/kai/index.js", "utf8");
  const serviceSource = readFileSync("Backend/kai/services/kaiIntakeService.js", "utf8");
  assert.ok(indexSource.indexOf("kaiSprint2MetadataJsonParser") < indexSource.indexOf("app.use(express.json({"));
  assert.match(barrelSource, /from "\.\/services\/kaiIntakeService\.js"/);
  assert.doesNotMatch(barrelSource, /from "\.\/services\/intakeService\.js"/);
  assert.match(serviceSource, /idempotencyValidatorGroups\.metadata_batch_write/);
  assert.match(serviceSource, /idempotencyValidatorGroups\.metadata_file_write/);
  assert.equal((serviceSource.match(/validateMetadataMutationInput\("create_intake_batch"/g) || []).length, 1);
  assert.equal((serviceSource.match(/validateMetadataMutationInput\("reserve_intake_file_metadata"/g) || []).length, 1);
});
