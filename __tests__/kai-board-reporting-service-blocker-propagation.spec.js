// Board Reporting production regression repair (post Package C0): the
// diagnostic commit 8ac5087 attached a safe, bounded blocking_reason
// (VAL-BOARD-CURRENT-001..005) to conflict_current_state_changed failures
// on the repository's getBoardReportingPacket read path, but
// kaiBoardReportingPacketService.getBoardReportingPacket dropped
// result.blockers when rebuilding the failure via buildKaiError - so those
// blockers never reached the HTTP response. These tests prove the service
// now preserves them, and that the existing route sanitizer still reduces
// them to the safe validator_key/blocking_reason shape, changing no status
// code, error code, or fail-closed behavior.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

import { getBoardReportingPacket } from "../Backend/kai/services/kaiBoardReportingPacketService.js";
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

const basePath = "/api/kai/sprint2/intake";
const ORG = "00000000-0000-4000-8000-000000000001";
const ENGAGEMENT = "00000000-0000-4000-8000-000000000701";
const ACTOR = "90000000-0000-4000-8000-000000000001";
const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" });

const reviewerActor = Object.freeze({
  actorType: "human",
  actorUserId: ACTOR,
  source: "public.userdata",
  organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" }],
});

// The exact repository failure shape the diagnostic commit produces: a
// conflict_current_state_changed error plus a VAL-BOARD-CURRENT-00X
// blocker carrying only bounded, metadata-safe fields.
function repositoryConflictFailure() {
  return {
    ok: false,
    data: null,
    error: { code: "conflict_current_state_changed", status: 409 },
    blockers: [{
      validator_key: "VAL-BOARD-CURRENT-002",
      severity: "blocker",
      object_type: "generated_content_draft",
      object_code: "board_reporting_traceability_read",
      message: "Board Reporting traceability could not be re-verified for this draft.",
      blocking_reason: "traceability_read_failed",
      required_fix: "Retry once the underlying claim traceability read succeeds.",
      evidence: { failure_stage: "traceability_read" },
    }],
  };
}

test("service: getBoardReportingPacket preserves repository blockers through buildKaiError instead of dropping them", async () => {
  const result = await getBoardReportingPacket({
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    actorContext: reviewerActor,
  }, {
    env: enabledEnv,
    generatedContentRepository: {
      async getBoardReportingPacket() {
        return repositoryConflictFailure();
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict_current_state_changed");
  assert.equal(result.error.status, 409);
  assert.ok(Array.isArray(result.blockers), "result.blockers must survive the failure mapping");
  assert.equal(result.blockers.length, 1);
  assert.equal(result.blockers[0].validator_key, "VAL-BOARD-CURRENT-002");
  assert.equal(result.blockers[0].blocking_reason, "traceability_read_failed");
});

test("service: a repository failure with no blockers still maps cleanly (no fabricated blocker)", async () => {
  const result = await getBoardReportingPacket({
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    actorContext: reviewerActor,
  }, {
    env: enabledEnv,
    generatedContentRepository: {
      async getBoardReportingPacket() {
        return { ok: false, data: null, error: { code: "not_found", status: 404 } };
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
  assert.equal(result.blockers, undefined);
});

async function withRunningApp(t) {
  const restoreFeatureFlag = (() => {
    const original = process.env.KAI_SPRINT2_ENABLED;
    process.env.KAI_SPRINT2_ENABLED = "true";
    return () => {
      if (original === undefined) delete process.env.KAI_SPRINT2_ENABLED;
      else process.env.KAI_SPRINT2_ENABLED = original;
    };
  })();

  const app = express();
  app.use(basePath, setKaiSprint2NoStore, requireKaiSprint2Enabled, kaiSprint2MetadataJsonParser);
  app.use(basePath, handleKaiSprint2JsonParserError);
  app.use(basePath, (req, res, next) => {
    req.isAuthenticated = () => true;
    req.user = { id: 46 };
    req.kaiSprint2ActorContext = reviewerActor;
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
    restoreFeatureFlag();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  async function requestJson(path) {
    const { port } = server.address();
    return await new Promise((resolve, reject) => {
      const request = http.request({ hostname: "127.0.0.1", port, path, method: "GET" }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve({
          statusCode: response.statusCode,
          body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
        }));
      });
      request.on("error", reject);
      request.end();
    });
  }

  return { requestJson };
}

test("route: GET board-reporting preserves 409/conflict_current_state_changed and returns only the sanitized validator_key/blocking_reason blocker, no raw evidence", async (t) => {
  const restoreService = intakeRouteTestables.setIntakeServiceForTest({
    async getBoardReportingPacket() {
      return repositoryConflictFailure();
    },
  });
  t.after(restoreService);

  const { requestJson } = await withRunningApp(t);
  const path = `${basePath}/admin/organizations/${ORG}/engagements/${ENGAGEMENT}/board-reporting`;
  const response = await requestJson(path);

  assert.equal(response.statusCode, 409);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.error.code, "conflict_current_state_changed");
  assert.ok(Array.isArray(response.body.blockers));
  assert.equal(response.body.blockers.length, 1);
  const blocker = response.body.blockers[0];
  assert.equal(blocker.validator_key, "VAL-BOARD-CURRENT-002");
  assert.equal(blocker.blocking_reason, "traceability_read_failed");
  // The sanitizer's fixed output shape - no raw repository evidence
  // (failure_stage), ids, SQL, or generated-content text leak through.
  assert.deepEqual(Object.keys(blocker).sort(), [
    "blocking_reason",
    "evidence",
    "message",
    "object_code",
    "object_id",
    "object_type",
    "required_fix",
    "severity",
    "validator_key",
  ]);
  assert.equal(blocker.object_id, null);
  // The sanitizer allows only a bounded, machine-code-only evidence subset
  // through (failure_stage here) - never a claim id, evidence body, SQL, or
  // other repository-internal detail.
  assert.deepEqual(blocker.evidence, { failure_stage: "traceability_read" });
});
