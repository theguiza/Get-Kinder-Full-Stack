import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";

import express from "express";

import { requireKaiSprint2Enabled } from "../Backend/kai/config/kaiSprint2Config.js";
import * as intakeReadModels from "../Backend/kai/db/kaiReadModels.js";
import { getReviewCockpitIntakeFileSensitivityProfileRecord } from "../Backend/kai/db/kaiReviewCockpitReadModels.js";
import { requireKaiSprint2Authenticated } from "../Backend/kai/middleware/kaiSprint2Authentication.js";
import {
  handleKaiSprint2JsonParserError,
  kaiSprint2ActorMutationLimiter,
  kaiSprint2MetadataJsonParser,
  kaiSprint2OrganizationMutationLimiter,
  setKaiSprint2NoStore,
} from "../Backend/kai/middleware/kaiSprint2RequestSafety.js";
import sprint2IntakeApiRouter from "../Backend/kai/routes/sprint2IntakeApi.js";
import { getIntakeFileDetail, listIntakeFilesForBatch } from "../Backend/kai/services/kaiIntakeService.js";
import {
  getReviewCockpitIntakeFileSensitivityProfile,
  __testables as reviewCockpitTestables,
} from "../Backend/kai/services/kaiReviewCockpitService.js";
import {
  intakeFileSensitivityProfilePath,
  readIntakeFileSensitivityProfileId,
} from "../frontend/kaiWebIntakeLogic.js";
import {
  PIPELINE_REQUEST_STATUS,
  pipelineFileStatusText,
} from "../frontend/knowledgeStudio/clientEvidencePipelineLogic.js";

// Restricted intake DTO contracts (P0-04 batch-files and file-detail) and the
// GK-only file -> sensitivity-profile lookup that replaced the unauthorized
// p1_lifecycle expansion as the B1A-3B-R2 zero-queue discovery path.

const basePath = "/api/kai/sprint2/intake";
const ORG = "a5d17c5a-c55f-43af-9b21-fe63aafe733f";
const OTHER_ORG = "b5d17c5a-c55f-43af-9b21-fe63aafe733f";
const ENGAGEMENT = "2e426ea1-2be3-4e48-b80f-9783ddbacda0";
const BATCH = "8e426ea1-2be3-4e48-b80f-9783ddbacda0";
const FILE = "7e426ea1-2be3-4e48-b80f-9783ddbacda4";
const OTHER_FILE = "7e426ea1-2be3-4e48-b80f-9783ddbacda3";
const SENSITIVITY = "80000000-0000-4000-8000-000000000001";
const CREATED_AT = "2026-07-15T10:00:00.000Z";
const ENV = Object.freeze({ KAI_SPRINT2_ENABLED: "true" });

const FILE_SUMMARY_FIELDS = Object.freeze([
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
]);
const FILE_DETAIL_FIELDS = Object.freeze([...FILE_SUMMARY_FIELDS, "security_assessment"]);

// Every lifecycle column the removed expansion selected, plus a profile id
// sentinel: none may reach a restricted DTO even if a row carries it.
const LIFECYCLE_ROW_FIELDS = Object.freeze({
  parser_status: "completed",
  file_profile_complete: true,
  data_dictionary_complete: true,
  sensitivity_profile_complete: true,
  intake_sensitivity_profile_id: SENSITIVITY,
  p1_lifecycle: { automatic_stage: "complete" },
});

function fileRow(overrides = {}) {
  return {
    intake_file_id: FILE,
    intake_batch_id: BATCH,
    organization_id: ORG,
    engagement_id: ENGAGEMENT,
    safe_filename: "operator-safe.csv",
    mime_type: "text/csv",
    file_size_bytes: 321,
    file_policy_status: "passed",
    malware_scan_status: "passed",
    processing_status: "received",
    parse_status: "not_started",
    review_status: "proposed",
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    ...LIFECYCLE_ROW_FIELDS,
    ...overrides,
  };
}

function batchRow(overrides = {}) {
  return {
    intake_batch_id: BATCH,
    organization_id: ORG,
    engagement_id: ENGAGEMENT,
    batch_code: "BATCH-1",
    processing_status: "received",
    review_status: "proposed",
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    ...overrides,
  };
}

function humanActor({ kaiRoles = ["gk_reviewer"], organizationId = ORG, roleName = "gk_reviewer", membershipStatus = "active", actorType = "human" } = {}) {
  return {
    actorType,
    actorUserId: "7fe568b1-5c05-4c42-bb1f-6e20de216c7b",
    kaiRoles,
    organizationMemberships: [{ organization_id: organizationId, membership_status: membershipStatus, role_name: roleName }],
  };
}

function selectList(sql) {
  const start = sql.indexOf("SELECT") + "SELECT".length;
  return sql.slice(start, sql.indexOf("FROM", start)).split(",").map((column) => column.trim());
}

test("restricted intake read models select exactly the 14-field FileSummary from kai.intake_files only", async () => {
  const calls = [];
  const db = { async query(sql, params) { calls.push({ sql, params }); return { rows: [] }; } };

  await intakeReadModels.listIntakeFilesForBatch(ORG, BATCH, { limit: 25, cursor: null }, db);
  await intakeReadModels.getIntakeFileMetadata(ORG, FILE, db);

  for (const { sql } of calls) {
    assert.deepEqual(selectList(sql), FILE_SUMMARY_FIELDS);
    assert.match(sql, /FROM kai\.intake_files\s+WHERE organization_id = \$1/);
    assert.doesNotMatch(sql, /\bJOIN\b|intake_parser_runs|intake_file_profiles|data_dictionaries|intake_sensitivity_profiles|checksum/i);
  }
  assert.deepEqual(calls[0].params, [ORG, BATCH, 26]);
  assert.deepEqual(calls[1].params, [ORG, FILE]);
  assert.equal(Object.hasOwn(intakeReadModels, "getScopedIntakeFileP1Lifecycle"), false);
});

test("batch-files service returns exactly the FileSummary allowlist and never p1_lifecycle, even from a row carrying lifecycle columns", async () => {
  const result = await listIntakeFilesForBatch(
    { actorContext: humanActor({ kaiRoles: ["gk_operator"], roleName: "gk_operator" }), organizationId: ORG, intakeBatchId: BATCH, pagination: { limit: 2 } },
    {
      env: ENV,
      async getIntakeBatchDetail() { return batchRow(); },
      async listIntakeFilesForBatch() { return [fileRow(), fileRow({ intake_file_id: OTHER_FILE })]; },
    },
  );

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.items.length, 2);
  for (const item of result.data.items) {
    assert.deepEqual(Object.keys(item), FILE_SUMMARY_FIELDS);
  }
  const serialized = JSON.stringify(result);
  for (const field of Object.keys(LIFECYCLE_ROW_FIELDS)) assert.equal(serialized.includes(`"${field}"`), false, field);
  assert.equal(serialized.includes(SENSITIVITY), false);
});

test("batch-files cross-tenant parent is not_found with no child read", async () => {
  const childCalls = [];
  const result = await listIntakeFilesForBatch(
    { actorContext: humanActor({ kaiRoles: ["gk_operator"], roleName: "gk_operator" }), organizationId: ORG, intakeBatchId: BATCH, pagination: {} },
    {
      env: ENV,
      async getIntakeBatchDetail() { return batchRow({ organization_id: OTHER_ORG }); },
      async listIntakeFilesForBatch(...args) { childCalls.push(args); return [fileRow()]; },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
  assert.deepEqual(childCalls, []);
});

test("file-detail service returns exactly the 15-field allowlist, performs no lifecycle read, and never returns p1_lifecycle", async () => {
  const lifecycleCalls = [];
  const result = await getIntakeFileDetail(
    { actorContext: humanActor({ kaiRoles: [], roleName: "client_reviewer" }), organizationId: ORG, intakeFileId: FILE },
    {
      env: ENV,
      async getIntakeFileMetadata() { return fileRow(); },
      async getScopedLatestSecurityAssessmentAuditProjection() { return null; },
      async getScopedIntakeFileP1Lifecycle(...args) { lifecycleCalls.push(args); return fileRow(); },
    },
  );

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(Object.keys(result.data), FILE_DETAIL_FIELDS);
  assert.deepEqual(result.data.security_assessment, { category: null, policy_outcome: null });
  assert.deepEqual(lifecycleCalls, []);
  const serialized = JSON.stringify(result);
  for (const field of Object.keys(LIFECYCLE_ROW_FIELDS)) assert.equal(serialized.includes(`"${field}"`), false, field);
  assert.equal(serialized.includes(SENSITIVITY), false);
});

test("file-detail cross-tenant row is not_found", async () => {
  const result = await getIntakeFileDetail(
    { actorContext: humanActor({ kaiRoles: ["gk_operator"], roleName: "gk_operator" }), organizationId: ORG, intakeFileId: FILE },
    {
      env: ENV,
      async getIntakeFileMetadata() { return fileRow({ organization_id: OTHER_ORG }); },
      async getScopedLatestSecurityAssessmentAuditProjection() { return null; },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
});

test("GK file lookup read model is one organization-and-file-scoped, current-checksum-bound read that selects only identifiers", async () => {
  let call = null;
  const row = await getReviewCockpitIntakeFileSensitivityProfileRecord(ORG, FILE, {
    async query(sql, params) { call = { sql, params }; return { rows: [{ organization_id: ORG, intake_file_id: FILE, intake_sensitivity_profile_id: SENSITIVITY }] }; },
  });

  assert.deepEqual(row, { organization_id: ORG, intake_file_id: FILE, intake_sensitivity_profile_id: SENSITIVITY });
  assert.deepEqual(call.params, [ORG, FILE]);
  assert.match(call.sql, /WHERE f\.organization_id = \$1\s+AND f\.intake_file_id = \$2\s+LIMIT 1/);
  assert.match(call.sql, /pr\.checksum = f\.verified_checksum/);
  assert.match(call.sql, /r\.parser_status = 'completed'/);
  const outerSelect = call.sql.slice(0, call.sql.indexOf("FROM kai.intake_files f"));
  assert.match(outerSelect, /^SELECT f\.organization_id, f\.intake_file_id,/);
  assert.match(outerSelect, /END AS intake_sensitivity_profile_id\s*$/);
  for (const join of call.sql.matchAll(/JOIN[\s\S]*?(?=LEFT JOIN|WHERE f\.organization_id)/g)) {
    assert.match(join[0], /organization_id = f\.organization_id/);
  }
  assert.doesNotMatch(call.sql, /storage_|object_key|object_version|\.profile\b|sample|INSERT|UPDATE|DELETE/i);
});

function lookupDependencies(record, calls = []) {
  return {
    env: ENV,
    async getReviewCockpitIntakeFileSensitivityProfileRecord(...args) {
      calls.push(args);
      return typeof record === "function" ? record(...args) : record;
    },
  };
}

test("GK file lookup: an authorized same-tenant GK reviewer resolves the exact profile id with one scoped read", async () => {
  for (const role of ["gk_reviewer", "gk_operator", "gk_admin"]) {
    const calls = [];
    const result = await getReviewCockpitIntakeFileSensitivityProfile(
      { actorContext: humanActor({ kaiRoles: [role], roleName: role }), organizationId: ORG, intakeFileId: FILE },
      lookupDependencies({ organization_id: ORG, intake_file_id: FILE, intake_sensitivity_profile_id: SENSITIVITY }, calls),
    );
    assert.deepEqual(result, { ok: true, data: { intake_file_id: FILE, intake_sensitivity_profile_id: SENSITIVITY } }, role);
    assert.deepEqual(calls, [[ORG, FILE]], role);
  }
});

test("GK file lookup: a file without a complete profile returns null, never a fabricated id", async () => {
  const result = await getReviewCockpitIntakeFileSensitivityProfile(
    { actorContext: humanActor(), organizationId: ORG, intakeFileId: FILE },
    lookupDependencies({ organization_id: ORG, intake_file_id: FILE, intake_sensitivity_profile_id: null }),
  );
  assert.deepEqual(result, { ok: true, data: { intake_file_id: FILE, intake_sensitivity_profile_id: null } });
});

test("GK file lookup: missing, cross-tenant, and other-file rows are the same not_found; a malformed id fails closed", async () => {
  const outcomes = [];
  for (const record of [
    null,
    { organization_id: OTHER_ORG, intake_file_id: FILE, intake_sensitivity_profile_id: SENSITIVITY },
    { organization_id: ORG, intake_file_id: OTHER_FILE, intake_sensitivity_profile_id: SENSITIVITY },
  ]) {
    // eslint-disable-next-line no-await-in-loop
    const result = await getReviewCockpitIntakeFileSensitivityProfile(
      { actorContext: humanActor(), organizationId: ORG, intakeFileId: FILE },
      lookupDependencies(record),
    );
    assert.equal(JSON.stringify(result).includes(SENSITIVITY), false);
    outcomes.push(result);
  }
  assert.equal(outcomes[0].error.code, "not_found");
  assert.deepEqual(outcomes[1], outcomes[0]);
  assert.deepEqual(outcomes[2], outcomes[0]);

  const malformed = await getReviewCockpitIntakeFileSensitivityProfile(
    { actorContext: humanActor(), organizationId: ORG, intakeFileId: FILE },
    lookupDependencies({ organization_id: ORG, intake_file_id: FILE, intake_sensitivity_profile_id: "not-a-uuid" }),
  );
  assert.equal(malformed.error.code, "system_error");
});

test("GK file lookup: client roles, org-scoped-only GK roles, other-tenant or inactive membership, non-human actors, and a disabled feature are denied before any read", async () => {
  const cases = [
    ["client_admin member", humanActor({ kaiRoles: [], roleName: "client_admin" }), "authorization_denied"],
    ["client_reviewer member", humanActor({ kaiRoles: [], roleName: "client_reviewer" }), "authorization_denied"],
    ["client_contributor member", humanActor({ kaiRoles: [], roleName: "client_contributor" }), "authorization_denied"],
    ["gk_reviewer only as org role", humanActor({ kaiRoles: [], roleName: "gk_reviewer" }), "authorization_denied"],
    ["global gk_reviewer, other-tenant membership", humanActor({ organizationId: OTHER_ORG }), "authorization_denied"],
    ["global gk_reviewer, inactive membership", humanActor({ membershipStatus: "inactive" }), "authorization_denied"],
    ["ai actor", humanActor({ actorType: "ai" }), "authorization_denied"],
    ["internal service actor", humanActor({ actorType: "internal_service" }), "authorization_denied"],
  ];
  for (const [label, actorContext, code] of cases) {
    const calls = [];
    // eslint-disable-next-line no-await-in-loop
    const result = await getReviewCockpitIntakeFileSensitivityProfile(
      { actorContext, organizationId: ORG, intakeFileId: FILE },
      lookupDependencies({ organization_id: ORG, intake_file_id: FILE, intake_sensitivity_profile_id: SENSITIVITY }, calls),
    );
    assert.equal(result.ok, false, label);
    assert.equal(result.error.code, code, label);
    assert.deepEqual(calls, [], label);
  }

  const calls = [];
  const disabled = await getReviewCockpitIntakeFileSensitivityProfile(
    { actorContext: humanActor(), organizationId: ORG, intakeFileId: FILE },
    { ...lookupDependencies(null, calls), env: { KAI_SPRINT2_ENABLED: "false" } },
  );
  assert.equal(disabled.error.code, "feature_disabled");
  for (const [organizationId, intakeFileId] of [["not-a-uuid", FILE], [ORG, "not-a-uuid"], [ORG, FILE.toUpperCase()]]) {
    // eslint-disable-next-line no-await-in-loop
    const invalid = await getReviewCockpitIntakeFileSensitivityProfile(
      { actorContext: humanActor(), organizationId, intakeFileId },
      lookupDependencies(null, calls),
    );
    assert.equal(invalid.error.code, "invalid_request");
  }
  assert.deepEqual(calls, []);
});

// Assembled production middleware and router for the GK lookup route.
function createAssembledApplication(getScenario) {
  const app = express();
  app.use(basePath, setKaiSprint2NoStore, requireKaiSprint2Enabled, kaiSprint2MetadataJsonParser);
  app.use(basePath, handleKaiSprint2JsonParserError);
  app.use(basePath, (req, res, next) => {
    const scenario = getScenario();
    req.isAuthenticated = () => scenario.authenticated;
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

function scenarioDependencies(scenario) {
  return {
    env: ENV,
    async findOrCreateKaiUserByLegacyPublicUserdataId() {
      return { user_id: "7fe568b1-5c05-4c42-bb1f-6e20de216c7b", legacy_identity_source: "public.userdata", legacy_public_userdata_id: 46, status: "active" };
    },
    async listKaiRolesForUser() { return scenario.kaiRoles; },
    async listOrganizationMembershipsForUser() { return scenario.memberships; },
    async resolveEffectiveClientOrganizationMembershipsForLegacyUser() { return []; },
    async getReviewCockpitIntakeFileSensitivityProfileRecord(organizationId, intakeFileId) {
      scenario.repositoryCalls.push({ organizationId, intakeFileId });
      return scenario.record;
    },
  };
}

function createScenario(overrides = {}) {
  return {
    authenticated: true,
    kaiRoles: ["gk_reviewer"],
    memberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" }],
    record: { organization_id: ORG, intake_file_id: FILE, intake_sensitivity_profile_id: SENSITIVITY },
    repositoryCalls: [],
    ...overrides,
  };
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
    const request = http.request({ hostname: "127.0.0.1", port, path, method: "GET" }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ statusCode: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }));
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

test("assembled production middleware and router enforce the GK file sensitivity-profile lookup", async (t) => {
  let scenario = createScenario();
  const restore = reviewCockpitTestables.setReviewCockpitDependenciesForTest(scenarioDependencies(new Proxy({}, {
    get: (target, key) => scenario[key],
  })));
  const server = await listen(createAssembledApplication(() => scenario));
  t.after(async () => {
    restore();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });
  const path = (organizationId = ORG, intakeFileId = FILE) => intakeFileSensitivityProfilePath(organizationId, intakeFileId);

  await t.test("the frontend path is the mounted route", () => {
    assert.equal(path(), `${basePath}/admin/review-cockpit/intake-files/${FILE}/sensitivity-profile?organization_id=${ORG}`);
  });

  await t.test("authorized GK reviewer receives only the file id and profile id", async () => {
    scenario = createScenario();
    const response = await withFeatureFlag("true", () => getJson(server, path()));
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { ok: true, data: { intake_file_id: FILE, intake_sensitivity_profile_id: SENSITIVITY }, warnings: [] });
    assert.deepEqual(scenario.repositoryCalls, [{ organizationId: ORG, intakeFileId: FILE }]);
  });

  await t.test("feature disabled and unauthenticated requests stop before any read", async () => {
    scenario = createScenario();
    const disabled = await withFeatureFlag("false", () => getJson(server, path()));
    assert.equal(disabled.statusCode, 403);
    assert.equal(disabled.body.error.code, "feature_disabled");

    scenario = createScenario({ authenticated: false });
    const unauthenticated = await withFeatureFlag("true", () => getJson(server, path()));
    assert.equal(unauthenticated.statusCode, 401);
    assert.equal(unauthenticated.body.error.code, "unauthorized");
    assert.deepEqual(scenario.repositoryCalls, []);
  });

  await t.test("client roles and other-tenant GK reviewers are denied before any read", async () => {
    for (const overrides of [
      { kaiRoles: [], memberships: [{ organization_id: ORG, membership_status: "active", role_name: "client_admin" }] },
      { kaiRoles: [], memberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" }] },
      { memberships: [{ organization_id: OTHER_ORG, membership_status: "active", role_name: "gk_reviewer" }] },
    ]) {
      scenario = createScenario(overrides);
      // eslint-disable-next-line no-await-in-loop
      const response = await withFeatureFlag("true", () => getJson(server, path()));
      assert.equal(response.statusCode, 403);
      assert.equal(response.body.error.code, "authorization_denied");
      assert.deepEqual(scenario.repositoryCalls, []);
      assert.equal(JSON.stringify(response.body).includes(SENSITIVITY), false);
    }
  });

  await t.test("a cross-tenant row is an indistinguishable not_found", async () => {
    scenario = createScenario({ record: null });
    const missing = await withFeatureFlag("true", () => getJson(server, path()));
    scenario = createScenario({ record: { organization_id: OTHER_ORG, intake_file_id: FILE, intake_sensitivity_profile_id: SENSITIVITY } });
    const crossTenant = await withFeatureFlag("true", () => getJson(server, path()));
    assert.equal(missing.statusCode, 404);
    assert.deepEqual(crossTenant, missing);
  });

  await t.test("malformed identifiers stop before the service", async () => {
    for (const [organizationId, intakeFileId] of [["not-a-uuid", FILE], [ORG, "not-a-uuid"], [ORG, FILE.toUpperCase()]]) {
      scenario = createScenario();
      // eslint-disable-next-line no-await-in-loop
      const response = await withFeatureFlag("true", () => getJson(server, path(organizationId, intakeFileId)));
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.error.code, "invalid_request");
      assert.deepEqual(scenario.repositoryCalls, []);
    }
  });
});

test("frontend GK lookup reader reports only a server-grounded id for the requested file", async () => {
  const requested = [];
  const respond = (response) => async (path) => { requested.push(path); return response; };

  assert.equal(
    await readIntakeFileSensitivityProfileId({ organizationId: ORG, intakeFileId: FILE }, respond({ statusCode: 200, body: { ok: true, data: { intake_file_id: FILE, intake_sensitivity_profile_id: SENSITIVITY } } })),
    SENSITIVITY,
  );
  assert.deepEqual(requested, [intakeFileSensitivityProfilePath(ORG, FILE)]);
  for (const response of [
    { statusCode: 200, body: { ok: true, data: { intake_file_id: OTHER_FILE, intake_sensitivity_profile_id: SENSITIVITY } } },
    { statusCode: 200, body: { ok: true, data: { intake_file_id: FILE, intake_sensitivity_profile_id: null } } },
    { statusCode: 200, body: { ok: true, data: { intake_file_id: FILE, intake_sensitivity_profile_id: "not-a-uuid" } } },
    { statusCode: 403, body: { ok: false, error: { code: "authorization_denied" } } },
    { statusCode: 404, body: { ok: false, error: { code: "not_found" } } },
  ]) {
    // eslint-disable-next-line no-await-in-loop
    assert.equal(await readIntakeFileSensitivityProfileId({ organizationId: ORG, intakeFileId: FILE }, respond(response)), null);
  }
  assert.equal(
    await readIntakeFileSensitivityProfileId({ organizationId: ORG, intakeFileId: FILE }, async () => { throw new Error("network"); }),
    null,
  );
});

test("Files processing status comes from the client evidence-pipeline projection and is never inferred for an unlisted file", () => {
  const stages = ["upload", "security_check", "processing", "data_dictionary", "sensitivity_classification", "sensitivity_review", "source_review", "evidence_extraction", "evidence_review", "impact_fact_review"]
    .map((key, index) => ({ key, status: index < 3 ? "complete" : (index === 3 ? "in_progress" : "not_started"), responsible: index === 3 ? "kai" : "none", count: null, failureCategory: null }));
  const request = {
    status: PIPELINE_REQUEST_STATUS.SUCCESS_WITH_DATA,
    data: { files: [{ intakeFileId: FILE, stages, currentStage: "data_dictionary", currentStatus: "in_progress" }] },
  };

  assert.equal(pipelineFileStatusText(request, FILE), "Data dictionary: In progress");
  assert.equal(pipelineFileStatusText(request, FILE, "processing"), "Complete");
  assert.equal(pipelineFileStatusText(request, FILE, "sensitivity_classification"), "Not available yet");
  assert.equal(pipelineFileStatusText(request, OTHER_FILE), "not available");
  assert.equal(pipelineFileStatusText({ status: PIPELINE_REQUEST_STATUS.LOADING }, FILE), "loading");
  assert.equal(pipelineFileStatusText({ status: PIPELINE_REQUEST_STATUS.ERROR }, FILE), "unavailable");
  assert.equal(pipelineFileStatusText({ status: PIPELINE_REQUEST_STATUS.NOT_STARTED }, FILE), "not available");
});

test("Files keeps Processing & evidence status, KaiWebIntake reads no p1_lifecycle, and only the capability-gated GK mount opts in to discovery", () => {
  const intakeSource = readFileSync("frontend/KaiWebIntake.jsx", "utf8");
  const studioSource = readFileSync("frontend/knowledgeStudio/ClientKnowledgeStudio.jsx", "utf8");
  const dashboardSource = readFileSync("frontend/adminDashboard.jsx", "utf8");
  const librarySource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");

  assert.doesNotMatch(intakeSource, /p1_lifecycle/);
  assert.match(intakeSource, /useClientEvidencePipeline\(\s*organizationId,\s*processingStatus \? "" : engagementId,/);
  assert.match(intakeSource, /label="Current stage" value=\{pipelineFileStatusText\(pipeline, fileStatus\.intake_file_id\)\}/);
  assert.match(intakeSource, /\{item\.safe_filename\} &mdash; \{pipelineFileStatusText\(pipeline, item\.intake_file_id\)\}/);

  // The client Files tab keeps its Processing & evidence status panel and
  // shares its single pipeline read with KaiWebIntake.
  assert.match(studioSource, /<ClientEvidencePipelineStatus\s+request=\{pipeline\}/);
  assert.match(studioSource, /processingStatus=\{pipeline\}\s+onProcessingStatusRefresh=\{refreshPipeline\}/);
  assert.doesNotMatch(studioSource, /onSensitivityProfileDiscovered/);
  assert.match(dashboardSource, /<KaiWebIntake \/>/);
  assert.doesNotMatch(dashboardSource, /onSensitivityProfileDiscovered/);
  assert.match(librarySource, /sensitivityCapability === true \? handleSensitivityProfileDiscoveredFromIntake : undefined/);

  // A delayed lookup cannot report for a superseded file, organization, or lookup.
  const refreshRegion = intakeSource.slice(intakeSource.indexOf("const refreshFileStatus"), intakeSource.indexOf("const loadBatchFiles"));
  assert.match(refreshRegion, /lookupSeq !== sensitivityLookupSeqRef\.current\s+\|\| intakeFileIdRef\.current !== intakeFileId\s+\|\| organizationIdRef\.current !== organizationId/);
  assert.match(intakeSource, /intakeFileIdRef\.current = intakeFileId;/);
  assert.match(intakeSource, /organizationIdRef\.current = organizationId;/);
});
