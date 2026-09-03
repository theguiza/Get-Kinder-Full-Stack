import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

import sprint2IntakeApiRouter, { __testables as intakeRouteTestables } from "../Backend/kai/routes/sprint2IntakeApi.js";
import { requireKaiSprint2Enabled } from "../Backend/kai/config/kaiSprint2Config.js";
import { createAttachKaiSprint2ActorContext, requireKaiSprint2Authenticated } from "../Backend/kai/middleware/kaiSprint2Authentication.js";
import {
  handleKaiSprint2JsonParserError,
  kaiSprint2ActorMutationLimiter,
  kaiSprint2MetadataJsonParser,
  kaiSprint2OrganizationMutationLimiter,
  setKaiSprint2NoStore,
} from "../Backend/kai/middleware/kaiSprint2RequestSafety.js";
import {
  organizationReviewQueuePath,
  projectReviewQueue,
  reviewQueueBlockerActionability,
} from "../frontend/impactEvidenceLibraryLogic.js";
import { listOrganizationReviewQueue } from "../Backend/kai/services/kaiClaimTraceabilityService.js";

const basePath = "/api/kai/sprint2/intake";
const organizationId = "00000000-0000-4000-8000-000000000001";
const claimId = "00000000-0000-4000-8000-000000000901";
const actorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  organizationMemberships: [
    { organization_id: organizationId, membership_status: "active", role_name: "gk_reviewer" },
  ],
});

function scenario(overrides = {}) {
  return {
    authenticated: true,
    actorContext,
    calls: [],
    result: { ok: true, data: { items: [], truncated: false, evaluationErrorCount: 0 }, error: null },
    ...overrides,
  };
}

function createApp(getScenario) {
  const app = express();
  app.use(basePath, setKaiSprint2NoStore, requireKaiSprint2Enabled, kaiSprint2MetadataJsonParser);
  app.use(basePath, handleKaiSprint2JsonParserError);
  app.use(basePath, (req, res, next) => {
    const current = getScenario();
    req.isAuthenticated = () => current.authenticated;
    if (current.authenticated) req.user = { id: 46 };
    return next();
  });
  const restoreActorContextMiddleware = intakeRouteTestables.setActorContextMiddlewareForTest(
    createAttachKaiSprint2ActorContext({
      resolveActorContext: async () => ({ ok: true, actorContext: getScenario().actorContext }),
    }),
  );
  app.use(
    basePath,
    requireKaiSprint2Enabled,
    kaiSprint2OrganizationMutationLimiter,
    kaiSprint2ActorMutationLimiter,
    requireKaiSprint2Authenticated,
    sprint2IntakeApiRouter,
  );
  return { app, restoreActorContextMiddleware };
}

async function listen(app) {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1");
    server.once("listening", () => resolve(server));
    server.once("error", reject);
  });
}

async function requestJson(server, path) {
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

test("Review Queue rollup route is mounted once as authenticated read-only GET", () => {
  const matches = sprint2IntakeApiRouter.stack
    .filter((layer) => layer.route?.path === "/admin/organizations/:organizationId/review-queue" && layer.route?.methods?.get);
  assert.equal(matches.length, 1);
  assert.deepEqual(Object.keys(matches[0].route.methods), ["get"]);
});

test("Review Queue rollup route delegates to the claim-traceability service and rejects an invalid organization id", async (t) => {
  let current = scenario({
    result: {
      ok: true,
      data: { items: [{ claim: { claim_id: claimId }, blockerCodes: ["claim_review_unresolved"], eligible: false }], truncated: false, evaluationErrorCount: 0 },
      error: null,
    },
  });
  const restore = intakeRouteTestables.setIntakeServiceForTest({
    async getClaimTraceabilitySummary() {
      throw new Error("must not be called by this route");
    },
    async listOrganizationReviewQueue(input) {
      current.calls.push(input);
      return current.result;
    },
  });
  const originalFeatureFlag = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "true";
  const { app, restoreActorContextMiddleware } = createApp(() => current);
  const server = await listen(app);

  t.after(async () => {
    restore();
    restoreActorContextMiddleware();
    if (originalFeatureFlag === undefined) delete process.env.KAI_SPRINT2_ENABLED;
    else process.env.KAI_SPRINT2_ENABLED = originalFeatureFlag;
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  const rejected = await requestJson(server, `${basePath}/admin/organizations/not-a-uuid/review-queue`);
  assert.equal(rejected.statusCode, 422);
  assert.deepEqual(current.calls, []);

  const ok = await requestJson(server, `${basePath}/admin/organizations/${organizationId}/review-queue`);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.data.items[0].blockerCodes[0], "claim_review_unresolved");
  assert.deepEqual(current.calls, [{ organizationId, actorContext }]);
});

test("listOrganizationReviewQueue service denies an actor with no active membership in the organization", async () => {
  const outsiderContext = {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000099",
    organizationMemberships: [],
  };
  const result = await listOrganizationReviewQueue(
    { organizationId, actorContext: outsiderContext },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      claimTraceabilityRepository: {
        async listOrganizationReviewQueue() {
          throw new Error("must not be called when authorization is denied");
        },
      },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("listOrganizationReviewQueue service is unavailable when KAI_SPRINT2_ENABLED is not set", async () => {
  const result = await listOrganizationReviewQueue(
    { organizationId, actorContext },
    { env: {}, claimTraceabilityRepository: { async listOrganizationReviewQueue() { throw new Error("must not be called"); } } },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "feature_disabled");
});

test("listOrganizationReviewQueue service delegates to the repository for an authorized gk_operator (read-only role) and always requests the internal audience", async () => {
  let calls = [];
  const result = await listOrganizationReviewQueue(
    {
      organizationId,
      actorContext: {
        actorType: "human",
        actorUserId: "90000000-0000-4000-8000-000000000098",
        organizationMemberships: [
          { organization_id: organizationId, membership_status: "active", role_name: "gk_operator" },
        ],
      },
    },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      claimTraceabilityRepository: {
        async listOrganizationReviewQueue(input) {
          calls.push(input);
          return { ok: true, data: { items: [], truncated: false, evaluationErrorCount: 0 }, error: null };
        },
      },
    },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [{ organizationId, requestedAudience: "internal" }]);
});

test("organizationReviewQueuePath builds the org-scoped review-queue path", () => {
  assert.equal(
    organizationReviewQueuePath(organizationId),
    `${basePath}/admin/organizations/${organizationId}/review-queue`,
  );
});

// KAI Review Queue mandatory screenshot regression (see task section 5): a
// claim whose evidence-review AND claim-review review_queue_items are BOTH
// queue_status/review_status = "resolved" (historical work-queue lifecycle
// resolved), with NO current evidence-review or claim-review decision ever
// recorded (evidence_review_decision/claim_review_decision both null,
// human-approved scope absent), a still-unresolved coverage dimension, and a
// client follow-up whose workflow is proposed/waiting_on_client, must still
// surface all four current blockers - the resolved queue/work lifecycle
// must never suppress them, and the resolved queue row must never be
// reinterpreted as an approved decision or offered a reopen/complete action.
test("Review Queue projection: resolved evidence/claim review queue lifecycle never suppresses current blockers, and never invents an action for it", () => {
  const rawTraceabilityDto = {
    requestedAudience: "internal",
    eligible: false,
    blockerCodes: [
      "claim_review_unresolved",
      "evidence_review_unresolved",
      "coverage_dimension_unresolved",
      "client_followup_unresolved",
    ],
    affectedDimensionKeys: ["denominator_clarity"],
    affectedObjectIds: [],
    claim: {
      claim_id: claimId,
      claim_type: "finding",
      claim_status: "proposed",
      claim_review_status: "needs_gk_review",
      claim_strength: "unassessed",
      audience_gates: { internal_only: true, public_use_allowed: false, funder_use_allowed: false, export_ready: false },
    },
    evidence: {
      evidence_item_id: "00000000-0000-4000-8000-000000000902",
      evidence_review_status: "needs_gk_review",
      support_strength: "unassessed",
      review_queue_item_id: "00000000-0000-4000-8000-000000000903",
      review_queue_status: "resolved",
      review_status: "resolved",
      updated_at: "2026-08-01T00:00:00.000Z",
      sensitivity_level: "unknown",
    },
    claim_review: {
      review_queue_item_id: "00000000-0000-4000-8000-000000000904",
      queue_status: "resolved",
      review_status: "resolved",
      updated_at: "2026-08-01T00:00:00.000Z",
    },
    evidence_review_decision: null,
    claim_review_decision: null,
    dimensions: {
      denominator_clarity: {
        assessment_status: "unresolved",
        validator_key: "VAL-KAI-P2-02-denominator_clarity",
        internal_limitation_accepted: false,
        blocks_requested_audience: true,
      },
    },
    gap_items: [{ gap_log_item_id: "g1", dimension_key: "denominator_clarity", assessment_status: "unresolved", validator_key: "VAL-KAI-P2-02-denominator_clarity" }],
    client_followup_workflows: [
      { client_followup_item_id: "cf1", gap_log_item_id: "g1", dimension_key: "denominator_clarity", workflow_status: "waiting_on_client", review_status: "proposed", review_queue_item_id: "00000000-0000-4000-8000-000000000905" },
    ],
    potential_conflict_groups: [],
    truncated: false,
  };

  const [item] = projectReviewQueue({ items: [rawTraceabilityDto] });
  assert.equal(item.claimId, claimId);
  assert.equal(item.eligible, false);
  assert.deepEqual(item.blockerCodes, [
    "claim_review_unresolved",
    "evidence_review_unresolved",
    "coverage_dimension_unresolved",
    "client_followup_unresolved",
  ]);
  // 1-2: both blockers remain visible despite resolved queue/work lifecycle.
  assert.ok(item.blockerCodes.includes("claim_review_unresolved"));
  assert.ok(item.blockerCodes.includes("evidence_review_unresolved"));
  // 3: coverage_dimension_unresolved remains visible.
  assert.ok(item.blockerCodes.includes("coverage_dimension_unresolved"));
  // 4: client_followup_unresolved remains visible as an outstanding dependency.
  assert.ok(item.blockerCodes.includes("client_followup_unresolved"));
  // Absent human decisions remain visibly absent - never fabricated.
  assert.equal(item.evidenceReviewDecision, null);
  assert.equal(item.claimReviewDecision, null);
  assert.equal(item.evidence.review_queue_status, "resolved");
  assert.equal(item.evidence.review_status, "resolved");
  assert.equal(item.claimReview.queue_status, "resolved");
  assert.equal(item.claimReview.review_status, "resolved");

  // 6-7: the resolved queue row is never reinterpreted as an approved
  // decision, and no reopen/complete action is invented for it - the
  // existing decision controls only ever activate on an outstanding
  // (open/needs_gk_review) queue row, so a resolved one derives BLOCKED,
  // never ACTION_REQUIRED.
  assert.equal(reviewQueueBlockerActionability("claim_review_unresolved", item), "BLOCKED");
  assert.equal(reviewQueueBlockerActionability("evidence_review_unresolved", item), "BLOCKED");
  // coverage_dimension_unresolved has an existing, always-reachable internal
  // acceptance control once the claim is selected.
  assert.equal(reviewQueueBlockerActionability("coverage_dimension_unresolved", item), "ACTION_REQUIRED");
  // client_followup_unresolved is an outstanding dependency on the client,
  // not an internal action - and no complete/resolve control exists for it
  // on this page today.
  assert.equal(reviewQueueBlockerActionability("client_followup_unresolved", item), "WAITING");
});

test("reviewQueueBlockerActionability grants ACTION_REQUIRED only while the underlying queue row is genuinely outstanding", () => {
  const outstandingItem = {
    evidence: { review_queue_status: "open", review_status: "needs_gk_review" },
    claimReview: { queue_status: "open", review_status: "needs_gk_review" },
    clientFollowupWorkflows: [],
  };
  assert.equal(reviewQueueBlockerActionability("evidence_review_unresolved", outstandingItem), "ACTION_REQUIRED");
  // Claim review cannot start until evidence review is resolved - matches
  // canCompleteClaimReview's existing gate exactly.
  assert.equal(reviewQueueBlockerActionability("claim_review_unresolved", outstandingItem), "BLOCKED");

  const evidenceResolvedItem = {
    evidence: { review_queue_status: "resolved", review_status: "resolved" },
    claimReview: { queue_status: "open", review_status: "needs_gk_review" },
    clientFollowupWorkflows: [],
  };
  assert.equal(reviewQueueBlockerActionability("claim_review_unresolved", evidenceResolvedItem), "ACTION_REQUIRED");
});

test("reviewQueueBlockerActionability defaults to BLOCKED for a blocker code with no dedicated control", () => {
  assert.equal(
    reviewQueueBlockerActionability("potential_conflict_review_unresolved", { evidence: {}, claimReview: {}, clientFollowupWorkflows: [] }),
    "BLOCKED",
  );
  assert.equal(
    reviewQueueBlockerActionability("support_strength_unassessed", { evidence: {}, claimReview: {}, clientFollowupWorkflows: [] }),
    "BLOCKED",
  );
});

test("projectReviewQueue returns an empty list for an empty rollup", () => {
  assert.deepEqual(projectReviewQueue({ items: [] }), []);
  assert.deepEqual(projectReviewQueue(null), []);
});
