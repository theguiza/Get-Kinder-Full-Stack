// P14-07: Grant Response Packet governed human final-release authority
// application - service + HTTP route wiring around the existing P14-07B1
// postgresGrantResponsePacketHumanAuthorityDecisionRepository.js. Proves
// gk_admin can grant/revoke the exact candidate, unauthorized/assistant/
// system/cross-tenant actors fail closed, B1's replay/supersession
// semantics are preserved end to end, and a failed grant produces no
// successful-authority audit row. No database access - the repository is
// faked at the service level; the route-level test additionally proves HTTP
// wiring (feature flags, authentication, exact request/response shape).

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
  recordGrantResponsePacketHumanFinalReleaseAuthorityDecision,
  __grantResponsePacketHumanFinalReleaseAuthorityServiceContract,
  __grantResponsePacketHumanFinalReleaseAuthorityServiceTestables,
} from "../Backend/kai/services/kaiGrantResponsePacketHumanFinalReleaseAuthorityService.js";

const basePath = "/api/kai/sprint2/intake";
const routePath = "/admin/organizations/:organizationId/engagements/:engagementId/grant-response-packet/export-candidates/:grantResponsePacketExportCandidateId/final-release-authority";
const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const ENGAGEMENT = "00000000-0000-4000-8000-000000000201";
const CANDIDATE = "00000000-0000-4000-8000-000000000301";
const ACTOR = "90000000-0000-4000-8000-000000000001";
const NOW = "2026-09-09T10:00:00.000Z";

const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" });

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

function authorityInput(overrides = {}) {
  return {
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    grantResponsePacketExportCandidateId: CANDIDATE,
    decisionAction: "grant",
    actorContext: gkAdminActorContext,
    now: NOW,
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

test("P14-07 final-release authority service pins the exact B1 export_authority_granted/gk_admin contract", () => {
  assert.equal(
    __grantResponsePacketHumanFinalReleaseAuthorityServiceContract.FINAL_RELEASE_AUTHORITY_DECISION_TYPE,
    "export_authority_granted",
  );
  assert.equal(
    __grantResponsePacketHumanFinalReleaseAuthorityServiceContract.RECORD_GRANT_RESPONSE_PACKET_HUMAN_FINAL_RELEASE_AUTHORITY_OPERATION,
    "record_grant_response_packet_human_final_release_authority_decision",
  );
  assert.deepEqual(
    [...__grantResponsePacketHumanFinalReleaseAuthorityServiceContract.RECORD_GRANT_RESPONSE_PACKET_HUMAN_FINAL_RELEASE_AUTHORITY_ROLES],
    ["gk_admin"],
  );
});

test("input contract accepts only organizationId + engagementId + grantResponsePacketExportCandidateId + decisionAction + actorContext + now", () => {
  const { isRecordGrantResponsePacketHumanFinalReleaseAuthorityInput } = __grantResponsePacketHumanFinalReleaseAuthorityServiceTestables;
  assert.equal(isRecordGrantResponsePacketHumanFinalReleaseAuthorityInput(authorityInput()), true);
  for (const extraKey of ["requestedAudience", "canonicalFingerprint", "members", "memberCount", "effective", "manifestId"]) {
    assert.equal(
      isRecordGrantResponsePacketHumanFinalReleaseAuthorityInput({ ...authorityInput(), [extraKey]: "x" }),
      false,
      `${extraKey} must be rejected`,
    );
  }
  assert.equal(isRecordGrantResponsePacketHumanFinalReleaseAuthorityInput(authorityInput({ decisionAction: "approve" })), false);
});

test("gk_admin can grant the exact candidate", async () => {
  const repository = {
    calls: [],
    async recordDecision(input) {
      this.calls.push(input);
      return {
        ok: true,
        data: {
          decisionId: "00000000-0000-4000-8000-000000000901",
          grantResponsePacketExportCandidateId: input.grantResponsePacketExportCandidateId,
          decisionType: "export_authority_granted",
          decisionAction: "grant",
          supersedesDecisionId: null,
          decidedByRole: "gk_admin",
          effective: true,
          effectivenessReason: null,
          headDecisionId: "00000000-0000-4000-8000-000000000901",
          replayed: false,
        },
        error: null,
      };
    },
  };
  const audit = auditRecorder();
  const result = await recordGrantResponsePacketHumanFinalReleaseAuthorityDecision(authorityInput(), {
    env: enabledEnv,
    grantResponsePacketHumanAuthorityDecisionRepository: repository,
    metadataOnlyAudit: audit,
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.grantResponsePacketExportCandidateId, CANDIDATE);
  assert.equal(result.data.decisionAction, "grant");
  assert.equal(result.data.effective, true);
  assert.equal(result.data.replayed, false);
  assert.equal("finalGate" in result.data, false);
  assert.equal("manifest" in result.data, false);
  assert.equal(repository.calls.length, 1);
  assert.equal(repository.calls[0].decisionType, "export_authority_granted");
  assert.equal(repository.calls[0].grantResponsePacketExportCandidateId, CANDIDATE);
});

test("gk_admin can revoke the exact candidate (B1 supports revoke through the same governed workflow)", async () => {
  const repository = {
    async recordDecision(input) {
      return {
        ok: true,
        data: {
          decisionId: "00000000-0000-4000-8000-000000000902",
          grantResponsePacketExportCandidateId: input.grantResponsePacketExportCandidateId,
          decisionType: "export_authority_granted",
          decisionAction: "revoke",
          supersedesDecisionId: "00000000-0000-4000-8000-000000000901",
          decidedByRole: "gk_admin",
          effective: false,
          effectivenessReason: "head_is_revoke",
          headDecisionId: "00000000-0000-4000-8000-000000000902",
          replayed: false,
        },
        error: null,
      };
    },
  };
  const result = await recordGrantResponsePacketHumanFinalReleaseAuthorityDecision(authorityInput({ decisionAction: "revoke" }), {
    env: enabledEnv,
    grantResponsePacketHumanAuthorityDecisionRepository: repository,
    metadataOnlyAudit: auditRecorder(),
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.decisionAction, "revoke");
  assert.equal(result.data.effective, false);
  assert.equal(result.data.effectivenessReason, "head_is_revoke");
});

test("unauthorized human (gk_reviewer), assistant/system actor, and cross-tenant actor all fail closed before any repository call", async () => {
  let repositoryCalls = 0;
  const repository = { async recordDecision() { repositoryCalls += 1; return { ok: true, data: {}, error: null }; } };
  const deps = { env: enabledEnv, grantResponsePacketHumanAuthorityDecisionRepository: repository, metadataOnlyAudit: auditRecorder() };

  const reviewerResult = await recordGrantResponsePacketHumanFinalReleaseAuthorityDecision(
    authorityInput({ actorContext: gkReviewerActorContext }), deps,
  );
  assert.equal(reviewerResult.ok, false);
  assert.equal(reviewerResult.error.code, "authorization_denied");

  const systemResult = await recordGrantResponsePacketHumanFinalReleaseAuthorityDecision(
    authorityInput({ actorContext: { actorType: "system", actorUserId: ACTOR } }), deps,
  );
  assert.equal(systemResult.ok, false);
  assert.equal(systemResult.error.code, "authorization_denied");

  const tenantResult = await recordGrantResponsePacketHumanFinalReleaseAuthorityDecision(
    authorityInput({ organizationId: OTHER_ORG }), deps,
  );
  assert.equal(tenantResult.ok, false);
  assert.equal(tenantResult.error.code, "authorization_denied");

  assert.equal(repositoryCalls, 0);
});

test("a failed grant attempt (repository rejects) produces no successful-authority audit row and the service surfaces the failure verbatim", async () => {
  const repository = {
    async recordDecision() {
      return { ok: false, data: null, error: { code: "conflict_current_state_changed", status: 409 } };
    },
  };
  const audit = auditRecorder();
  const result = await recordGrantResponsePacketHumanFinalReleaseAuthorityDecision(authorityInput(), {
    env: enabledEnv,
    grantResponsePacketHumanAuthorityDecisionRepository: repository,
    metadataOnlyAudit: audit,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict_current_state_changed");
  // The service itself never calls prepareMetadataOnlyAudit on a repository
  // failure - it is passed through to the repository, which (per B1) only
  // ever publishes on a genuinely new/effective row. Here the repository
  // faked a hard failure before any audit was ever prepared.
  assert.equal(audit.calls.length, 0);
});

test("same-action replay converges (B1 semantics preserved end-to-end): a repeated grant reports replayed:true and creates no new row", async () => {
  const repository = {
    calls: 0,
    async recordDecision(input) {
      this.calls += 1;
      return {
        ok: true,
        data: {
          decisionId: "00000000-0000-4000-8000-000000000901",
          grantResponsePacketExportCandidateId: input.grantResponsePacketExportCandidateId,
          decisionType: "export_authority_granted",
          decisionAction: "grant",
          supersedesDecisionId: null,
          decidedByRole: "gk_admin",
          effective: true,
          effectivenessReason: null,
          headDecisionId: "00000000-0000-4000-8000-000000000901",
          replayed: true,
        },
        error: null,
      };
    },
  };
  const result = await recordGrantResponsePacketHumanFinalReleaseAuthorityDecision(authorityInput(), {
    env: enabledEnv,
    grantResponsePacketHumanAuthorityDecisionRepository: repository,
    metadataOnlyAudit: auditRecorder(),
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.replayed, true);
  assert.equal(repository.calls, 1);
});

test("the service is metadata-only: it never returns or references a manifest/bytes identity", async () => {
  const repository = {
    async recordDecision(input) {
      return {
        ok: true,
        data: {
          decisionId: "00000000-0000-4000-8000-000000000901",
          grantResponsePacketExportCandidateId: input.grantResponsePacketExportCandidateId,
          decisionType: "export_authority_granted",
          decisionAction: "grant",
          supersedesDecisionId: null,
          decidedByRole: "gk_admin",
          effective: true,
          effectivenessReason: null,
          headDecisionId: "00000000-0000-4000-8000-000000000901",
          replayed: false,
        },
        error: null,
      };
    },
  };
  const result = await recordGrantResponsePacketHumanFinalReleaseAuthorityDecision(authorityInput(), {
    env: enabledEnv,
    grantResponsePacketHumanAuthorityDecisionRepository: repository,
    metadataOnlyAudit: auditRecorder(),
  });
  for (const key of Object.keys(result.data)) {
    assert.doesNotMatch(key, /manifest|bytes|artifact/i);
  }
});

test("P14-07 route delegates successfully and preserves service-only API composition", async (t) => {
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
    async recordGrantResponsePacketHumanFinalReleaseAuthorityDecision(input, dependencies) {
      scenario.serviceCalls.push(input);
      scenario.dependencyCalls.push(dependencies);
      return {
        ok: true,
        data: {
          grantResponsePacketExportCandidateId: input.grantResponsePacketExportCandidateId,
          decisionType: "export_authority_granted",
          decisionAction: input.decisionAction,
          effective: true,
          effectivenessReason: null,
          replayed: false,
        },
        error: null,
      };
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

  const path = `${basePath}/admin/organizations/${ORG}/engagements/${ENGAGEMENT}/grant-response-packet/export-candidates/${CANDIDATE}/final-release-authority`;
  const before = Date.now();
  const response = await requestJson(path, { decision_action: "grant" });
  const after = Date.now();
  assert.equal(response.statusCode, 201);
  assert.equal(scenario.serviceCalls.length, 1);
  assert.deepEqual(scenario.serviceCalls[0], {
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    grantResponsePacketExportCandidateId: CANDIDATE,
    decisionAction: "grant",
    actorContext: gkAdminActorContext,
    now: scenario.serviceCalls[0].now,
  });
  assert.equal(typeof scenario.dependencyCalls[0].metadataOnlyAudit?.prepareMetadataOnlyAudit, "function");
  assert.equal(response.body.data.effective, true);
  assert.equal("requestedAudience" in scenario.serviceCalls[0], false);
  const nowMs = new Date(scenario.serviceCalls[0].now).getTime();
  assert.ok(nowMs >= before && nowMs <= after);

  // requested_audience is refused outright (a Grant Response Packet's
  // audience is always exactly "funder") - never silently ignored.
  scenario = { authenticated: true, actorContext: gkAdminActorContext, serviceCalls: [], dependencyCalls: [] };
  const withAudience = await requestJson(path, { decision_action: "grant", requested_audience: "funder" });
  assert.equal(withAudience.statusCode, 422);
  assert.equal(withAudience.body.error.code, "validation_blocker");
  assert.deepEqual(scenario.serviceCalls, []);

  scenario = { authenticated: false, actorContext: gkAdminActorContext, serviceCalls: [], dependencyCalls: [] };
  const unauthorized = await requestJson(path, { decision_action: "grant" });
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(unauthorized.body.error.code, "unauthorized");
  assert.deepEqual(scenario.serviceCalls, []);
});

test("P14-07 route and service sources do not wire finalGate, VAL-EXP-001, artifact, manifest, or finalization behavior, and contain no raw SQL", () => {
  const routeSource = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
  const serviceSource = readFileSync("Backend/kai/services/kaiGrantResponsePacketHumanFinalReleaseAuthorityService.js", "utf8");
  const routeStart = routeSource.indexOf(
    '"/admin/organizations/:organizationId/engagements/:engagementId/grant-response-packet/export-candidates/:grantResponsePacketExportCandidateId/final-release-authority"',
  );
  assert.notEqual(routeStart, -1);
  const routeEnd = routeSource.indexOf(");", routeSource.indexOf("router.post(", routeStart)) + 2;
  const routeSlice = routeSource.slice(routeStart, routeEnd);

  assert.match(routeSlice, /service\.recordGrantResponsePacketHumanFinalReleaseAuthorityDecision/);
  assert.doesNotMatch(routeSlice, /\b(?:SELECT|INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b|\bpool\b|\bkaiDb\b|\brepository\b|\bkai\.(?!js\b)/i);
  for (const source of [routeSlice, serviceSource]) {
    assert.doesNotMatch(source, /finalGate\s*:\s*true|final_gate\s*=\s*true|export_manifests|export_artifacts|createWriteStream|writeFileSync|writeFile|finalizeExport|finalization_status/i);
  }
});

test("P14-07 route is mounted exactly once", () => {
  const matches = sprint2IntakeApiRouter.stack
    .filter((layer) => layer.route?.path === routePath && layer.route?.methods?.post);
  assert.equal(matches.length, 1);
  assert.deepEqual(Object.keys(matches[0].route.methods), ["post"]);
});
