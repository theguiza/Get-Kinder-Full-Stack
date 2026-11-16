import test from "node:test";
import assert from "node:assert/strict";

import { STORED_ORGANIZATION_MEMBERSHIP_SOURCE } from "../Backend/kai/auth/kaiOrganizationMembershipSource.js";
import {
  getClaimTraceabilitySummary,
  listOrganizationInternalDraftDiagnostics,
  listedInternalUseDiagnostic,
} from "../Backend/kai/services/kaiClaimTraceabilityService.js";
import http from "node:http";
import express from "express";
import sprint2IntakeApiRouter, { __testables as intakeRouteTestables } from "../Backend/kai/routes/sprint2IntakeApi.js";
import { requireKaiSprint2Enabled } from "../Backend/kai/config/kaiSprint2Config.js";
import { requireKaiSprint2Authenticated } from "../Backend/kai/middleware/kaiSprint2Authentication.js";
import {
  handleKaiSprint2JsonParserError,
  kaiSprint2ActorMutationLimiter,
  kaiSprint2MetadataJsonParser,
  kaiSprint2OrganizationMutationLimiter,
  setKaiSprint2NoStore,
} from "../Backend/kai/middleware/kaiSprint2RequestSafety.js";
import {
  createPostgresClaimTraceabilityRepository,
  __claimTraceabilityRepositoryContract,
} from "../Backend/kai/dictionary/postgresClaimTraceabilityRepository.js";
import { CLAIM_INTERNAL_USE_BATCH_MAX, claimInternalUsePath } from "../frontend/impactEvidenceLibraryLogic.js";
import { claimUseDiagnosis, listedClaimDiagnostics } from "../frontend/knowledgeStudio/clientEvidenceWorkflowLogic.js";

/**
 * Owner direction 2026-11-16: the internal-use answers (the organization
 * administrator's client-safe P2-06 diagnostic and provisional internal draft
 * admission) of a claims page come from ONE batch request evaluated in one
 * read-only transaction, instead of the Knowledge Studio reading the
 * traceability route once per claim. The claims list itself is never held
 * for that evaluation.
 *
 * Synthetic fixtures only. Real: authorization, the traceability service and
 * its response shaping, the claim library service and the client projection.
 * Injected: the repositories and, for the repository batch, the transaction.
 */

const ENV = Object.freeze({ KAI_SPRINT2_ENABLED: "true" });
const ORG = "11111111-2222-4333-8444-555555555555";
const OTHER_ORG = "99999999-8888-4777-8666-555555555555";
const USER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const claimId = (n) => `3d000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function actor(roleName, { organizationId = ORG, source = STORED_ORGANIZATION_MEMBERSHIP_SOURCE } = {}) {
  return {
    actorType: "human", actorUserId: USER, kaiRoles: [], platformSuperuser: false,
    organizationMemberships: [{ organization_id: organizationId, role_name: roleName, membership_status: "active", ...(source ? { source } : {}) }],
  };
}
const ADMIN = actor("client_admin");

// One repository answering both the single read and the batch from the same
// per-claim results, so the two paths can be compared directly.
const RESULTS = new Map([
  [claimId(1), { ok: true, data: { eligible: true, blockerCodes: [] }, error: null, provisionalInternalDraft: { admitted: true, blockerCodes: [], sourceRole: "primary" } }],
  [claimId(2), { ok: true, data: { eligible: false, blockerCodes: ["claim_review_unresolved"] }, error: null, provisionalInternalDraft: { admitted: false, blockerCodes: ["ai_processing_not_permitted"], sourceRole: null } }],
  [claimId(3), { ok: false, data: null, error: { code: "conflict_current_state_changed", status: 409, reason: "source_version_not_current" } }],
  [claimId(4), { ok: false, data: null, error: { code: "conflict_current_state_changed", status: 409, reason: "not_an_allowlisted_reason" } }],
  [claimId(5), { ok: false, data: null, error: { code: "system_error", status: 500 } }],
  [claimId(8), { ok: true, data: { eligible: true, blockerCodes: [] }, error: null, provisionalInternalDraft: { admitted: true, blockerCodes: [], sourceRole: null } }],
]);
function repository() {
  const calls = { single: [], batch: [] };
  return {
    calls,
    async getOrganizationInternalDraftDiagnostic(input) { calls.single.push(input); return RESULTS.get(input.claimId); },
    async getOrganizationInternalDraftDiagnostics(input) {
      calls.batch.push(input);
      return { ok: true, data: { items: input.claimIds.map((id) => ({ claimId: id, result: RESULTS.get(id) })) }, error: null };
    },
    async getClaimTraceabilitySummary() { throw new Error("the organization diagnostic reads the combined form"); },
  };
}

test("the listed answer for each claim is exactly the per-claim route's answer: success, admission, allowlisted conflict, unexplained conflict, failure", async () => {
  const ids = [...RESULTS.keys()];
  const repo = repository();
  const batch = await listOrganizationInternalDraftDiagnostics({ organizationId: ORG, claimIds: ids, actorContext: ADMIN }, { env: ENV, claimTraceabilityRepository: repo });
  assert.equal(batch.ok, true, JSON.stringify(batch));
  assert.deepEqual(repo.calls.batch, [{ organizationId: ORG, claimIds: ids, requestedAudience: "internal" }], "one batch read, internal only");
  assert.deepEqual(batch.data.items.map((item) => item.claimId), ids, "in the requested order");
  for (const [index, id] of ids.entries()) {
    const single = await getClaimTraceabilitySummary({ organizationId: ORG, claimId: id, requestedAudience: "internal", actorContext: ADMIN },
      { env: ENV, claimTraceabilityRepository: repository() });
    assert.deepEqual(batch.data.items[index].response, single, id);
  }
  const [admitted, refused, conflict, unexplained, failed] = batch.data.items.map((item) => item.response);
  assert.deepEqual(admitted.data.provisional_internal_draft, { admitted: true, blocker_codes: [], source_role: "primary" });
  assert.deepEqual([refused.data.eligible, refused.data.blocker_codes, refused.data.provisional_internal_draft.blocker_codes],
    [false, ["claim_review_unresolved"], ["ai_processing_not_permitted"]]);
  assert.deepEqual([conflict.error.status, conflict.data], [409, { traceability_conflict_reason: "source_version_not_current" }]);
  assert.equal(unexplained.data, undefined, "an unexplained reason is never disclosed");
  assert.deepEqual([failed.ok, failed.error.code], [false, "system_error"]);
});

test("only an organization administrator of this organization gets the batch; nothing is read for anyone else", async () => {
  const refusals = [
    ["contributor", actor("client_contributor")],
    ["client reviewer", actor("client_reviewer")],
    ["administrator of another organization", actor("client_admin", { organizationId: OTHER_ORG })],
    ["Get Kinder reviewer (full DTO, never the batch)", actor("gk_reviewer", { source: null })],
    ["service actor", { ...ADMIN, actorType: "system" }],
  ];
  for (const [label, actorContext] of refusals) {
    const repo = repository();
    const result = await listOrganizationInternalDraftDiagnostics({ organizationId: ORG, claimIds: [claimId(1)], actorContext }, { env: ENV, claimTraceabilityRepository: repo });
    assert.equal(result.ok, false, label);
    assert.equal(result.error.code, "authorization_denied", label);
    assert.deepEqual(repo.calls.batch, [], `${label}: nothing read`);
  }
  const disabled = await listOrganizationInternalDraftDiagnostics({ organizationId: ORG, claimIds: [claimId(1)], actorContext: ADMIN }, { env: {}, claimTraceabilityRepository: repository() });
  assert.equal(disabled.error.code, "feature_disabled");
  for (const claimIds of [[claimId(1), claimId(1)], "x", [""]]) {
    const invalid = await listOrganizationInternalDraftDiagnostics({ organizationId: ORG, claimIds, actorContext: ADMIN }, { env: ENV, claimTraceabilityRepository: repository() });
    assert.equal(invalid.error.code, "validation_blocker", JSON.stringify(claimIds));
  }
  const repo = repository();
  const empty = await listOrganizationInternalDraftDiagnostics({ organizationId: ORG, claimIds: [], actorContext: ADMIN }, { env: ENV, claimTraceabilityRepository: repo });
  assert.deepEqual([empty.ok, empty.data.items, repo.calls.batch], [true, [], []], "an empty page reads nothing");
});

// The mounted batch route, with the real traceability service over the injected repository.
async function withRouteServer(t, getScenario) {
  const basePath = "/api/kai/sprint2/intake";
  const originalFeatureFlag = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "true";
  const restore = intakeRouteTestables.setIntakeServiceForTest({
    async getClaimTraceabilitySummary() { throw new Error("the batch route never reads one claim"); },
    async listOrganizationInternalDraftDiagnostics(input) {
      const scenario = getScenario();
      scenario.serviceCalls += 1;
      return listOrganizationInternalDraftDiagnostics(input, { env: process.env, claimTraceabilityRepository: scenario.repository });
    },
    listedInternalUseDiagnostic,
  });
  const app = express();
  app.use(basePath, setKaiSprint2NoStore, requireKaiSprint2Enabled, kaiSprint2MetadataJsonParser);
  app.use(basePath, handleKaiSprint2JsonParserError);
  app.use(basePath, (req, res, next) => {
    req.isAuthenticated = () => true;
    req.user = { id: 7301 };
    req.kaiSprint2ActorContext = getScenario().actorContext;
    return next();
  });
  app.use(basePath, requireKaiSprint2Enabled, kaiSprint2OrganizationMutationLimiter, kaiSprint2ActorMutationLimiter, requireKaiSprint2Authenticated, sprint2IntakeApiRouter);
  const server = await new Promise((resolve, reject) => {
    const listening = app.listen(0, "127.0.0.1");
    listening.once("listening", () => resolve(listening));
    listening.once("error", reject);
  });
  t.after(async () => {
    restore();
    if (originalFeatureFlag === undefined) delete process.env.KAI_SPRINT2_ENABLED;
    else process.env.KAI_SPRINT2_ENABLED = originalFeatureFlag;
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });
  return (path) => new Promise((resolve, reject) => {
    const request = http.request({ hostname: "127.0.0.1", port: server.address().port, path: `${basePath}${path}`, method: "GET" }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ statusCode: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }));
    });
    request.on("error", reject);
    request.end();
  });
}

test("HTTP: one request answers a page of claims exactly as the per-claim route answers each, from one batch read", async (t) => {
  const scenario = { actorContext: ADMIN, repository: repository(), serviceCalls: 0 };
  const get = await withRouteServer(t, () => scenario);
  const ids = [1, 2, 3, 5, 8].map(claimId);
  const response = await get(claimInternalUsePath(ORG, ids).replace("/api/kai/sprint2/intake", ""));
  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  assert.equal(scenario.serviceCalls, 1);
  assert.deepEqual(scenario.repository.calls.batch.map((call) => call.claimIds), [ids], "one batch read");
  assert.deepEqual(scenario.repository.calls.single, [], "no per-claim read");
  assert.deepEqual(response.body.data.items.map((item) => item.claimId), ids);
  const answers = new Map(response.body.data.items.map((item) => [item.claimId, item.internalUseDiagnostic]));
  const byClaim = listedClaimDiagnostics(answers);
  for (const id of ids) {
    const single = await getClaimTraceabilitySummary({ organizationId: ORG, claimId: id, requestedAudience: "internal", actorContext: ADMIN },
      { env: ENV, claimTraceabilityRepository: repository() });
    assert.deepEqual(byClaim.get(id), claimUseDiagnosis({ statusCode: single.ok ? 200 : single.error.status, body: single }), id);
  }
  assert.deepEqual(answers.get(claimId(3)), { status: 409, error_code: "conflict_current_state_changed", traceability_conflict_reason: "source_version_not_current" });
  assert.equal(byClaim.get(claimId(5)).status, "unknown", "a failed evaluation is unknown, never adverse");
});

test("HTTP: malformed, oversized or duplicate claim ids and other readers are refused; nothing is read", async (t) => {
  let scenario;
  const get = await withRouteServer(t, () => scenario);
  const set = (actorContext) => { scenario = { actorContext, repository: repository(), serviceCalls: 0 }; };
  const path = (query) => `/admin/organizations/${ORG}/claim-library/internal-use${query}`;
  for (const query of ["", `?claim_ids=`, `?claim_ids=${claimId(1)},${claimId(1)}`, `?claim_ids=${claimId(1).toUpperCase()}`, `?claim_ids=not-a-uuid`,
    `?claim_ids=${Array.from({ length: 26 }, (_, i) => claimId(i + 1)).join(",")}`, `?claim_ids=${claimId(1)}&extra=1`]) {
    set(ADMIN);
    const refused = await get(path(query));
    assert.equal(refused.statusCode, 422, query);
    assert.deepEqual([scenario.serviceCalls, scenario.repository.calls.batch.length], [0, 0], query);
  }
  for (const reader of [actor("client_contributor"), actor("client_reviewer"), actor("client_admin", { organizationId: OTHER_ORG }), actor("gk_reviewer", { source: null })]) {
    set(reader);
    const refused = await get(path(`?claim_ids=${claimId(1)}`));
    assert.equal(refused.statusCode, 403, JSON.stringify(reader.organizationMemberships));
    assert.deepEqual(scenario.repository.calls.batch, []);
  }
  assert.equal(CLAIM_INTERNAL_USE_BATCH_MAX, 25);
});

test("the repository batch evaluates every claim in one read-only transaction, isolating each claim's database error with a savepoint", async () => {
  const sql = [];
  let transactions = 0;
  const failingClaim = claimId(2);
  const tx = {
    async query(text, params = []) {
      sql.push(text.trim().split(/\s+/).slice(0, 4).join(" "));
      if (Array.isArray(params) && params.includes(failingClaim)) throw Object.assign(new Error("synthetic"), { code: "XX000" });
      return { rows: [], rowCount: 0 };
    },
  };
  const repo = createPostgresClaimTraceabilityRepository({ runInTransaction: async (work) => { transactions += 1; return work(tx); } });
  const result = await repo.getOrganizationInternalDraftDiagnostics({ organizationId: ORG, claimIds: [claimId(1), failingClaim, claimId(3)], requestedAudience: "internal" });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(transactions, 1, "one transaction for the page");
  assert.equal(sql[0], "SET TRANSACTION ISOLATION LEVEL");
  assert.deepEqual(sql.filter((s) => /SAVEPOINT/.test(s)), [
    "SAVEPOINT kai_claim_internal_draft_diagnostic",
    "RELEASE SAVEPOINT kai_claim_internal_draft_diagnostic",
    "SAVEPOINT kai_claim_internal_draft_diagnostic",
    "ROLLBACK TO SAVEPOINT kai_claim_internal_draft_diagnostic",
    "SAVEPOINT kai_claim_internal_draft_diagnostic",
    "RELEASE SAVEPOINT kai_claim_internal_draft_diagnostic",
  ]);
  assert.ok(sql.every((s) => !/^(INSERT|UPDATE|DELETE)\b/i.test(s)), "read-only");
  assert.deepEqual(result.data.items.map((item) => item.claimId), [claimId(1), failingClaim, claimId(3)]);
  assert.deepEqual(result.data.items[1].result.error.code, "system_error", "the failing claim alone is a system error");
  // The other claims are evaluated as the single read evaluates them (here, nothing exists: the same not-ok answer).
  const single = await createPostgresClaimTraceabilityRepository({ runInTransaction: async (work) => work(tx) })
    .getOrganizationInternalDraftDiagnostic({ organizationId: ORG, claimId: claimId(1), requestedAudience: "internal" });
  assert.deepEqual(result.data.items[0].result, single);

  const { DIAGNOSTICS_BATCH_MAX_CLAIMS } = __claimTraceabilityRepositoryContract;
  assert.equal(DIAGNOSTICS_BATCH_MAX_CLAIMS, 25, "one claim library page");
  const never = createPostgresClaimTraceabilityRepository({ runInTransaction: async () => assert.fail("refused input opens no transaction") });
  for (const input of [
    { organizationId: ORG, claimIds: Array.from({ length: 26 }, (_, i) => claimId(i + 1)), requestedAudience: "internal" },
    { organizationId: ORG, claimIds: [claimId(1), claimId(1)], requestedAudience: "internal" },
    { organizationId: ORG, claimIds: [claimId(1)], requestedAudience: "funder" },
    { organizationId: ORG, claimIds: [claimId(1)], requestedAudience: "internal", extra: true },
  ]) {
    const refused = await never.getOrganizationInternalDraftDiagnostics(input);
    assert.equal(refused.error.code, "validation_blocker");
  }
});
