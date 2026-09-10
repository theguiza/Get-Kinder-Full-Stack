// P14-08B: governed Grant Response Packet export-manifest create/reuse -
// service + HTTP route wiring around the existing P14-08A
// postgresGrantResponsePacketExportManifestRepository.js. Proves gk_admin can
// create/reuse a manifest for the exact candidate, unauthorized/assistant/
// system/cross-tenant actors fail closed before any repository call, the
// real P14-07 eligibility/P14-07B1 effectiveness gating (exercised fully in
// the P14-08A repository suite) is never bypassed or reimplemented here, a
// failed creation produces no successful audit, replay converges, and the
// service/route never wire final artifact-bytes generation. No database
// access - the repository is faked at the service level; the route-level
// test additionally proves HTTP wiring (feature flags, authentication, exact
// request/response shape, empty-body contract).

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { readFileSync } from "node:fs";

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
  createGrantResponsePacketExportManifest,
  __grantResponsePacketExportManifestServiceContract,
  __grantResponsePacketExportManifestServiceTestables,
} from "../Backend/kai/services/kaiGrantResponsePacketExportManifestService.js";

const basePath = "/api/kai/sprint2/intake";
const routePath = "/admin/organizations/:organizationId/engagements/:engagementId/grant-response-packet/export-candidates/:grantResponsePacketExportCandidateId/export-manifests";
const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const ENGAGEMENT = "00000000-0000-4000-8000-000000000201";
const CANDIDATE_A = "00000000-0000-4000-8000-000000000301";
const CANDIDATE_B = "00000000-0000-4000-8000-000000000302";
const MEMBER_CANDIDATE = "00000000-0000-4000-8000-000000000303";
const ACTOR = "90000000-0000-4000-8000-000000000001";
const NOW = "2026-09-09T10:00:00.000Z";

const enabledEnv = Object.freeze({
  KAI_SPRINT2_ENABLED: "true",
  KAI_GENERATION_ENABLED: "true",
  KAI_PUBLIC_EXPORT_ENABLED: "true",
});

const gkAdminActorContext = Object.freeze({
  actorType: "human",
  actorUserId: ACTOR,
  organizationMemberships: [
    { organization_id: ORG, membership_status: "active", role_name: "gk_admin" },
  ],
});
const gkReviewerActorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000002",
  organizationMemberships: [
    { organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" },
  ],
});

function manifestInput(overrides = {}) {
  return {
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    grantResponsePacketExportCandidateId: CANDIDATE_A,
    actorContext: gkAdminActorContext,
    ...overrides,
  };
}

function auditRecorder() {
  const calls = [];
  return {
    calls,
    prepareMetadataOnlyAudit({ payload } = {}) {
      calls.push(payload);
      return { ok: true, async publish() {} };
    },
  };
}

function successResult(input, overrides = {}) {
  return {
    ok: true,
    data: {
      grantResponsePacketExportManifestId: "14080000-0000-4000-8000-000000000701",
      grantResponsePacketExportCandidateId: input.grantResponsePacketExportCandidateId,
      effectiveAuthorityDecisionId: "14070000-0000-4000-8000-000000000601",
      fingerprintContractVersion: "kai-sprint2-p14-08a-grant-response-packet-export-manifest-fingerprint-v1",
      canonicalFingerprint: "d".repeat(64),
      replayed: false,
      ...overrides,
    },
    error: null,
  };
}

test("P14-08B service pins the exact P14-08A contract", () => {
  assert.deepEqual(
    [...__grantResponsePacketExportManifestServiceContract.CREATE_GRANT_RESPONSE_PACKET_EXPORT_MANIFEST_ALLOWED_ROLES],
    ["gk_admin"],
  );
  assert.equal(
    __grantResponsePacketExportManifestServiceContract.CREATE_GRANT_RESPONSE_PACKET_EXPORT_MANIFEST_OPERATION,
    "create_grant_response_packet_export_manifest",
  );
});

test("input contract accepts only organizationId + engagementId + grantResponsePacketExportCandidateId + actorContext", () => {
  const { isCreateGrantResponsePacketExportManifestInput } = __grantResponsePacketExportManifestServiceTestables;
  assert.equal(isCreateGrantResponsePacketExportManifestInput(manifestInput()), true);
  for (const extraKey of [
    "now", "finalExportEligible", "effectiveHumanExportAuthority", "canonicalFingerprint",
    "members", "memberCount", "reviewResolved", "requestedAudience", "grantResponsePacketExportManifestId",
  ]) {
    assert.equal(
      isCreateGrantResponsePacketExportManifestInput({ ...manifestInput(), [extraKey]: "x" }),
      false,
      `${extraKey} must be rejected`,
    );
  }
});

test("gk_admin can create/reuse a manifest for the exact candidate - the repository receives exactly that candidate id, never a substitute", async () => {
  const repository = {
    calls: [],
    async createExportManifest(input) {
      this.calls.push(input);
      return successResult(input);
    },
  };
  const audit = auditRecorder();
  const result = await createGrantResponsePacketExportManifest(manifestInput(), {
    env: enabledEnv,
    repository,
    metadataOnlyAudit: audit,
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.grantResponsePacketExportCandidateId, CANDIDATE_A);
  assert.equal(result.data.replayed, false);
  assert.equal(repository.calls.length, 1);
  assert.equal(repository.calls[0].grantResponsePacketExportCandidateId, CANDIDATE_A);
  assert.notEqual(repository.calls[0].grantResponsePacketExportCandidateId, CANDIDATE_B);
});

test("unauthorized human (gk_reviewer), assistant/system actor, and cross-tenant actor all fail closed before any repository call", async () => {
  let repositoryCalls = 0;
  const repository = { async createExportManifest(input) { repositoryCalls += 1; return successResult(input); } };
  const deps = { env: enabledEnv, repository, metadataOnlyAudit: auditRecorder() };

  const reviewerResult = await createGrantResponsePacketExportManifest(
    manifestInput({ actorContext: gkReviewerActorContext }), deps,
  );
  assert.equal(reviewerResult.ok, false);
  assert.equal(reviewerResult.error.code, "authorization_denied");

  const systemResult = await createGrantResponsePacketExportManifest(
    manifestInput({ actorContext: { actorType: "system", actorUserId: ACTOR } }), deps,
  );
  assert.equal(systemResult.ok, false);
  assert.equal(systemResult.error.code, "authorization_denied");

  const tenantResult = await createGrantResponsePacketExportManifest(
    manifestInput({ organizationId: OTHER_ORG }), deps,
  );
  assert.equal(tenantResult.ok, false);
  assert.equal(tenantResult.error.code, "authorization_denied");

  assert.equal(repositoryCalls, 0);
});

test("eligibility BLOCKED (repository rejects with validation_blocker) creates no manifest and produces no audit", async () => {
  const repository = {
    async createExportManifest() {
      return { ok: false, data: null, error: { code: "validation_blocker", status: 422 } };
    },
  };
  const audit = auditRecorder();
  const result = await createGrantResponsePacketExportManifest(manifestInput(), {
    env: enabledEnv,
    repository,
    metadataOnlyAudit: audit,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(audit.calls.length, 0);
});

test("no/revoked authority and stale candidate (repository fails closed) create no manifest - the service reimplements none of P14-07/P14-07B1's gating", async () => {
  for (const code of ["validation_blocker", "not_found", "conflict_current_state_changed"]) {
    const repository = { async createExportManifest() { return { ok: false, data: null, error: { code, status: 422 } }; } };
    const result = await createGrantResponsePacketExportManifest(manifestInput(), {
      env: enabledEnv,
      repository,
      metadataOnlyAudit: auditRecorder(),
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, code);
  }
});

test("replay converges: a repeated eligible call reports replayed:true and the service forwards it unchanged", async () => {
  const repository = {
    calls: 0,
    async createExportManifest(input) {
      this.calls += 1;
      return successResult(input, { replayed: true });
    },
  };
  const result = await createGrantResponsePacketExportManifest(manifestInput(), {
    env: enabledEnv,
    repository,
    metadataOnlyAudit: auditRecorder(),
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.replayed, true);
  assert.equal(repository.calls, 1);
});

test("the service is metadata-only: no final artifact-bytes field is ever returned, and no artifact-bytes dependency is ever wired", async () => {
  const repository = { async createExportManifest(input) { return successResult(input); } };
  const result = await createGrantResponsePacketExportManifest(manifestInput(), {
    env: enabledEnv,
    repository,
    metadataOnlyAudit: auditRecorder(),
  });
  for (const key of Object.keys(result.data)) {
    assert.doesNotMatch(key, /bytes|artifact|markdown|pdf|docx|csv/i);
  }
});

test("P14-08B route delegates successfully and preserves service-only API composition", async (t) => {
  let scenario = { authenticated: true, actorContext: gkAdminActorContext, serviceCalls: [], dependencyCalls: [] };
  const restoreFeatureFlag = (() => {
    const original = process.env.KAI_SPRINT2_ENABLED;
    process.env.KAI_SPRINT2_ENABLED = "true";
    return () => {
      if (original === undefined) delete process.env.KAI_SPRINT2_ENABLED;
      else process.env.KAI_SPRINT2_ENABLED = original;
    };
  })();
  const restoreService = intakeRouteTestables.setIntakeServiceForTest({
    async createGrantResponsePacketExportManifest(input, dependencies) {
      scenario.serviceCalls.push(input);
      scenario.dependencyCalls.push(dependencies);
      return successResult(input);
    },
  });
  const app = express();
  app.use(basePath, setKaiSprint2NoStore, requireKaiSprint2Enabled, kaiSprint2MetadataJsonParser);
  app.use(basePath, handleKaiSprint2JsonParserError);
  app.use(basePath, (req, res, next) => {
    req.isAuthenticated = () => scenario.authenticated;
    if (scenario.authenticated) {
      req.user = { id: 46 };
      req.kaiSprint2ActorContext = scenario.actorContext;
    }
    next();
  });
  app.use(
    basePath,
    requireKaiSprint2Enabled,
    kaiSprint2OrganizationMutationLimiter,
    kaiSprint2ActorMutationLimiter,
    requireKaiSprint2Authenticated,
    sprint2IntakeApiRouter,
  );
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, "127.0.0.1");
    listener.once("listening", () => resolve(listener));
    listener.once("error", reject);
  });
  t.after(async () => {
    restoreService();
    restoreFeatureFlag();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  async function requestJson(path, body) {
    const { port } = server.address();
    const serialized = JSON.stringify(body);
    return await new Promise((resolve, reject) => {
      const request = http.request({
        hostname: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(serialized) },
      }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve({
          statusCode: response.statusCode,
          body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
        }));
      });
      request.on("error", reject);
      request.write(serialized);
      request.end();
    });
  }

  const path = `${basePath}/admin/organizations/${ORG}/engagements/${ENGAGEMENT}/grant-response-packet/export-candidates/${CANDIDATE_A}/export-manifests`;
  const before = Date.now();
  const response = await requestJson(path, {});
  const after = Date.now();
  assert.equal(response.statusCode, 201);
  assert.equal(scenario.serviceCalls.length, 1);
  assert.deepEqual(scenario.serviceCalls[0], {
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    grantResponsePacketExportCandidateId: CANDIDATE_A,
    actorContext: gkAdminActorContext,
  });
  assert.equal(typeof scenario.dependencyCalls[0].metadataOnlyAudit?.prepareMetadataOnlyAudit, "function");
  assert.equal(response.body.data.replayed, false);
  const nowMs = new Date(scenario.dependencyCalls[0].now).getTime();
  assert.ok(nowMs >= before && nowMs <= after);

  // A client-supplied body field of any kind is refused outright - never
  // silently ignored - since the packet manifest carries no client-derived
  // composition at all.
  scenario = { authenticated: true, actorContext: gkAdminActorContext, serviceCalls: [], dependencyCalls: [] };
  const withExtraField = await requestJson(path, { export_review_queue_item_id: MEMBER_CANDIDATE });
  assert.equal(withExtraField.statusCode, 422);
  assert.equal(withExtraField.body.error.code, "validation_blocker");
  assert.deepEqual(scenario.serviceCalls, []);

  scenario = { authenticated: false, actorContext: gkAdminActorContext, serviceCalls: [], dependencyCalls: [] };
  const unauthorized = await requestJson(path, {});
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(unauthorized.body.error.code, "unauthorized");
  assert.deepEqual(scenario.serviceCalls, []);
});

test("P14-08B route and service sources contain no raw SQL/direct DB access and wire no final artifact-bytes generation", () => {
  const routeSource = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
  const serviceSource = readFileSync("Backend/kai/services/kaiGrantResponsePacketExportManifestService.js", "utf8");
  const routeStart = routeSource.indexOf(
    '"/admin/organizations/:organizationId/engagements/:engagementId/grant-response-packet/export-candidates/:grantResponsePacketExportCandidateId/export-manifests"',
  );
  assert.notEqual(routeStart, -1);
  const routeEnd = routeSource.indexOf("export default router;", routeStart);
  const routeSlice = routeSource.slice(routeStart, routeEnd);

  assert.match(routeSlice, /service\.createGrantResponsePacketExportManifest/);
  assert.doesNotMatch(routeSlice, /\b(?:SELECT|INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b|\bpool\b|\bkaiDb\b|\brepository\b|\bkai\.(?!js\b)/i);
  for (const source of [routeSlice, serviceSource]) {
    assert.doesNotMatch(source, /createWriteStream|writeFileSync|writeFile\(|serializeGrantResponsePacketToMarkdown|serializeExportManifestTo(?:Markdown|Pdf|Docx|Csv)/i);
  }
});

test("P14-08B route is mounted exactly once", () => {
  const matches = sprint2IntakeApiRouter.stack
    .filter((layer) => layer.route?.path === routePath && layer.route?.methods?.post);
  assert.equal(matches.length, 1);
  assert.deepEqual(Object.keys(matches[0].route.methods), ["post"]);
});
