import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import express from "express";

import { requireKaiSprint2Enabled } from "../Backend/kai/config/kaiSprint2Config.js";
import {
  getIntakeFileMetadata as readIntakeFileMetadata,
  getScopedLatestSecurityAssessmentAuditProjection as readLatestSecurityAssessmentAuditProjection,
} from "../Backend/kai/db/kaiReadModels.js";
import { buildKaiError } from "../Backend/kai/errors/kaiErrors.js";
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
import { getIntakeFileDetail } from "../Backend/kai/services/kaiIntakeService.js";

const basePath = "/api/kai/sprint2/intake";
const organizationId = "a5d17c5a-c55f-43af-9b21-fe63aafe733f";
const otherOrganizationId = "b5d17c5a-c55f-43af-9b21-fe63aafe733f";
const engagementId = "2e426ea1-2be3-4e48-b80f-9783ddbacda0";
const intakeBatchId = "8e426ea1-2be3-4e48-b80f-9783ddbacda0";
const intakeFileId = "7e426ea1-2be3-4e48-b80f-9783ddbacda4";
const otherIntakeFileId = "7e426ea1-2be3-4e48-b80f-9783ddbacda3";

const fileDetailKeys = Object.freeze([
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
  "security_assessment",
].sort());

const forbiddenRowSentinels = Object.freeze({
  storage_provider: "storage-provider-sentinel",
  storage_bucket: "storage-bucket-sentinel",
  storage_object_key: "storage-object-key-sentinel",
  storage_uri: "storage-uri-sentinel",
  signed_url: "signed-url-sentinel",
  file_extension: ".forbidden-sentinel",
  checksum: "checksum-sentinel",
  hash_algorithm: "hash-algorithm-sentinel",
  metadata: Object.freeze({ marker: "unrestricted-metadata-sentinel" }),
  raw_content: "raw-content-sentinel",
  credentials: Object.freeze({ token: "credentials-sentinel" }),
  actor_context: Object.freeze({ marker: "actor-context-sentinel" }),
  membership_context: Object.freeze({ marker: "membership-context-sentinel" }),
  client_data: Object.freeze({ marker: "client-data-sentinel" }),
  unapproved_pii: Object.freeze({ marker: "unapproved-pii-sentinel" }),
});

const safeFileRow = Object.freeze({
  intake_file_id: intakeFileId,
  intake_batch_id: intakeBatchId,
  organization_id: organizationId,
  engagement_id: engagementId,
  safe_filename: "operator-safe.csv",
  mime_type: "text/csv",
  file_size_bytes: 321,
  file_policy_status: "pending",
  malware_scan_status: "pending",
  processing_status: "received",
  parse_status: "not_started",
  review_status: "proposed",
  created_at: "2026-07-15T10:00:00.000Z",
  updated_at: "2026-07-15T11:00:00.000Z",
  ...forbiddenRowSentinels,
});

const expectedFileDto = Object.freeze({
  intake_file_id: intakeFileId,
  intake_batch_id: intakeBatchId,
  organization_id: organizationId,
  engagement_id: engagementId,
  safe_filename: "operator-safe.csv",
  mime_type: "text/csv",
  file_size_bytes: 321,
  file_policy_status: "pending",
  malware_scan_status: "pending",
  processing_status: "received",
  parse_status: "not_started",
  review_status: "proposed",
  created_at: "2026-07-15T10:00:00.000Z",
  updated_at: "2026-07-15T11:00:00.000Z",
  security_assessment: { category: null, policy_outcome: null },
});

const crossTenantFileRow = Object.freeze({
  ...safeFileRow,
  organization_id: otherOrganizationId,
});

const mismatchedFileRow = Object.freeze({
  ...safeFileRow,
  intake_file_id: otherIntakeFileId,
});

const readActorContext = Object.freeze({
  actorType: "human",
  actorUserId: "7fe568b1-5c05-4c42-bb1f-6e20de216c7b",
  kaiRoles: ["gk_operator"],
  organizationMemberships: [
    { organization_id: organizationId, role_name: "gk_operator", membership_status: "active" },
  ],
});

function assertForbiddenSentinelsAbsent(value) {
  const serialized = JSON.stringify(value);
  for (const [field, sentinel] of Object.entries(forbiddenRowSentinels)) {
    const marker = typeof sentinel === "string" ? sentinel : Object.values(sentinel)[0];
    assert.equal(serialized.includes(`\"${field}\"`), false, field);
    assert.equal(serialized.includes(marker), false, marker);
  }
}

function tracedMembership(scenario, {
  membershipStatus = "active",
  roleName = "gk_operator",
} = {}) {
  return Object.defineProperties({}, {
    organization_id: {
      enumerable: true,
      get() {
        scenario.events.push("tenant_membership_scope_check");
        return organizationId;
      },
    },
    membership_status: {
      enumerable: true,
      get() {
        scenario.events.push("active_membership_check");
        return membershipStatus;
      },
    },
    role_name: {
      enumerable: true,
      get() {
        scenario.events.push("allowed_role_check");
        return roleName;
      },
    },
  });
}

function scenarioDependencies(scenario) {
  return {
    env: { KAI_SPRINT2_ENABLED: "true" },
    async findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: legacyId }) {
      scenario.events.push("actor_mapping");
      assert.equal(legacyId, 46);
      return {
        user_id: "7fe568b1-5c05-4c42-bb1f-6e20de216c7b",
        legacy_identity_source: "public.userdata",
        legacy_public_userdata_id: 46,
        status: "active",
      };
    },
    async listKaiRolesForUser() {
      scenario.events.push("role_context_lookup");
      return ["gk_operator"];
    },
    async resolveEffectiveClientOrganizationMembershipsForLegacyUser() {
      return [];
    },
    async listOrganizationMembershipsForUser() {
      scenario.events.push("membership_context_lookup");
      if (scenario.membershipState === "missing") return [];
      return [tracedMembership(scenario, {
        membershipStatus: scenario.membershipState === "inactive" ? "inactive" : "active",
        roleName: scenario.roleName,
      })];
    },
    async getIntakeFileMetadata(requestedOrganizationId, requestedIntakeFileId) {
      scenario.events.push("tenant_scoped_repository_read");
      scenario.repositoryCalls.push({
        organizationId: requestedOrganizationId,
        intakeFileId: requestedIntakeFileId,
      });
      return scenario.repositoryRow;
    },
    async getIntakeFileById() {
      scenario.fallbackCalls.push("id_only");
      throw new Error("ID-only fallback must not execute");
    },
    async getScopedLatestSecurityAssessmentAuditProjection() {
      return null;
    },
  };
}

function createScenario(overrides = {}) {
  return {
    authenticated: true,
    events: [],
    fallbackCalls: [],
    membershipState: "active",
    repositoryCalls: [],
    repositoryRow: safeFileRow,
    roleName: "gk_operator",
    serviceResults: [],
    ...overrides,
  };
}

function createAssembledApplication(getScenario) {
  const app = express();

  app.use(
    basePath,
    setKaiSprint2NoStore,
    requireKaiSprint2Enabled,
    kaiSprint2MetadataJsonParser,
  );
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

async function getJson(server, path) {
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
      response.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve({ statusCode: response.statusCode, body: JSON.parse(raw) });
      });
    });
    request.on("error", reject);
    request.end();
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

function validPath(fileId = intakeFileId) {
  return `${basePath}/admin/files/${fileId}?organization_id=${organizationId}`;
}

test("the file-detail read model selects only the DTO from one tenant-and-file-scoped lookup", async () => {
  let queryCall = null;
  const row = await readIntakeFileMetadata(organizationId, intakeFileId, {
    async query(sql, params) {
      queryCall = { sql, params };
      return { rows: [safeFileRow] };
    },
  });

  assert.equal(row, safeFileRow);
  assert.match(queryCall.sql, /WHERE organization_id = \$1\s+AND intake_file_id = \$2/);
  assert.match(queryCall.sql, /LIMIT 1/);
  assert.deepEqual(queryCall.params, [organizationId, intakeFileId]);
  for (const forbiddenField of Object.keys(forbiddenRowSentinels)) {
    assert.doesNotMatch(queryCall.sql, new RegExp(`\\b${forbiddenField}\\b`), forbiddenField);
  }
});

test("the security-assessment audit projection read model is organization-and-file scoped, explicit-column only", async () => {
  let queryCall = null;
  const row = await readLatestSecurityAssessmentAuditProjection(organizationId, intakeFileId, {
    async query(sql, params) {
      queryCall = { sql, params };
      return { rows: [{ action: "apply_security_assessment_policy_decision", reason_code: "passed", assessment_category: null }] };
    },
  });

  assert.deepEqual(row, { action: "apply_security_assessment_policy_decision", reason_code: "passed", assessment_category: null });
  assert.match(queryCall.sql, /WHERE organization_id = \$1/);
  assert.match(queryCall.sql, /metadata->>'object_id' = \$2/);
  assert.match(queryCall.sql, /LIMIT 1/);
  assert.deepEqual(queryCall.params, [organizationId, intakeFileId, [
    "apply_security_assessment_policy_decision",
    "record_security_assessment_diagnostic",
  ]]);
  assert.doesNotMatch(queryCall.sql, /SELECT \*/);
  assert.doesNotMatch(queryCall.sql, /\bmetadata\b(?!->>)/);
});

test("a cross-tenant organization_id can never retrieve another organization's security-assessment audit projection", async () => {
  const otherOrgProjectionRow = { action: "apply_security_assessment_policy_decision", reason_code: "blocked", assessment_category: "malware_failed" };
  const result = await getIntakeFileDetail(
    { actorContext: readActorContext, organizationId, intakeFileId },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      async getIntakeFileMetadata() {
        return safeFileRow;
      },
      async getScopedLatestSecurityAssessmentAuditProjection(requestedOrganizationId) {
        // Simulates a tenant-scoped repository: a mismatched organization_id yields nothing.
        return requestedOrganizationId === organizationId ? null : otherOrgProjectionRow;
      },
    },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.data.security_assessment, { category: null, policy_outcome: null });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("malware_failed"), false);
});

test("the direct file-detail service returns exactly the 15-field allowlist", async () => {
  const repositoryCalls = [];
  const result = await getIntakeFileDetail(
    { actorContext: readActorContext, organizationId, intakeFileId },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      async getIntakeFileMetadata(requestedOrganizationId, requestedIntakeFileId) {
        repositoryCalls.push({ requestedOrganizationId, requestedIntakeFileId });
        return safeFileRow;
      },
      async getScopedLatestSecurityAssessmentAuditProjection() {
        return null;
      },
    },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.data, expectedFileDto);
  assert.deepEqual(Object.keys(result.data).sort(), fileDetailKeys);
  assert.deepEqual(repositoryCalls, [{
    requestedOrganizationId: organizationId,
    requestedIntakeFileId: intakeFileId,
  }]);
  assertForbiddenSentinelsAbsent(result);
});

test("a persisted policy-decision audit row projects category and policy_outcome onto security_assessment", async () => {
  const projectionCalls = [];
  const result = await getIntakeFileDetail(
    { actorContext: readActorContext, organizationId, intakeFileId },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      async getIntakeFileMetadata() {
        return safeFileRow;
      },
      async getScopedLatestSecurityAssessmentAuditProjection(requestedOrganizationId, requestedIntakeFileId) {
        projectionCalls.push({ requestedOrganizationId, requestedIntakeFileId });
        return { action: "apply_security_assessment_policy_decision", reason_code: "failed", assessment_category: "malware_scan_failed" };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.data.security_assessment, { category: "malware_scan_failed", policy_outcome: "failed" });
  assert.deepEqual(projectionCalls, [{ requestedOrganizationId: organizationId, requestedIntakeFileId: intakeFileId }]);
});

test("a diagnostic-only audit row (no policy mutation) projects category with a null policy_outcome", async () => {
  const result = await getIntakeFileDetail(
    { actorContext: readActorContext, organizationId, intakeFileId },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      async getIntakeFileMetadata() {
        return safeFileRow;
      },
      async getScopedLatestSecurityAssessmentAuditProjection() {
        return { action: "record_security_assessment_diagnostic", reason_code: "no_policy_decision", assessment_category: "malware_scan_not_configured" };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.data.security_assessment, { category: "malware_scan_not_configured", policy_outcome: null });
});

test("a projection read failure never blocks the file-detail response and defaults security_assessment to null/null", async () => {
  const result = await getIntakeFileDetail(
    { actorContext: readActorContext, organizationId, intakeFileId },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      async getIntakeFileMetadata() {
        return safeFileRow;
      },
      async getScopedLatestSecurityAssessmentAuditProjection() {
        throw new Error("synthetic projection read failure");
      },
    },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.data.security_assessment, { category: null, policy_outcome: null });
});

test("the security_assessment projection response never exposes raw audit metadata, actor, or storage fields", async () => {
  const result = await getIntakeFileDetail(
    { actorContext: readActorContext, organizationId, intakeFileId },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      async getIntakeFileMetadata() {
        return safeFileRow;
      },
      async getScopedLatestSecurityAssessmentAuditProjection() {
        return {
          action: "apply_security_assessment_policy_decision",
          reason_code: "blocked",
          assessment_category: "malware_failed",
          // A read model that leaked extra columns must still not surface them.
          actor_user_id: "actor-sentinel",
          metadata: { storage_object_key: "storage-object-key-sentinel", raw_error: "raw-error-sentinel" },
        };
      },
    },
  );

  assert.deepEqual(Object.keys(result.data.security_assessment).sort(), ["category", "policy_outcome"]);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("actor-sentinel"), false);
  assert.equal(serialized.includes("storage-object-key-sentinel"), false);
  assert.equal(serialized.includes("raw-error-sentinel"), false);
});

test("canonical file UUID validation rejects malformed, uppercase, and padded values before reads", async () => {
  for (const invalidIntakeFileId of [
    "not-a-uuid",
    intakeFileId.toUpperCase(),
    ` ${intakeFileId}`,
    `${intakeFileId} `,
  ]) {
    const repositoryCalls = [];
    const result = await getIntakeFileDetail(
      { actorContext: readActorContext, organizationId, intakeFileId: invalidIntakeFileId },
      {
        env: { KAI_SPRINT2_ENABLED: "true" },
        async getIntakeFileMetadata(...args) {
          repositoryCalls.push(args);
          return safeFileRow;
        },
      },
    );

    assert.deepEqual(result, buildKaiError("invalid_request"), invalidIntakeFileId);
    assert.deepEqual(repositoryCalls, [], invalidIntakeFileId);
  }
});

test("no row, tenant mismatch, and returned-ID mismatch share the canonical 404 without fallback", async () => {
  async function run(repositoryRow) {
    const calls = [];
    const result = await getIntakeFileDetail(
      { actorContext: readActorContext, organizationId, intakeFileId },
      {
        env: { KAI_SPRINT2_ENABLED: "true" },
        async getIntakeFileMetadata(...args) {
          calls.push(args);
          return repositoryRow;
        },
        async getIntakeFileById() {
          throw new Error("ID-only fallback must not execute");
        },
      },
    );
    return { calls, result };
  }

  const missing = await run(null);
  const tenantMismatch = await run(crossTenantFileRow);
  const idMismatch = await run(mismatchedFileRow);
  const canonicalNotFound = buildKaiError("not_found");

  assert.deepEqual(missing.result, canonicalNotFound);
  assert.deepEqual(tenantMismatch.result, canonicalNotFound);
  assert.deepEqual(idMismatch.result, canonicalNotFound);
  assert.deepEqual(tenantMismatch.result, missing.result);
  assert.deepEqual(missing.calls, [[organizationId, intakeFileId]]);
  assert.deepEqual(tenantMismatch.calls, missing.calls);
  assert.deepEqual(idMismatch.calls, missing.calls);

  const serialized = JSON.stringify([missing.result, tenantMismatch.result, idMismatch.result]);
  for (const forbiddenValue of [
    organizationId,
    otherOrganizationId,
    intakeFileId,
    otherIntakeFileId,
    "tenant_boundary_violation",
  ]) {
    assert.equal(serialized.includes(forbiddenValue), false, forbiddenValue);
  }
  assertForbiddenSentinelsAbsent(tenantMismatch.result);
});

test("read_intake role and active membership are required before the file lookup", async () => {
  for (const actorContext of [
    {
      ...readActorContext,
      organizationMemberships: [
        { organization_id: organizationId, role_name: "external_viewer", membership_status: "active" },
      ],
    },
    { ...readActorContext, organizationMemberships: [] },
    {
      ...readActorContext,
      organizationMemberships: [
        { organization_id: organizationId, role_name: "gk_operator", membership_status: "inactive" },
      ],
    },
  ]) {
    const repositoryCalls = [];
    const result = await getIntakeFileDetail(
      { actorContext, organizationId, intakeFileId },
      {
        env: { KAI_SPRINT2_ENABLED: "true" },
        async getIntakeFileMetadata(...args) {
          repositoryCalls.push(args);
          return safeFileRow;
        },
      },
    );

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "authorization_denied");
    assert.deepEqual(repositoryCalls, []);
  }
});

test("assembled production middleware and router enforce the file-detail contract", async (t) => {
  let scenario = createScenario();
  const restoreService = intakeRouteTestables.setIntakeServiceForTest({
    async getIntakeFileDetail(input) {
      scenario.events.push("sprint2_file_detail_route_handler");
      const result = await getIntakeFileDetail(input, scenarioDependencies(scenario));
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

  await t.test("feature gate precedes authentication, service, and repository reads", async () => {
    scenario = createScenario();
    const response = await withFeatureFlag("false", () => getJson(server, validPath()));

    assert.equal(response.statusCode, 403);
    assert.equal(response.body.error.code, "feature_disabled");
    assert.deepEqual(scenario.events, []);
    assert.deepEqual(scenario.repositoryCalls, []);
  });

  await t.test("canonical authentication precedes the service and repository read", async () => {
    scenario = createScenario({ authenticated: false });
    const response = await withFeatureFlag("true", () => getJson(server, validPath()));

    assert.equal(response.statusCode, 401);
    assert.equal(response.body.error.code, "unauthorized");
    assert.deepEqual(scenario.events, [
      "outer_feature_gate_passed",
      "canonical_http_authentication",
    ]);
    assert.deepEqual(scenario.repositoryCalls, []);
  });

  await t.test("noncanonical and malformed file IDs stop before service and repository reads", async () => {
    for (const fileId of ["not-a-uuid", intakeFileId.toUpperCase()]) {
      scenario = createScenario();
      const response = await withFeatureFlag("true", () => getJson(server, validPath(fileId)));

      assert.equal(response.statusCode, 400, fileId);
      assert.equal(response.body.error.code, "invalid_request", fileId);
      assert.deepEqual(scenario.serviceResults, [], fileId);
      assert.deepEqual(scenario.repositoryCalls, [], fileId);
    }
  });

  await t.test("role and active-membership failures perform no repository read", async () => {
    for (const overrides of [
      { roleName: "external_viewer" },
      { membershipState: "missing" },
      { membershipState: "inactive" },
    ]) {
      scenario = createScenario(overrides);
      const response = await withFeatureFlag("true", () => getJson(server, validPath()));

      assert.equal(response.statusCode, 403);
      assert.equal(response.body.error.code, "authorization_denied");
      assert.deepEqual(scenario.repositoryCalls, []);
    }
  });

  await t.test("missing and cross-tenant rows have identical canonical 404 responses", async () => {
    scenario = createScenario({ repositoryRow: null });
    const missingResponse = await withFeatureFlag("true", () => getJson(server, validPath()));
    const missingResult = scenario.serviceResults[0];
    const missingCalls = scenario.repositoryCalls;

    scenario = createScenario({ repositoryRow: crossTenantFileRow });
    const mismatchResponse = await withFeatureFlag("true", () => getJson(server, validPath()));
    const mismatchResult = scenario.serviceResults[0];

    assert.equal(missingResponse.statusCode, 404);
    assert.equal(mismatchResponse.statusCode, 404);
    assert.deepEqual(mismatchResult, missingResult);
    assert.deepEqual(mismatchResponse.body, missingResponse.body);
    assert.deepEqual(missingCalls, [{ organizationId, intakeFileId }]);
    assert.deepEqual(scenario.repositoryCalls, missingCalls);
    assert.deepEqual(scenario.fallbackCalls, []);

    const serialized = JSON.stringify([mismatchResult, mismatchResponse.body]);
    for (const forbiddenValue of [
      organizationId,
      otherOrganizationId,
      intakeFileId,
      "tenant_boundary_violation",
    ]) {
      assert.equal(serialized.includes(forbiddenValue), false, forbiddenValue);
    }
  });

  await t.test("success performs one scoped read after all controls and returns only the DTO", async () => {
    scenario = createScenario();
    const response = await withFeatureFlag("true", () => getJson(server, validPath()));

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, {
      ok: true,
      data: expectedFileDto,
      warnings: [],
    });
    assert.deepEqual(Object.keys(response.body.data).sort(), fileDetailKeys);
    assert.deepEqual(scenario.repositoryCalls, [{ organizationId, intakeFileId }]);
    assert.deepEqual(scenario.fallbackCalls, []);
    assert.deepEqual(scenario.events, [
      "outer_feature_gate_passed",
      "canonical_http_authentication",
      "sprint2_file_detail_route_handler",
      "actor_mapping",
      "role_context_lookup",
      "membership_context_lookup",
      "tenant_membership_scope_check",
      "active_membership_check",
      "allowed_role_check",
      "tenant_scoped_repository_read",
    ]);
    assertForbiddenSentinelsAbsent(response.body);
  });
});
