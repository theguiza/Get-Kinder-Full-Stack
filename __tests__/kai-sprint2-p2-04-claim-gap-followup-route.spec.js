import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { readFileSync } from "node:fs";

import sprint2IntakeApiRouter, { __testables as intakeRouteTestables } from "../Backend/kai/routes/sprint2IntakeApi.js";
import { requireKaiSprint2Enabled } from "../Backend/kai/config/kaiSprint2Config.js";
import { KAI_ERROR_STATUS, buildKaiError } from "../Backend/kai/errors/kaiErrors.js";
import { requireKaiSprint2Authenticated } from "../Backend/kai/middleware/kaiSprint2Authentication.js";
import {
  handleKaiSprint2JsonParserError,
  kaiSprint2ActorMutationLimiter,
  kaiSprint2MetadataJsonParser,
  kaiSprint2OrganizationMutationLimiter,
  setKaiSprint2NoStore,
} from "../Backend/kai/middleware/kaiSprint2RequestSafety.js";

/**
 * P2-04 claim-gap/client-followup composition proof. Mirrors the existing
 * proven `kai-sprint2-p2-03-claim-proposal-route.spec.js` pattern exactly.
 * P2-04's own dimension-derivation/lineage/persistence/replay logic is not
 * retested here - it remains owned by
 * `kai-sprint2-p2-04-claim-gap-followup-boundary.spec.js`,
 * `kai-sprint2-p2-04-claim-gap-followup.integration.spec.js`, and the P2-04
 * verifier script. This file proves only the new mounted boundary: the route
 * forwards server-resolved organizationId/claimId/actorContext/now, plus a
 * production metadataOnlyAudit dependency, to the existing service, unchanged,
 * exactly once.
 */

const basePath = "/api/kai/sprint2/intake";
const routePath = "/admin/organizations/:organizationId/claims/:claimId/claim-gap-followups";
const organizationId = "00000000-0000-4000-8000-000000000001";
const claimId = "a0000000-0000-4000-8000-000000000001";
const actorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  source: "public.userdata",
  organizationMemberships: [
    { organization_id: organizationId, membership_status: "active", role_name: "gk_admin" },
  ],
});
const injectedFollowupDto = Object.freeze({
  gapItems: [{ gap_log_item_id: "b0000000-0000-4000-8000-000000000001", claim_id: claimId }],
  clientFollowupItems: [{ client_followup_item_id: "c0000000-0000-4000-8000-000000000001" }],
  reviewQueueItems: [{ review_queue_item_id: "d0000000-0000-4000-8000-000000000001" }],
  replayed: false,
});

function concretePath(overrides = {}) {
  return `${basePath}/admin/organizations/${overrides.organizationId || organizationId}`
    + `/claims/${overrides.claimId || claimId}/claim-gap-followups`;
}

function createScenario(overrides = {}) {
  return {
    authenticated: true,
    actorContext,
    serviceCalls: [],
    dependencyCalls: [],
    serviceResult: { ok: true, data: injectedFollowupDto, error: null },
    events: [],
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
    if (scenario.authenticated) {
      req.user = { id: 46 };
      req.kaiSprint2ActorContext = scenario.actorContext;
    }
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

async function requestJson(server, path, { body = null, method = "POST" } = {}) {
  const { port } = server.address();
  const serialized = body == null ? null : JSON.stringify(body);
  return await new Promise((resolve, reject) => {
    const request = http.request({
      hostname: "127.0.0.1",
      port,
      path,
      method,
      headers: serialized
        ? { "content-type": "application/json", "content-length": Buffer.byteLength(serialized) }
        : {},
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        statusCode: response.statusCode,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
      }));
    });
    request.on("error", reject);
    if (serialized) request.write(serialized);
    request.end();
  });
}

test("P2-04 claim-gap-followup route appears as exactly one mounted authenticated POST route", () => {
  const matches = sprint2IntakeApiRouter.stack
    .filter((layer) => layer.route?.path === routePath && layer.route?.methods?.post);
  assert.equal(matches.length, 1);
  assert.deepEqual(Object.keys(matches[0].route.methods), ["post"]);
});

test("P2-04 claim-gap-followup route", async (t) => {
  let scenario = createScenario();
  const originalFeatureFlag = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "true";
  const restore = intakeRouteTestables.setIntakeServiceForTest({
    async generateClaimGapFollowups(input, dependencies) {
      scenario.serviceCalls.push(input);
      scenario.dependencyCalls.push(dependencies);
      return scenario.serviceResult;
    },
  });
  const app = createAssembledApplication(() => scenario);
  const server = await listen(app);

  t.after(async () => {
    restore();
    if (originalFeatureFlag === undefined) delete process.env.KAI_SPRINT2_ENABLED;
    else process.env.KAI_SPRINT2_ENABLED = originalFeatureFlag;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  await t.test("unauthenticated requests fail before the P2-04 write seam", async () => {
    scenario = createScenario({ authenticated: false });
    const response = await requestJson(server, concretePath());

    assert.equal(response.statusCode, 401);
    assert.equal(response.body.error.code, "unauthorized");
    assert.deepEqual(scenario.serviceCalls, []);
    assert.deepEqual(scenario.events, ["outer_feature_gate_passed", "canonical_http_authentication"]);
  });

  await t.test(
    "an authenticated mapped human in the correct organization reaches the service exactly once with server-resolved identity and a production metadataOnlyAudit dependency",
    async () => {
      scenario = createScenario();
      const before = Date.now();
      const response = await requestJson(server, concretePath());
      const after = Date.now();

      assert.equal(response.statusCode, 200);
      assert.equal(scenario.serviceCalls.length, 1);
      const call = scenario.serviceCalls[0];
      assert.deepEqual(call, {
        organizationId,
        claimId,
        actorContext,
        now: call.now,
      });
      assert.deepEqual(response.body, { ok: true, data: injectedFollowupDto, warnings: [] });

      assert.match(call.now, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      const nowMs = new Date(call.now).getTime();
      assert.ok(nowMs >= before && nowMs <= after, "now must be generated server-side within the request window");

      const dependencies = scenario.dependencyCalls[0];
      assert.equal(typeof dependencies.metadataOnlyAudit?.prepareMetadataOnlyAudit, "function");
      const rejectedNoClaim = dependencies.metadataOnlyAudit.prepareMetadataOnlyAudit({
        payload: { attempted_operation: "claim_gap_and_followup_generated", object_type: "claim" },
      });
      assert.equal(rejectedNoClaim.ok, false, "the production adapter must refuse a payload with no claim_id");
      const rejectedMismatchedClaim = dependencies.metadataOnlyAudit.prepareMetadataOnlyAudit({
        payload: {
          attempted_operation: "claim_gap_and_followup_generated",
          object_type: "claim",
          claim_id: "ffffffff-0000-4000-8000-000000000001",
        },
      });
      assert.equal(rejectedMismatchedClaim.ok, false, "the production adapter must refuse a claim_id that does not match the route claimId");
      const prepared = dependencies.metadataOnlyAudit.prepareMetadataOnlyAudit({
        payload: { attempted_operation: "claim_gap_and_followup_generated", object_type: "claim", claim_id: claimId },
      });
      assert.equal(prepared.ok, true);
      assert.equal(typeof prepared.publish, "function");
    },
  );

  await t.test("request body cannot inject actor/time/gap/followup fields", async () => {
    scenario = createScenario();
    const response = await requestJson(
      server,
      `${concretePath()}?organization_id=00000000-0000-4000-8000-000000000999&actorContext=%7B%22actorType%22%3A%22system%22%7D`,
      {
        body: {
          organization_id: "00000000-0000-4000-8000-000000000999",
          actorContext: { actorType: "system", actorUserId: "attacker" },
          now: "1999-01-01T00:00:00.000Z",
          claim_id: "ffffffff-0000-4000-8000-000000000001",
          dimension_key: "missingness",
          assessment_status: "resolved_clear",
          actorUserId: "attacker",
          actorType: "system",
          roles: ["gk_admin"],
          memberships: [{ organization_id: organizationId, role_name: "gk_admin" }],
          queue_status: "resolved",
        },
      },
    );

    assert.equal(response.statusCode, 422);
    assert.equal(response.body.error.code, "validation_blocker");
    assert.deepEqual(scenario.serviceCalls, []);
  });

  await t.test("malformed path values use the existing safe validation_blocker response", async () => {
    for (const path of [
      concretePath({ organizationId: "not-a-uuid" }),
      concretePath({ claimId: "not-a-uuid" }),
      concretePath({ organizationId: "a0000000-0000-4000-8000-000000000001".toUpperCase() }),
      concretePath({ claimId: "a0000000-0000-4000-8000-000000000001".toUpperCase() }),
    ]) {
      scenario = createScenario();
      const response = await requestJson(server, path);
      assert.equal(response.statusCode, 422, path);
      assert.equal(response.body.error.code, "validation_blocker", path);
      assert.deepEqual(scenario.serviceCalls, [], path);
    }
  });

  await t.test(
    "unmapped/unauthorized/non-human service rejections fail before any write, with no leaked detail",
    async () => {
      for (const code of [
        "feature_disabled",
        "invalid_request",
        "unauthorized",
        "mapped_kai_user_required",
        "authorization_denied",
        "tenant_boundary_violation",
        "not_found",
        "conflict_current_state_changed",
        "system_error",
      ]) {
        scenario = createScenario({
          serviceResult: buildKaiError(code, {
            data: { partial: "must not leak" },
            blockers: [{ validator_key: "unsafe", evidence: { secret: true } }],
            warnings: [{ code: "unsafe_warning", message: "must not leak" }],
          }),
        });
        const response = await requestJson(server, concretePath());

        assert.equal(response.statusCode, KAI_ERROR_STATUS[code], code);
        assert.equal(response.body.ok, false, code);
        assert.equal(response.body.error.code, code);
        assert.equal(response.body.data, null, code);
        assert.equal(JSON.stringify(response.body).includes("must not leak"), false, code);
        assert.equal(JSON.stringify(response.body).includes("partial"), false, code);
        assert.equal(scenario.serviceCalls.length, 1, code);
      }
    },
  );
});

test("P2-04 claim-gap-followup route: KAI_SPRINT2_ENABLED=false produces zero service/write activity", async (t) => {
  const originalFeatureFlag = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "false";
  let scenario = createScenario();
  const restore = intakeRouteTestables.setIntakeServiceForTest({
    async generateClaimGapFollowups(input, dependencies) {
      scenario.serviceCalls.push(input);
      scenario.dependencyCalls.push(dependencies);
      return scenario.serviceResult;
    },
  });
  const app = createAssembledApplication(() => scenario);
  const server = await listen(app);

  t.after(async () => {
    restore();
    if (originalFeatureFlag === undefined) delete process.env.KAI_SPRINT2_ENABLED;
    else process.env.KAI_SPRINT2_ENABLED = originalFeatureFlag;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const response = await requestJson(server, concretePath());
  assert.equal(response.statusCode, 403);
  assert.deepEqual(scenario.serviceCalls, []);
});

test("P2-04 claim-gap-followup route source imports no database or repository layer, performs no writes, and invokes no P2-05+ service", () => {
  const source = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
  const slice = source.slice(
    source.indexOf("async function getClaimGapFollowupService"),
    source.indexOf("async function getConflictReviewCandidateService"),
  );
  assert.match(source, /async function getClaimGapFollowupService/);
  assert.match(slice, /generateClaimGapFollowups/);
  assert.doesNotMatch(slice, /from\s+["'][^"']*(?:db|repository|postgres|kaiDb|kaiQueries|kaiReadModels)[^"']*["']/i);
  assert.doesNotMatch(slice, /\b(?:SELECT|INSERT|UPDATE|DELETE)\b|\bpool\b|\bkaiDb\b|\brepository\b|\bkai\.(?!js\b)/i);
  assert.doesNotMatch(slice, /p2-05|p2-06|p2-07|p2-08|kaiConflictReviewCandidateService|kaiExportCandidateService/i);
});

test("P2-04 claim-gap-followup route source never contains the literal token req.user", () => {
  const source = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
  assert.doesNotMatch(source, /req\.user/);
});
