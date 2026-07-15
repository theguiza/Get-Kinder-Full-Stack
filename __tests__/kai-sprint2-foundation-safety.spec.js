import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";

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

test("upload URL and confirmation entry points require both feature flags and remain storage-disabled", async () => {
  for (const operation of [requestUploadUrl, confirmUpload]) {
    for (const env of [
      {},
      { KAI_SPRINT2_ENABLED: "true" },
      { KAI_FILE_UPLOAD_ENABLED: "true" },
    ]) {
      const result = await operation({ env });
      assert.equal(result.error.code, "feature_disabled");
    }
    const gated = await operation({
      env: { KAI_SPRINT2_ENABLED: "true", KAI_FILE_UPLOAD_ENABLED: "true" },
    });
    assert.equal(gated.error.code, "storage_provider_not_configured");
  }
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
