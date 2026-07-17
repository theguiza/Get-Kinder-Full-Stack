import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import express from "express";

import { requireKaiSprint2Enabled } from "../Backend/kai/config/kaiSprint2Config.js";
import {
  blockIntakeFilePolicyStatus,
} from "../Backend/kai/db/kaiIntakeQueries.js";
import { insertRequiredSuccessfulAuditEvent } from "../Backend/kai/db/kaiAuditQueries.js";
import { requireKaiSprint2Authenticated } from "../Backend/kai/middleware/kaiSprint2Authentication.js";
import {
  handleKaiSprint2JsonParserError,
  kaiSprint2ActorMutationLimiter,
  kaiSprint2MetadataJsonParser,
  kaiSprint2OrganizationMutationLimiter,
  setKaiSprint2NoStore,
} from "../Backend/kai/middleware/kaiSprint2RequestSafety.js";
import sprint2IntakeApiRouter, {
  __testables as intakeRouteTestables,
} from "../Backend/kai/routes/sprint2IntakeApi.js";
import { markIntakeFilePolicyBlocked } from "../Backend/kai/services/kaiIntakeService.js";
import {
  FILE_POLICY_BLOCKING_REASON_CODES,
  validateFilePolicyBlockRequest,
} from "../Backend/kai/validators/kaiSprint2RequestSchemas.js";

const basePath = "/api/kai/sprint2/intake";
const routePath = "/api/kai/sprint2/intake/admin/files/7e426ea1-2be3-4e48-b80f-9783ddbacda4/block?organization_id=a5d17c5a-c55f-43af-9b21-fe63aafe733f";
const organizationId = "a5d17c5a-c55f-43af-9b21-fe63aafe733f";
const otherOrganizationId = "b5d17c5a-c55f-43af-9b21-fe63aafe733f";
const engagementId = "2e426ea1-2be3-4e48-b80f-9783ddbacda0";
const intakeBatchId = "8e426ea1-2be3-4e48-b80f-9783ddbacda0";
const intakeFileId = "7e426ea1-2be3-4e48-b80f-9783ddbacda4";

const fileDtoKeys = Object.freeze([
  "intake_file_id",
  "intake_batch_id",
  "organization_id",
  "engagement_id",
  "safe_filename",
  "mime_type",
  "file_size_bytes",
  "file_policy_status",
  "malware_scan_status",
  "processing_status",
  "parse_status",
  "review_status",
  "created_at",
  "updated_at",
].sort());

const forbiddenRowSentinels = Object.freeze({
  storage_provider: "storage-provider-sentinel",
  storage_bucket: "storage-bucket-sentinel",
  storage_object_key: "storage-object-key-sentinel",
  storage_uri: "storage-uri-sentinel",
  signed_url: "signed-url-sentinel",
  checksum: "checksum-sentinel",
  hash_algorithm: "hash-algorithm-sentinel",
  upload_state: "policy_blocked",
  immutable_version: "immutable-version-sentinel",
  raw_content: "raw-content-sentinel",
  metadata: Object.freeze({ marker: "unrestricted-metadata-sentinel" }),
  credentials: Object.freeze({ token: "credentials-sentinel" }),
  audit_payload: Object.freeze({ marker: "audit-payload-sentinel" }),
  transaction_context: Object.freeze({ marker: "transaction-context-sentinel" }),
  actor_context: Object.freeze({ marker: "actor-context-sentinel" }),
  session_context: Object.freeze({ marker: "session-context-sentinel" }),
  membership_context: Object.freeze({ marker: "membership-context-sentinel" }),
  review_queue_item_id: "review-queue-sentinel",
  client_data: Object.freeze({ marker: "client-data-sentinel" }),
  unapproved_pii: Object.freeze({ marker: "unapproved-pii-sentinel" }),
});

const storedPendingRow = Object.freeze({
  intake_file_id: intakeFileId,
  intake_batch_id: intakeBatchId,
  organization_id: organizationId,
  engagement_id: engagementId,
  safe_filename: "operator-safe.csv",
  mime_type: "text/csv",
  file_size_bytes: 321,
  file_policy_status: "pending",
  malware_scan_status: "not_configured",
  processing_status: "quarantined",
  parse_status: "quarantined",
  review_status: "proposed",
  created_at: "2026-07-15T10:00:00.000Z",
  updated_at: "2026-07-15T11:00:00.000Z",
  ...forbiddenRowSentinels,
});

const updatedBlockedRow = Object.freeze({
  ...storedPendingRow,
  file_policy_status: "blocked",
  updated_at: "2026-07-15T11:01:00.000Z",
});

const expectedDto = Object.freeze({
  intake_file_id: intakeFileId,
  intake_batch_id: intakeBatchId,
  organization_id: organizationId,
  engagement_id: engagementId,
  safe_filename: "operator-safe.csv",
  mime_type: "text/csv",
  file_size_bytes: 321,
  file_policy_status: "blocked",
  malware_scan_status: "not_configured",
  processing_status: "quarantined",
  parse_status: "quarantined",
  review_status: "proposed",
  created_at: "2026-07-15T10:00:00.000Z",
  updated_at: "2026-07-15T11:01:00.000Z",
});

function actorContext({
  actorType = "human",
  globalRole = "gk_operator",
  membershipRole = "gk_operator",
  membershipStatus = "active",
  memberships = null,
} = {}) {
  return {
    actorType,
    actorUserId: "7fe568b1-5c05-4c42-bb1f-6e20de216c7b",
    kaiRoles: globalRole ? [globalRole] : [],
    organizationMemberships: memberships ?? [
      { organization_id: organizationId, role_name: membershipRole, membership_status: membershipStatus },
    ],
  };
}

function assertForbiddenSentinelsAbsent(value) {
  const serialized = JSON.stringify(value);
  for (const [field, sentinel] of Object.entries(forbiddenRowSentinels)) {
    const marker = typeof sentinel === "string" ? sentinel : Object.values(sentinel)[0];
    assert.equal(serialized.includes(`"${field}"`), false, field);
    assert.equal(serialized.includes(marker), false, marker);
  }
}

function createHarness(overrides = {}) {
  const events = [];
  const transactionContext = { name: "tx-context" };
  return {
    events,
    transactionContext,
    storedRow: storedPendingRow,
    updatedRow: updatedBlockedRow,
    actorContext: actorContext(),
    auditResult: { ok: true },
    auditMetadata: null,
    auditContext: null,
    writeContext: null,
    readCalls: [],
    writeCalls: [],
    queueCalls: [],
    uploadStateWrites: [],
    metricContext: null,
    async runInTransaction(callback) {
      this.events.push("BEGIN");
      try {
        const result = await callback(transactionContext);
        this.events.push("COMMIT");
        return result;
      } catch (error) {
        this.events.push("ROLLBACK");
        throw error;
      }
    },
    ...overrides,
  };
}

function serviceDependencies(harness) {
  return {
    env: { KAI_SPRINT2_ENABLED: "true" },
    now: () => "2026-07-17T12:00:00.000Z",
    runInTransaction: harness.runInTransaction.bind(harness),
    async getIntakeFileMetadata(requestedOrganizationId, requestedIntakeFileId, transactionContext) {
      harness.events.push("SCOPED_READ");
      harness.readCalls.push({ requestedOrganizationId, requestedIntakeFileId, transactionContext });
      return harness.storedRow;
    },
    async blockIntakeFilePolicyStatus(write, transactionContext) {
      harness.events.push("SCOPED_CAS_WRITE");
      harness.writeContext = transactionContext;
      harness.writeCalls.push(write);
      if (harness.throwOnWrite) throw new Error("synthetic mutation failure");
      return harness.updatedRow;
    },
    async insertRequiredSuccessfulAuditEvent(metadata, transactionContext) {
      harness.events.push("REQUIRED_AUDIT");
      harness.auditMetadata = metadata;
      harness.auditContext = transactionContext;
      if (harness.throwOnAudit) throw new Error("synthetic audit failure");
      return typeof harness.auditResult === "function" ? harness.auditResult() : harness.auditResult;
    },
    async emitBestEffortMetric(metadata) {
      harness.events.push("METRIC");
      harness.metricContext = metadata;
    },
    async getIntakeFileById() {
      throw new Error("ID-only fallback must not execute");
    },
    async listIntakeFileReviewQueueItems() {
      harness.queueCalls.push("read");
      throw new Error("Review queue read must not execute");
    },
    async insertReviewQueueItem() {
      harness.queueCalls.push("write");
      throw new Error("Review queue write must not execute");
    },
    async updateUploadState() {
      harness.uploadStateWrites.push("write");
      throw new Error("Upload state write must not execute");
    },
  };
}

async function runService(harness, input = {}) {
  return await markIntakeFilePolicyBlocked(
    {
      actorContext: harness.actorContext,
      organizationId,
      intakeFileId,
      expectedFilePolicyStatus: "pending",
      blockingReasonCode: "unsafe_filename",
      requestId: "request_1",
      route: "/api/kai/sprint2/intake/admin/files/:intakeFileId/block",
      ...input,
    },
    serviceDependencies(harness),
  );
}

test("file-policy block request schema is an exact two-field allowlist", () => {
  assert.equal(validateFilePolicyBlockRequest({
    expected_file_policy_status: "pending",
    blocking_reason_code: "unsafe_filename",
  }).ok, true);

  for (const payload of [
    {},
    null,
    [],
    { expected_file_policy_status: "blocked", blocking_reason_code: "unsafe_filename" },
    { expected_file_policy_status: "pending", blocking_reason_code: "unapproved" },
    { expected_file_policy_status: "pending", blocking_reason_code: null },
    { expected_file_policy_status: "pending", blocking_reason_code: ["unsafe_filename"] },
    { expected_file_policy_status: "pending", blocking_reason_code: { code: "unsafe_filename" } },
    { expected_file_policy_status: "pending", blocking_reason_code: "unsafe_filename", blocked_reason: "free text" },
    { expected_file_policy_status: "pending", blocking_reason_code: "unsafe_filename", required_action: "do work" },
    { expected_file_policy_status: "pending", blocking_reason_code: "unsafe_filename", record_version: 1 },
  ]) {
    assert.equal(validateFilePolicyBlockRequest(payload).ok, false, JSON.stringify(payload));
  }
});

test("every approved blocking reason is accepted and unapproved codes are rejected by direct service validation", async () => {
  for (const reason of FILE_POLICY_BLOCKING_REASON_CODES) {
    const harness = createHarness();
    const result = await runService(harness, { blockingReasonCode: reason });
    assert.equal(result.ok, true, reason);
    assert.equal(harness.auditMetadata.blocking_reason_code, reason);
  }

  const rejected = await runService(createHarness(), { blockingReasonCode: "operator_note" });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, "validation_blocker");
});

test("admin and operator require active membership; reviewer, client, and non-human actors are denied before reads", async () => {
  for (const globalRole of ["gk_admin", "gk_operator"]) {
    const harness = createHarness({ actorContext: actorContext({ globalRole }) });
    const result = await runService(harness);
    assert.equal(result.ok, true, globalRole);
    assert.equal(harness.readCalls.length, 1);
  }

  for (const globalRole of ["gk_reviewer", "client_admin", "client_reviewer", "client_contributor"]) {
    const harness = createHarness({ actorContext: actorContext({ globalRole, membershipRole: globalRole }) });
    const result = await runService(harness);
    assert.equal(result.ok, false, globalRole);
    assert.equal(result.error.code, "authorization_denied");
    assert.equal(harness.readCalls.length, 0);
  }

  for (const actorType of ["ai", "system", "internal_service", "import", "code"]) {
    const harness = createHarness({ actorContext: actorContext({ actorType }) });
    const result = await runService(harness);
    assert.equal(result.ok, false, actorType);
    assert.equal(result.error.code, "authorization_denied");
    assert.equal(harness.readCalls.length, 0);
  }

  const inactive = createHarness({ actorContext: actorContext({ membershipStatus: "inactive" }) });
  const inactiveResult = await runService(inactive);
  assert.equal(inactiveResult.error.code, "authorization_denied");
  assert.equal(inactive.readCalls.length, 0);
});

test("pending to blocked performs one scoped read, one scoped CAS write, audit in same transaction, then metrics", async () => {
  const harness = createHarness();
  const result = await runService(harness);

  assert.equal(result.ok, true);
  assert.deepEqual(result.data, expectedDto);
  assert.deepEqual(Object.keys(result.data).sort(), fileDtoKeys);
  assert.deepEqual(harness.readCalls, [{
    requestedOrganizationId: organizationId,
    requestedIntakeFileId: intakeFileId,
    transactionContext: harness.transactionContext,
  }]);
  assert.deepEqual(harness.writeCalls, [{ organizationId, intakeFileId }]);
  assert.strictEqual(harness.writeContext, harness.transactionContext);
  assert.strictEqual(harness.auditContext, harness.transactionContext);
  assert.deepEqual(harness.events, [
    "BEGIN",
    "SCOPED_READ",
    "SCOPED_CAS_WRITE",
    "REQUIRED_AUDIT",
    "COMMIT",
    "METRIC",
  ]);
  assert.equal(harness.events.indexOf("SCOPED_CAS_WRITE") < harness.events.indexOf("REQUIRED_AUDIT"), true);
  assert.equal(harness.events.indexOf("COMMIT") < harness.events.indexOf("METRIC"), true);
  assert.equal(harness.queueCalls.length, 0);
  assert.equal(harness.uploadStateWrites.length, 0);
  assertForbiddenSentinelsAbsent(result);
});

test("successful audit payload is field-allowlisted and excludes body, text, storage, actor, queue, and transaction internals", async () => {
  const harness = createHarness();
  await runService(harness);

  assert.deepEqual(Object.keys(harness.auditMetadata), [
    "operation",
    "actor_user_id",
    "actor_type",
    "organization_id",
    "object_type",
    "target_object_type",
    "object_id",
    "reason_code",
    "validator_key",
    "validator_keys",
    "blocking_reason_code",
    "request_id",
    "route",
    "from_state",
    "to_state",
    "prior_status",
    "new_status",
    "created_at",
  ]);
  assert.equal(harness.auditMetadata.operation, "mark_file_policy_blocked");
  assert.equal(harness.auditMetadata.object_type, "intake_file");
  assert.equal(harness.auditMetadata.target_object_type, "intake_file");
  assert.equal(harness.auditMetadata.object_id, intakeFileId);
  assert.equal(harness.auditMetadata.prior_status, "pending");
  assert.equal(harness.auditMetadata.new_status, "blocked");
  assert.equal(harness.auditMetadata.blocking_reason_code, "unsafe_filename");
  assert.deepEqual(harness.auditMetadata.validator_keys.includes("VAL-STA-001"), true);

  const serialized = JSON.stringify(harness.auditMetadata);
  for (const forbidden of [
    "expected_file_policy_status",
    "blocked_reason",
    "required_action",
    "storage",
    "checksum",
    "upload_state",
    "review_queue",
    "actor_context",
    "membership",
    "transaction",
    "raw",
    "client",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("missing and tenant-mismatched files return identical 404 without fallback or writes", async () => {
  async function run(storedRow) {
    const harness = createHarness({ storedRow });
    const result = await runService(harness);
    return { harness, result };
  }

  const missing = await run(null);
  const tenantMismatch = await run({ ...storedPendingRow, organization_id: otherOrganizationId });

  assert.deepEqual(tenantMismatch.result, missing.result);
  assert.equal(missing.result.error.code, "not_found");
  assert.deepEqual(missing.harness.writeCalls, []);
  assert.deepEqual(tenantMismatch.harness.writeCalls, []);
  assert.equal(missing.harness.auditMetadata, null);
  assert.equal(tenantMismatch.harness.auditMetadata, null);
});

test("stored status transition matrix maps blocked to 409, terminal states to 422, malformed state to 500", async () => {
  for (const [status, expectedCode] of [
    ["blocked", "conflict_current_state_changed"],
    ["passed", "state_transition_denied"],
    ["failed", "state_transition_denied"],
    ["skipped", "state_transition_denied"],
    [null, "system_error"],
    ["unknown", "system_error"],
  ]) {
    const harness = createHarness({ storedRow: { ...storedPendingRow, file_policy_status: status } });
    const result = await runService(harness);
    assert.equal(result.ok, false, String(status));
    assert.equal(result.error.code, expectedCode, String(status));
    assert.deepEqual(harness.writeCalls, [], String(status));
    assert.equal(harness.auditMetadata, null, String(status));
  }
});

test("zero-row compare-and-set returns 409 and mutation failure suppresses audit", async () => {
  const stale = createHarness({ updatedRow: null });
  const staleResult = await runService(stale);
  assert.equal(staleResult.error.code, "conflict_current_state_changed");
  assert.equal(stale.auditMetadata, null);
  assert.deepEqual(stale.events, ["BEGIN", "SCOPED_READ", "SCOPED_CAS_WRITE", "ROLLBACK"]);

  const thrown = createHarness({ throwOnWrite: true });
  const thrownResult = await runService(thrown);
  assert.equal(thrownResult.error.code, "system_error");
  assert.equal(thrown.auditMetadata, null);
  assert.deepEqual(thrown.events, ["BEGIN", "SCOPED_READ", "SCOPED_CAS_WRITE", "ROLLBACK"]);
});

test("malformed stored or post-write rows fail safely before audit", async () => {
  for (const storedRow of [
    { ...storedPendingRow, created_at: "not-a-date" },
    { ...storedPendingRow, file_size_bytes: "321" },
  ]) {
    const harness = createHarness({ storedRow });
    const result = await runService(harness);
    assert.equal(result.error.code, "system_error");
    assert.equal(harness.auditMetadata, null);
    assert.deepEqual(harness.writeCalls, []);
  }

  for (const updatedRow of [
    { ...updatedBlockedRow, organization_id: otherOrganizationId },
    { ...updatedBlockedRow, intake_file_id: "7e426ea1-2be3-4e48-b80f-9783ddbacda3" },
    { ...updatedBlockedRow, file_policy_status: "pending" },
    { ...updatedBlockedRow, review_status: "changed" },
  ]) {
    const harness = createHarness({ updatedRow });
    const result = await runService(harness);
    assert.equal(result.error.code, "system_error", JSON.stringify(updatedRow));
    assert.equal(harness.auditMetadata, null);
    assert.deepEqual(harness.events, ["BEGIN", "SCOPED_READ", "SCOPED_CAS_WRITE", "ROLLBACK"]);
  }
});

test("required-audit non-confirmation variants roll back and suppress metrics", async () => {
  let getterCalls = 0;
  const getterBacked = Object.defineProperty({}, "ok", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return true;
    },
  });

  for (const [description, auditResult] of [
    ["thrown", () => { throw new Error("synthetic audit throw"); }],
    ["rejected", () => Promise.reject(new Error("synthetic audit rejection"))],
    ["skipped", { ok: false, skipped: true }],
    ["missing", undefined],
    ["malformed", { result: "ok" }],
    ["getter-backed", getterBacked],
    ["array-based", Object.assign([], { ok: true })],
    ["non-boolean", { ok: "true" }],
    ["non-true", { ok: false }],
  ]) {
    const harness = createHarness({ auditResult });
    const result = await runService(harness);
    assert.equal(result.ok, false, description);
    assert.equal(result.error.code, "system_error", description);
    assert.deepEqual(harness.events, [
      "BEGIN",
      "SCOPED_READ",
      "SCOPED_CAS_WRITE",
      "REQUIRED_AUDIT",
      "ROLLBACK",
    ], description);
    assert.equal(harness.events.includes("METRIC"), false, description);
  }
  assert.equal(getterCalls, 0);
});

test("repository helpers are scoped and do not update upload lifecycle or review queue fields", async () => {
  let updateCall = null;
  await blockIntakeFilePolicyStatus({ organizationId, intakeFileId }, {
    async query(sql, params) {
      updateCall = { sql, params };
      return { rows: [updatedBlockedRow] };
    },
  });

  assert.match(updateCall.sql, /UPDATE kai\.intake_files/);
  assert.match(updateCall.sql, /WHERE organization_id = \$1\s+AND intake_file_id = \$2\s+AND file_policy_status = 'pending'/);
  assert.match(updateCall.sql, /SET file_policy_status = 'blocked'/);
  assert.deepEqual(updateCall.params, [organizationId, intakeFileId]);
  for (const forbidden of [
    "upload_state",
    "processing_status =",
    "parse_status =",
    "review_status =",
    "malware_scan_status =",
    "intake_file_review",
    "review_queue",
    "blocked_reason",
    "required_action",
    "queue_metadata",
  ]) {
    assert.doesNotMatch(updateCall.sql, new RegExp(forbidden));
  }

  const auditCalls = [];
  const auditResult = await insertRequiredSuccessfulAuditEvent({
    operation: "mark_file_policy_blocked",
    actor_user_id: actorContext().actorUserId,
    actor_type: "human",
    organization_id: organizationId,
    object_type: "intake_file",
    target_object_type: "intake_file",
    object_id: intakeFileId,
    blocking_reason_code: "unsafe_filename",
    validator_keys: ["VAL-STA-001"],
    route: "/api/kai/sprint2/intake/admin/files/:intakeFileId/block",
    request_id: "request_1",
    prior_status: "pending",
    new_status: "blocked",
    created_at: "2026-07-17T12:00:00.000Z",
    blocked_reason: "free text must not persist",
    storage_bucket: "private-bucket",
  }, {
    async query(sql, params) {
      auditCalls.push({ sql, params });
      if (sql.includes("information_schema.columns")) {
        return {
          rows: [
            "audit_event_id",
            "organization_id",
            "actor_user_id",
            "actor_type",
            "action",
            "metadata",
            "object_type",
            "reason_code",
            "reason_text",
          ].map((column_name) => ({ column_name })),
        };
      }
      if (sql.includes("pg_enum")) return { rows: [{ enumlabel: "other" }] };
      return { rows: [{ audit_event_id: "11111111-1111-4111-8111-111111111111" }] };
    },
  });

  assert.equal(auditResult.ok, true);
  const insert = auditCalls.find((call) => call.sql.includes("INSERT INTO kai.audit_events"));
  const metadata = JSON.parse(insert.params[4]);
  assert.equal(insert.params[3], "mark_file_policy_blocked");
  assert.equal(insert.params[5], "other");
  assert.equal(metadata.target_object_type, "intake_file");
  assert.equal(metadata.blocked_reason, undefined);
  assert.equal(metadata.storage_bucket, undefined);
  assert.equal(metadata.metadata_only, true);
});

function scenarioDependencies(scenario) {
  const harness = createHarness({
    events: scenario.events,
    actorContext: undefined,
    storedRow: scenario.storedRow,
    updatedRow: scenario.updatedRow,
  });
  return {
    ...serviceDependencies(harness),
    async findKaiUserByLegacyPublicUserdataId(legacyId) {
      scenario.events.push("actor_mapping");
      assert.equal(legacyId, 46);
      return {
        user_id: actorContext().actorUserId,
        legacy_identity_source: "public.userdata",
        legacy_public_userdata_id: 46,
        status: "active",
      };
    },
    async listKaiRolesForUser() {
      scenario.events.push("role_context_lookup");
      return [scenario.globalRole || "gk_operator"];
    },
    async listOrganizationMembershipsForUser() {
      scenario.events.push("membership_context_lookup");
      if (scenario.membershipState === "missing") return [];
      return [{
        organization_id: organizationId,
        role_name: scenario.membershipRole || "gk_operator",
        membership_status: scenario.membershipState === "inactive" ? "inactive" : "active",
      }];
    },
  };
}

function createScenario(overrides = {}) {
  return {
    authenticated: true,
    events: [],
    globalRole: "gk_operator",
    membershipRole: "gk_operator",
    membershipState: "active",
    storedRow: storedPendingRow,
    updatedRow: updatedBlockedRow,
    serviceResults: [],
    ...overrides,
  };
}

function createAssembledApplication(getScenario) {
  const app = express();
  app.use(basePath, setKaiSprint2NoStore, requireKaiSprint2Enabled, kaiSprint2MetadataJsonParser);
  app.use(basePath, handleKaiSprint2JsonParserError);
  app.use(basePath, (req, res, next) => {
    const scenario = getScenario();
    scenario.events.push("outer_feature_gate_passed");
    req.isAuthenticated = () => {
      scenario.events.push("canonical_http_authentication");
      return scenario.authenticated;
    };
    if (scenario.authenticated) req.user = { id: 46 };
    return next();
  });
  app.use(
    basePath,
    requireKaiSprint2Enabled,
    kaiSprint2OrganizationMutationLimiter,
    kaiSprint2ActorMutationLimiter,
    requireKaiSprint2Authenticated,
    sprint2IntakeApiRouter,
  );
  return app;
}

async function listen(app) {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1");
    server.once("listening", () => resolve(server));
    server.once("error", reject);
  });
}

async function postJson(server, path, body) {
  const { port } = server.address();
  const serialized = JSON.stringify(body);
  return await new Promise((resolve, reject) => {
    const request = http.request({
      hostname: "127.0.0.1",
      port,
      path,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(serialized),
        "x-request-id": "request_1",
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        resolve({
          statusCode: response.statusCode,
          body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
        });
      });
    });
    request.on("error", reject);
    request.end(serialized);
  });
}

async function withFeatureFlag(value, callback) {
  const previous = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = value;
  try {
    return await callback();
  } finally {
    if (previous === undefined) delete process.env.KAI_SPRINT2_ENABLED;
    else process.env.KAI_SPRINT2_ENABLED = previous;
  }
}

test("assembled HTTP route preserves feature/auth order, validation, denial, and response boundary", async (t) => {
  let scenario = createScenario();
  const restoreService = intakeRouteTestables.setIntakeServiceForTest({
    async markIntakeFilePolicyBlocked(input) {
      scenario.events.push("sprint2_file_policy_block_route_handler");
      const result = await markIntakeFilePolicyBlocked(input, scenarioDependencies(scenario));
      scenario.serviceResults.push(result);
      return result;
    },
  });
  const app = createAssembledApplication(() => scenario);
  const server = await listen(app);

  t.after(async () => {
    restoreService();
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  await t.test("feature gate precedes authentication and service", async () => {
    scenario = createScenario();
    const response = await withFeatureFlag("false", () => postJson(server, routePath, {
      expected_file_policy_status: "pending",
      blocking_reason_code: "unsafe_filename",
    }));
    assert.equal(response.statusCode, 403);
    assert.equal(response.body.error.code, "feature_disabled");
    assert.deepEqual(scenario.events, []);
  });

  await t.test("authentication precedes service", async () => {
    scenario = createScenario({ authenticated: false });
    const response = await withFeatureFlag("true", () => postJson(server, routePath, {
      expected_file_policy_status: "pending",
      blocking_reason_code: "unsafe_filename",
    }));
    assert.equal(response.statusCode, 401);
    assert.equal(response.body.error.code, "unauthorized");
    assert.deepEqual(scenario.events, ["outer_feature_gate_passed", "canonical_http_authentication"]);
  });

  await t.test("canonical UUID and exact body failures return validation_blocker before service", async () => {
    for (const [path, body] of [
      [routePath.replace(intakeFileId, intakeFileId.toUpperCase()), {
        expected_file_policy_status: "pending",
        blocking_reason_code: "unsafe_filename",
      }],
      [routePath.replace(organizationId, "not-a-uuid"), {
        expected_file_policy_status: "pending",
        blocking_reason_code: "unsafe_filename",
      }],
      [routePath, {
        expected_file_policy_status: "pending",
        blocking_reason_code: "unsafe_filename",
        idempotency_key: "not-accepted",
      }],
    ]) {
      scenario = createScenario();
      const response = await withFeatureFlag("true", () => postJson(server, path, body));
      assert.equal(response.statusCode, 422, path);
      assert.equal(response.body.error.code, "validation_blocker", path);
      assert.deepEqual(scenario.serviceResults, [], path);
    }
  });

  await t.test("reviewer and client roles are denied", async () => {
    for (const role of ["gk_reviewer", "client_admin", "client_reviewer", "client_contributor"]) {
      scenario = createScenario({ globalRole: role, membershipRole: role });
      const response = await withFeatureFlag("true", () => postJson(server, routePath, {
        expected_file_policy_status: "pending",
        blocking_reason_code: "unsafe_filename",
      }));
      assert.equal(response.statusCode, 403, role);
      assert.equal(response.body.error.code, "authorization_denied", role);
      assert.equal(scenario.events.includes("SCOPED_READ"), false, role);
    }
  });

  await t.test("success returns exactly the 14-field DTO and no forbidden sentinels", async () => {
    scenario = createScenario();
    const response = await withFeatureFlag("true", () => postJson(server, routePath, {
      expected_file_policy_status: "pending",
      blocking_reason_code: "unsafe_filename",
    }));
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { ok: true, data: expectedDto, warnings: [] });
    assert.deepEqual(Object.keys(response.body.data).sort(), fileDtoKeys);
    assert.deepEqual(scenario.events, [
      "outer_feature_gate_passed",
      "canonical_http_authentication",
      "sprint2_file_policy_block_route_handler",
      "actor_mapping",
      "role_context_lookup",
      "membership_context_lookup",
      "BEGIN",
      "SCOPED_READ",
      "SCOPED_CAS_WRITE",
      "REQUIRED_AUDIT",
      "COMMIT",
      "METRIC",
    ]);
    assertForbiddenSentinelsAbsent(response.body);
  });
});
