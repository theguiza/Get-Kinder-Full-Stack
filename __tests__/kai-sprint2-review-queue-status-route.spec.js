import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import express from "express";

import {
  getScopedIntakeFileReviewQueueItem,
  getScopedReviewQueueLinkedIntakeFile,
  updateReviewQueueItemStatusIfCurrent,
} from "../Backend/kai/db/kaiIntakeQueries.js";
import { requireKaiSprint2Enabled } from "../Backend/kai/config/kaiSprint2Config.js";
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
import { updateReviewQueueStatus } from "../Backend/kai/services/kaiReviewQueueService.js";
import { validateReviewQueueStatusRequest } from "../Backend/kai/validators/kaiSprint2RequestSchemas.js";

const basePath = "/api/kai/sprint2/intake";
const organizationId = "a5d17c5a-c55f-43af-9b21-fe63aafe733f";
const otherOrganizationId = "b5d17c5a-c55f-43af-9b21-fe63aafe733f";
const reviewQueueItemId = "6e426ea1-2be3-4e48-b80f-9783ddbacda4";
const otherReviewQueueItemId = "6e426ea1-2be3-4e48-b80f-9783ddbacda5";
const intakeFileId = "7e426ea1-2be3-4e48-b80f-9783ddbacda4";
const otherIntakeFileId = "7e426ea1-2be3-4e48-b80f-9783ddbacda5";
const routePath = `${basePath}/admin/review-queue/${reviewQueueItemId}/status?organization_id=${organizationId}`;

const reviewQueueKeys = Object.freeze([
  "review_queue_item_id",
  "organization_id",
  "queue_type",
  "target_object_type",
  "target_object_id",
  "priority",
  "queue_status",
  "due_at",
  "summary",
  "required_action",
  "created_at",
  "updated_at",
]);

const forbiddenSentinels = Object.freeze({
  assigned_to: "assigned-to-sentinel",
  blocked_reason: "blocked-reason-sentinel",
  queue_metadata: Object.freeze({ marker: "queue-metadata-sentinel" }),
  internal_notes: "internal-notes-sentinel",
  audit_payload: Object.freeze({ marker: "audit-payload-sentinel" }),
  transaction_context: Object.freeze({ marker: "transaction-context-sentinel" }),
  actor_context: Object.freeze({ marker: "actor-context-sentinel" }),
  session_context: Object.freeze({ marker: "session-context-sentinel" }),
  membership_context: Object.freeze({ marker: "membership-context-sentinel" }),
  storage_provider: "storage-provider-sentinel",
  storage_bucket: "storage-bucket-sentinel",
  storage_object_key: "storage-object-key-sentinel",
  storage_uri: "storage-uri-sentinel",
  signed_url: "signed-url-sentinel",
  checksum: "checksum-sentinel",
  hash_algorithm: "hash-algorithm-sentinel",
  raw_content: "raw-content-sentinel",
  client_data: Object.freeze({ marker: "client-data-sentinel" }),
  unapproved_pii: Object.freeze({ marker: "unapproved-pii-sentinel" }),
});

const storedOpenRow = Object.freeze({
  review_queue_item_id: reviewQueueItemId,
  organization_id: organizationId,
  queue_type: "intake_file_review",
  target_object_type: "intake_file",
  target_object_id: intakeFileId,
  priority: "medium",
  queue_status: "open",
  due_at: null,
  summary: "  Cafe\u0301\r\n<em>review</em>  ",
  required_action: "  **check**\rnext\tstep  ",
  created_at: "2026-07-15T10:00:00.000Z",
  updated_at: "2026-07-15T11:00:00.000Z",
  ...forbiddenSentinels,
});

const updatedInProgressRow = Object.freeze({
  ...storedOpenRow,
  queue_status: "in_progress",
  updated_at: "2026-07-15T11:01:00.000Z",
});

const expectedDto = Object.freeze({
  review_queue_item_id: reviewQueueItemId,
  organization_id: organizationId,
  queue_type: "intake_file_review",
  target_object_type: "intake_file",
  target_object_id: intakeFileId,
  priority: "medium",
  queue_status: "in_progress",
  due_at: null,
  summary: "Café\n<em>review</em>",
  required_action: "**check**\nnext\tstep",
  created_at: "2026-07-15T10:00:00.000Z",
  updated_at: "2026-07-15T11:01:00.000Z",
});

const linkedFileRow = Object.freeze({
  intake_file_id: intakeFileId,
  organization_id: organizationId,
  storage_provider: "storage-provider-sentinel",
  checksum: "checksum-sentinel",
  raw_content: "raw-content-sentinel",
});

function actorContext({
  actorType = "human",
  globalRole = "gk_operator",
  membershipRole = "gk_operator",
  membershipStatus = "active",
} = {}) {
  return {
    actorType,
    actorUserId: "7fe568b1-5c05-4c42-bb1f-6e20de216c7b",
    kaiRoles: globalRole ? [globalRole] : [],
    organizationMemberships: [
      { organization_id: organizationId, role_name: membershipRole, membership_status: membershipStatus },
    ],
  };
}

function assertForbiddenSentinelsAbsent(value) {
  const serialized = JSON.stringify(value);
  for (const [field, sentinel] of Object.entries(forbiddenSentinels)) {
    const marker = typeof sentinel === "string" ? sentinel : Object.values(sentinel)[0];
    assert.equal(serialized.includes(`"${field}"`), false, field);
    assert.equal(serialized.includes(marker), false, marker);
  }
}

function createHarness(overrides = {}) {
  const events = [];
  const transactionContext = { name: "review-queue-tx-context" };
  return {
    events,
    transactionContext,
    storedQueueRow: storedOpenRow,
    linkedFileRow,
    updatedQueueRow: updatedInProgressRow,
    actorContext: actorContext(),
    auditResult: { ok: true },
    auditMetadata: null,
    auditContext: null,
    metricContext: null,
    queueReadCalls: [],
    linkedReadCalls: [],
    writeCalls: [],
    writeContext: null,
    fallbackCalls: [],
    linkedFileWrites: [],
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
    async getScopedIntakeFileReviewQueueItem(requestedOrganizationId, requestedReviewQueueItemId, transactionContext) {
      harness.events.push("SCOPED_QUEUE_READ");
      harness.queueReadCalls.push({ requestedOrganizationId, requestedReviewQueueItemId, transactionContext });
      return harness.storedQueueRow;
    },
    async getScopedReviewQueueLinkedIntakeFile(requestedOrganizationId, requestedIntakeFileId, transactionContext) {
      harness.events.push("SCOPED_LINKED_FILE_READ");
      harness.linkedReadCalls.push({ requestedOrganizationId, requestedIntakeFileId, transactionContext });
      return harness.linkedFileRow;
    },
    async updateReviewQueueItemStatusIfCurrent(write, transactionContext) {
      harness.events.push("SCOPED_CAS_WRITE");
      harness.writeCalls.push(write);
      harness.writeContext = transactionContext;
      if (harness.throwOnWrite) throw new Error("synthetic queue update failure");
      return harness.updatedQueueRow;
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
    async getReviewQueueItemById() {
      harness.fallbackCalls.push("id_only_queue_item");
      throw new Error("ID-only queue lookup must not execute");
    },
    async getIntakeFileById() {
      harness.fallbackCalls.push("id_only_linked_file");
      throw new Error("ID-only linked-file lookup must not execute");
    },
    async updateLinkedIntakeFile() {
      harness.linkedFileWrites.push("write");
      throw new Error("Linked file mutation must not execute");
    },
  };
}

async function runService(harness, input = {}) {
  return await updateReviewQueueStatus(
    {
      actorContext: harness.actorContext,
      organizationId,
      reviewQueueItemId,
      expectedQueueStatus: "open",
      newQueueStatus: "in_progress",
      requestId: "request_1",
      route: "/api/kai/sprint2/intake/admin/review-queue/:reviewQueueItemId/status",
      ...input,
    },
    serviceDependencies(harness),
  );
}

test("review-queue status request schema is an exact two-field status allowlist", () => {
  assert.equal(validateReviewQueueStatusRequest({
    expected_queue_status: "open",
    new_queue_status: "in_progress",
  }).ok, true);
  assert.equal(validateReviewQueueStatusRequest({
    expected_queue_status: "open",
    new_queue_status: "blocked",
  }).ok, true);

  for (const payload of [
    {},
    null,
    [],
    { expected_queue_status: "open" },
    { new_queue_status: "in_progress" },
    { expected_queue_status: "open", new_queue_status: "in_progress", record_version: 1 },
    { expected_queue_status: "open", new_queue_status: "in_progress", reason_code: "operator_note" },
    { expected_queue_status: "open", new_queue_status: "in_progress", blocked_reason: "free text" },
    { expected_queue_status: "open", new_queue_status: "in_progress", summary: "text" },
    { expected_queue_status: "open", new_queue_status: "in_progress", required_action: "text" },
    { expected_queue_status: "open", new_queue_status: "in_progress", assigned_to: "user" },
    { expected_queue_status: "open", new_queue_status: "in_progress", due_at: "2026-07-17T00:00:00.000Z" },
    { expected_queue_status: null, new_queue_status: "in_progress" },
    { expected_queue_status: ["open"], new_queue_status: "in_progress" },
    { expected_queue_status: { status: "open" }, new_queue_status: "in_progress" },
    { expected_queue_status: "unknown", new_queue_status: "in_progress" },
  ]) {
    assert.equal(validateReviewQueueStatusRequest(payload).ok, false, JSON.stringify(payload));
  }
});

test("authorization denial happens before queue-item or linked-target reads", async () => {
  for (const globalRole of ["gk_admin", "gk_operator"]) {
    const harness = createHarness({ actorContext: actorContext({ globalRole }) });
    const result = await runService(harness);
    assert.equal(result.ok, true, globalRole);
    assert.equal(harness.queueReadCalls.length, 1, globalRole);
    assert.equal(harness.linkedReadCalls.length, 1, globalRole);
  }

  const deniedActors = [
    ["inactive_admin", actorContext({ globalRole: "gk_admin", membershipStatus: "inactive" })],
    ["inactive_operator", actorContext({ globalRole: "gk_operator", membershipStatus: "inactive" })],
    ["gk_reviewer", actorContext({ globalRole: "gk_reviewer", membershipRole: "gk_reviewer" })],
    ["client_admin", actorContext({ globalRole: "client_admin", membershipRole: "client_admin" })],
    ["client_reviewer", actorContext({ globalRole: "client_reviewer", membershipRole: "client_reviewer" })],
    ["client_contributor", actorContext({ globalRole: "client_contributor", membershipRole: "client_contributor" })],
    ["ai", actorContext({ actorType: "ai" })],
    ["system", actorContext({ actorType: "system" })],
    ["internal_service", actorContext({ actorType: "internal_service" })],
    ["import", actorContext({ actorType: "import" })],
    ["code", actorContext({ actorType: "code" })],
  ];

  for (const [name, actor] of deniedActors) {
    const harness = createHarness({ actorContext: actor });
    const result = await runService(harness);
    assert.equal(result.ok, false, name);
    assert.equal(result.error.code, "authorization_denied", name);
    assert.deepEqual(harness.queueReadCalls, [], name);
    assert.deepEqual(harness.linkedReadCalls, [], name);
    assert.deepEqual(harness.writeCalls, [], name);
  }
});

test("only the committed open to in_progress transition is authorized", async () => {
  for (const [expectedQueueStatus, newQueueStatus] of [
    ["open", "open"],
    ["open", "blocked"],
    ["open", "waiting_on_client"],
    ["in_progress", "resolved"],
    ["blocked", "open"],
    ["waiting_on_client", "in_progress"],
    ["waiting_on_gk", "in_progress"],
    ["resolved", "open"],
    ["cancelled", "open"],
  ]) {
    const harness = createHarness();
    const result = await runService(harness, { expectedQueueStatus, newQueueStatus });
    assert.equal(result.ok, false, `${expectedQueueStatus}->${newQueueStatus}`);
    assert.equal(result.error.code, "state_transition_denied", `${expectedQueueStatus}->${newQueueStatus}`);
    assert.deepEqual(harness.queueReadCalls, [], `${expectedQueueStatus}->${newQueueStatus}`);
  }
});

test("missing or nondisclosable queue and linked target scopes return identical 404", async () => {
  const cases = [
    ["missing queue item", { storedQueueRow: null }],
    ["queue-item tenant mismatch", { storedQueueRow: { ...storedOpenRow, organization_id: otherOrganizationId } }],
    ["wrong queue type", { storedQueueRow: { ...storedOpenRow, queue_type: "source_candidate_review" } }],
    ["wrong target type", { storedQueueRow: { ...storedOpenRow, target_object_type: "intake_batch" } }],
    ["missing linked intake file", { linkedFileRow: null }],
    ["linked-file tenant mismatch", { linkedFileRow: { ...linkedFileRow, organization_id: otherOrganizationId } }],
  ];
  const results = [];

  for (const [name, overrides] of cases) {
    const harness = createHarness(overrides);
    const result = await runService(harness);
    results.push(result);
    assert.equal(result.ok, false, name);
    assert.equal(result.error.code, "not_found", name);
    assert.deepEqual(harness.writeCalls, [], name);
    assert.equal(harness.auditMetadata, null, name);
    assert.equal(harness.events.includes("METRIC"), false, name);
    assert.deepEqual(harness.fallbackCalls, [], name);
    assert.deepEqual(harness.linkedFileWrites, [], name);
  }

  for (const result of results.slice(1)) {
    assert.deepEqual(result, results[0]);
  }
});

test("open to in_progress performs scoped reads, scoped CAS, same-transaction audit, then metrics", async () => {
  const harness = createHarness();
  const linkedBefore = structuredClone(harness.linkedFileRow);
  const result = await runService(harness);

  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.data), reviewQueueKeys);
  assert.deepEqual(result.data, expectedDto);
  assert.deepEqual(harness.queueReadCalls, [{
    requestedOrganizationId: organizationId,
    requestedReviewQueueItemId: reviewQueueItemId,
    transactionContext: harness.transactionContext,
  }]);
  assert.deepEqual(harness.linkedReadCalls, [{
    requestedOrganizationId: organizationId,
    requestedIntakeFileId: intakeFileId,
    transactionContext: harness.transactionContext,
  }]);
  assert.deepEqual(harness.writeCalls, [{
    organizationId,
    reviewQueueItemId,
    expectedQueueStatus: "open",
    newQueueStatus: "in_progress",
  }]);
  assert.strictEqual(harness.writeContext, harness.transactionContext);
  assert.strictEqual(harness.auditContext, harness.transactionContext);
  assert.deepEqual(harness.events, [
    "BEGIN",
    "SCOPED_QUEUE_READ",
    "SCOPED_LINKED_FILE_READ",
    "SCOPED_CAS_WRITE",
    "REQUIRED_AUDIT",
    "COMMIT",
    "METRIC",
  ]);
  assert.equal(harness.events.indexOf("REQUIRED_AUDIT") > harness.events.indexOf("SCOPED_CAS_WRITE"), true);
  assert.equal(harness.events.indexOf("METRIC") > harness.events.indexOf("COMMIT"), true);
  assert.deepEqual(harness.linkedFileRow, linkedBefore);
  assert.deepEqual(harness.linkedFileWrites, []);
  assert.deepEqual(Object.keys(harness.auditMetadata), [
    "operation",
    "actor_user_id",
    "actor_type",
    "organization_id",
    "object_type",
    "target_object_type",
    "object_id",
    "validator_keys",
    "request_id",
    "route",
    "from_state",
    "to_state",
    "prior_status",
    "new_status",
    "created_at",
  ]);
  assert.equal(harness.auditMetadata.operation, "update_review_queue_status");
  assert.equal(harness.auditMetadata.object_type, "review_queue_item");
  assert.equal(harness.auditMetadata.target_object_type, "review_queue_item");
  assert.equal(harness.auditMetadata.object_id, reviewQueueItemId);
  assert.equal(harness.auditMetadata.prior_status, "open");
  assert.equal(harness.auditMetadata.new_status, "in_progress");
  assert.deepEqual(harness.metricContext, {
    metric_name: "kai.review_queue.status_updated",
    operation: "update_review_queue_status",
    actor_type: "human",
    object_type: "review_queue_item",
    outcome: "success",
    from_state: "open",
    to_state: "in_progress",
  });
  assertForbiddenSentinelsAbsent(result);
  assert.equal(JSON.stringify(harness.auditMetadata).includes("summary"), false);
  assert.equal(JSON.stringify(harness.auditMetadata).includes("required_action"), false);
});

test("stored-status mismatch and zero-row CAS both return conflict_current_state_changed", async () => {
  const mismatch = createHarness({ storedQueueRow: { ...storedOpenRow, queue_status: "in_progress" } });
  const mismatchResult = await runService(mismatch);
  assert.equal(mismatchResult.error.code, "conflict_current_state_changed");
  assert.deepEqual(mismatch.writeCalls, []);
  assert.equal(mismatch.auditMetadata, null);

  const stale = createHarness({ updatedQueueRow: null });
  const staleResult = await runService(stale);
  assert.equal(staleResult.error.code, "conflict_current_state_changed");
  assert.equal(stale.auditMetadata, null);
  assert.deepEqual(stale.events, [
    "BEGIN",
    "SCOPED_QUEUE_READ",
    "SCOPED_LINKED_FILE_READ",
    "SCOPED_CAS_WRITE",
    "ROLLBACK",
  ]);
});

test("post-write validation failures are safe 500 before audit with rollback and no partial DTO", async () => {
  const malformedRows = [
    ["malformed", { ...updatedInProgressRow, created_at: "not-a-date" }],
    ["wrong-tenant", { ...updatedInProgressRow, organization_id: otherOrganizationId }],
    ["wrong-target-type", { ...updatedInProgressRow, target_object_type: "intake_batch" }],
    ["wrong-target-id", { ...updatedInProgressRow, target_object_id: otherIntakeFileId }],
    ["wrong-status", { ...updatedInProgressRow, queue_status: "open" }],
    ["protected-field-changing", { ...updatedInProgressRow, priority: "urgent" }],
  ];

  for (const [name, updatedQueueRow] of malformedRows) {
    const harness = createHarness({ updatedQueueRow });
    const result = await runService(harness);
    assert.equal(result.ok, false, name);
    assert.equal(result.error.code, "system_error", name);
    assert.equal(Object.hasOwn(result, "data"), false, name);
    assert.equal(harness.auditMetadata, null, name);
    assert.equal(harness.events.includes("METRIC"), false, name);
    assert.deepEqual(harness.events, [
      "BEGIN",
      "SCOPED_QUEUE_READ",
      "SCOPED_LINKED_FILE_READ",
      "SCOPED_CAS_WRITE",
      "ROLLBACK",
    ], name);
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
    ["thrown persistence", () => { throw new Error("synthetic audit throw"); }],
    ["rejected persistence", () => Promise.reject(new Error("synthetic audit rejection"))],
    ["missing receipt", undefined],
    ["malformed receipt", { result: "ok" }],
    ["getter-backed ok", getterBacked],
    ["array carrying ok", Object.assign([], { ok: true })],
    ["non-boolean ok", { ok: "true" }],
    ["ok not true", { ok: false }],
  ]) {
    const harness = createHarness({ auditResult });
    const result = await runService(harness);
    assert.equal(result.ok, false, description);
    assert.equal(result.error.code, "system_error", description);
    assert.deepEqual(harness.events, [
      "BEGIN",
      "SCOPED_QUEUE_READ",
      "SCOPED_LINKED_FILE_READ",
      "SCOPED_CAS_WRITE",
      "REQUIRED_AUDIT",
      "ROLLBACK",
    ], description);
    assert.equal(harness.events.includes("METRIC"), false, description);
  }
  assert.equal(getterCalls, 0);
});

test("repository helpers are scoped and status-only", async () => {
  const calls = [];
  await getScopedIntakeFileReviewQueueItem(organizationId, reviewQueueItemId, {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [storedOpenRow] };
    },
  });
  await getScopedReviewQueueLinkedIntakeFile(organizationId, intakeFileId, {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [linkedFileRow] };
    },
  });
  await updateReviewQueueItemStatusIfCurrent({
    organizationId,
    reviewQueueItemId,
    expectedQueueStatus: "open",
    newQueueStatus: "in_progress",
  }, {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [updatedInProgressRow] };
    },
  });

  assert.match(calls[0].sql, /FROM kai\.review_queue_items/);
  assert.match(calls[0].sql, /WHERE organization_id = \$1\s+AND review_queue_item_id = \$2\s+AND queue_type = 'intake_file_review'\s+AND target_object_type = 'intake_file'/);
  assert.deepEqual(calls[0].params, [organizationId, reviewQueueItemId]);
  assert.match(calls[1].sql, /FROM kai\.intake_files/);
  assert.match(calls[1].sql, /WHERE organization_id = \$1\s+AND intake_file_id = \$2/);
  assert.doesNotMatch(calls[1].sql, /storage_|checksum|raw_content|file_metadata/);
  assert.match(calls[2].sql, /UPDATE kai\.review_queue_items/);
  assert.match(calls[2].sql, /SET queue_status = \$4/);
  assert.match(calls[2].sql, /AND queue_status = \$3/);
  assert.deepEqual(calls[2].params, [organizationId, reviewQueueItemId, "open", "in_progress"]);
  for (const forbidden of [
    "assigned_to",
    "blocked_reason",
    "summary =",
    "required_action =",
    "due_at =",
    "priority =",
    "queue_metadata",
    "intake_files SET",
  ]) {
    assert.doesNotMatch(calls[2].sql, new RegExp(forbidden));
  }
});

function scenarioDependencies(scenario) {
  const harness = createHarness({
    events: scenario.events,
    actorContext: undefined,
    storedQueueRow: scenario.storedQueueRow,
    linkedFileRow: scenario.linkedFileRow,
    updatedQueueRow: scenario.updatedQueueRow,
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
    storedQueueRow: storedOpenRow,
    linkedFileRow,
    updatedQueueRow: updatedInProgressRow,
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
    async updateReviewQueueStatus(input) {
      scenario.events.push("sprint2_review_queue_status_route_handler");
      const result = await updateReviewQueueStatus(input, scenarioDependencies(scenario));
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
      expected_queue_status: "open",
      new_queue_status: "in_progress",
    }));
    assert.equal(response.statusCode, 403);
    assert.equal(response.body.error.code, "feature_disabled");
    assert.deepEqual(scenario.events, []);
  });

  await t.test("authentication precedes service", async () => {
    scenario = createScenario({ authenticated: false });
    const response = await withFeatureFlag("true", () => postJson(server, routePath, {
      expected_queue_status: "open",
      new_queue_status: "in_progress",
    }));
    assert.equal(response.statusCode, 401);
    assert.equal(response.body.error.code, "unauthorized");
    assert.deepEqual(scenario.events, ["outer_feature_gate_passed", "canonical_http_authentication"]);
  });

  await t.test("canonical UUID and exact body failures return validation_blocker before service", async () => {
    for (const [path, body] of [
      [routePath.replace(reviewQueueItemId, reviewQueueItemId.toUpperCase()), {
        expected_queue_status: "open",
        new_queue_status: "in_progress",
      }],
      [routePath.replace(organizationId, "not-a-uuid"), {
        expected_queue_status: "open",
        new_queue_status: "in_progress",
      }],
      [routePath, {
        expected_queue_status: "open",
        new_queue_status: "in_progress",
        record_version: 1,
      }],
    ]) {
      scenario = createScenario();
      const response = await withFeatureFlag("true", () => postJson(server, path, body));
      assert.equal(response.statusCode, 422, path);
      assert.equal(response.body.error.code, "validation_blocker", path);
      assert.deepEqual(scenario.serviceResults, [], path);
    }
  });

  await t.test("reviewer and client roles are denied before reads", async () => {
    for (const role of ["gk_reviewer", "client_admin", "client_reviewer", "client_contributor"]) {
      scenario = createScenario({ globalRole: role, membershipRole: role });
      const response = await withFeatureFlag("true", () => postJson(server, routePath, {
        expected_queue_status: "open",
        new_queue_status: "in_progress",
      }));
      assert.equal(response.statusCode, 403, role);
      assert.equal(response.body.error.code, "authorization_denied", role);
      assert.equal(scenario.events.includes("SCOPED_QUEUE_READ"), false, role);
      assert.equal(scenario.events.includes("SCOPED_LINKED_FILE_READ"), false, role);
    }
  });

  await t.test("success returns the exact 12-field DTO and no forbidden sentinels", async () => {
    scenario = createScenario();
    const response = await withFeatureFlag("true", () => postJson(server, routePath, {
      expected_queue_status: "open",
      new_queue_status: "in_progress",
    }));
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { ok: true, data: expectedDto, warnings: [] });
    assert.deepEqual(Object.keys(response.body.data), reviewQueueKeys);
    assert.deepEqual(scenario.events, [
      "outer_feature_gate_passed",
      "canonical_http_authentication",
      "sprint2_review_queue_status_route_handler",
      "actor_mapping",
      "role_context_lookup",
      "membership_context_lookup",
      "BEGIN",
      "SCOPED_QUEUE_READ",
      "SCOPED_LINKED_FILE_READ",
      "SCOPED_CAS_WRITE",
      "REQUIRED_AUDIT",
      "COMMIT",
      "METRIC",
    ]);
    assertForbiddenSentinelsAbsent(response.body);
  });

  await t.test("already-transitioned HTTP request returns 409 without audit or metric", async () => {
    scenario = createScenario({ storedQueueRow: { ...storedOpenRow, queue_status: "in_progress" } });
    const response = await withFeatureFlag("true", () => postJson(server, routePath, {
      expected_queue_status: "open",
      new_queue_status: "in_progress",
    }));
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.error.code, "conflict_current_state_changed");
    assert.equal(scenario.events.includes("REQUIRED_AUDIT"), false);
    assert.equal(scenario.events.includes("METRIC"), false);
  });

  await t.test("open to blocked HTTP request returns state_transition_denied before reads", async () => {
    scenario = createScenario();
    const response = await withFeatureFlag("true", () => postJson(server, routePath, {
      expected_queue_status: "open",
      new_queue_status: "blocked",
    }));
    assert.equal(response.statusCode, 422);
    assert.equal(response.body.error.code, "state_transition_denied");
    assert.equal(scenario.events.includes("SCOPED_QUEUE_READ"), false);
  });
});
