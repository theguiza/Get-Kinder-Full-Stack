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
import { readFileSync } from "node:fs";
import {
  organizationReviewQueuePath,
  projectReviewQueue,
  projectReviewQueueCompleteness,
  projectOrganizationGapsAndRisks,
  organizationGapsAndRisksIsConclusivelyEmpty,
  reviewQueueIsComplete,
  reviewQueueIsConclusivelyEmpty,
  reviewQueueBlockerActionability,
  sensitivityReviewQueueAttention,
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
// surface all four current blockers - the resolved queue/work lifecycle must
// never suppress them, and the resolved queue row must never be reinterpreted
// as an approved decision.
//
// Review-actionability repair: this exact shape - resolved/resolved with no
// decision head ever recorded - is the lawful P2-12 legacy-repair state the
// backend's resolved/resolved CAS branch (postgresHumanReviewRepository.js)
// accepts a genuine first decision against (proven by the P2-12 "resolved
// queue without a decision head" integration test). It must read as
// ACTION_REQUIRED for evidence review, not BLOCKED. Claim review remains
// non-actionable here only because its own prerequisite (a terminal evidence
// decision) is not yet satisfied - that is a dependency on other lawful work,
// not a genuine hard blocker, so it presents as WAITING.
test("Review Queue projection: resolved evidence/claim review queue lifecycle never suppresses current blockers, and legacy-repair evidence review reads as actionable, not blocked", () => {
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
        funder_limitation_accepted: false,
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
  // decision. Evidence review is a lawful P2-12 legacy-repair candidate
  // (resolved/resolved, no decision head) so it reads as ACTION_REQUIRED, not
  // BLOCKED. Claim review's own prerequisite (a terminal evidence decision)
  // is not yet satisfied, so it is a dependency, not a hard blocker - WAITING.
  assert.equal(reviewQueueBlockerActionability("claim_review_unresolved", item), "WAITING");
  assert.equal(reviewQueueBlockerActionability("evidence_review_unresolved", item), "ACTION_REQUIRED");
  // coverage_dimension_unresolved has an existing, always-reachable internal
  // acceptance control once the claim is selected.
  assert.equal(reviewQueueBlockerActionability("coverage_dimension_unresolved", item), "ACTION_REQUIRED");
  // client_followup_unresolved is an outstanding dependency on the client,
  // not an internal action - and no complete/resolve control exists for it
  // on this page today.
  assert.equal(reviewQueueBlockerActionability("client_followup_unresolved", item), "WAITING");
});

test("reviewQueueBlockerActionability grants ACTION_REQUIRED only while the underlying queue row is genuinely outstanding or a lawful P2-12 legacy-repair candidate", () => {
  const outstandingItem = {
    evidence: { review_queue_status: "open", review_status: "needs_gk_review" },
    evidenceReviewDecision: null,
    claimReview: { queue_status: "open", review_status: "needs_gk_review" },
    claimReviewDecision: null,
    clientFollowupWorkflows: [],
  };
  assert.equal(reviewQueueBlockerActionability("evidence_review_unresolved", outstandingItem), "ACTION_REQUIRED");
  // Claim review cannot independently start until evidence review has a
  // terminal decision - that is a dependency, presented as WAITING, not a
  // hard blocker.
  assert.equal(reviewQueueBlockerActionability("claim_review_unresolved", outstandingItem), "WAITING");

  const evidenceResolvedNoDecisionItem = {
    evidence: { review_queue_status: "resolved", review_status: "resolved" },
    evidenceReviewDecision: null,
    claimReview: { queue_status: "open", review_status: "needs_gk_review" },
    claimReviewDecision: null,
    clientFollowupWorkflows: [],
  };
  // `evidence.review_status === "resolved"` alone is not proof the evidence
  // prerequisite is satisfied - no decision head exists yet, so claim review
  // still waits.
  assert.equal(reviewQueueBlockerActionability("claim_review_unresolved", evidenceResolvedNoDecisionItem), "WAITING");

  const evidenceDecidedItem = {
    evidence: { review_queue_status: "resolved", review_status: "resolved" },
    evidenceReviewDecision: { decisionId: "d1", decisionOutcome: "supported" },
    claimReview: { queue_status: "open", review_status: "needs_gk_review" },
    claimReviewDecision: null,
    clientFollowupWorkflows: [],
  };
  assert.equal(reviewQueueBlockerActionability("claim_review_unresolved", evidenceDecidedItem), "ACTION_REQUIRED");
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

// Review Queue closure: claim-attention completeness (this package) - the
// frontend must be able to tell a genuinely complete, zero-item rollup apart
// from a truncated or partially-failed one, since both currently reach
// projectReviewQueue as the same empty `items` array. These DTO field names
// (`truncated`, `evaluationErrorCount`) are the exact vocabulary returned by
// postgresClaimTraceabilityRepository.js listOrganizationReviewQueue.
test("projectReviewQueueCompleteness reports a genuinely complete rollup", () => {
  const dto = { items: [], truncated: false, evaluationErrorCount: 0 };
  const completeness = projectReviewQueueCompleteness(dto);
  assert.deepEqual(completeness, { truncated: false, evaluationErrorCount: 0 });
  assert.equal(reviewQueueIsComplete(completeness), true);
});

test("projectReviewQueueCompleteness reports a truncated rollup as incomplete", () => {
  const dto = { items: [], truncated: true, evaluationErrorCount: 0 };
  const completeness = projectReviewQueueCompleteness(dto);
  assert.deepEqual(completeness, { truncated: true, evaluationErrorCount: 0 });
  assert.equal(reviewQueueIsComplete(completeness), false);
});

test("projectReviewQueueCompleteness reports a rollup with evaluation errors as incomplete", () => {
  const dto = { items: [], truncated: false, evaluationErrorCount: 3 };
  const completeness = projectReviewQueueCompleteness(dto);
  assert.deepEqual(completeness, { truncated: false, evaluationErrorCount: 3 });
  assert.equal(reviewQueueIsComplete(completeness), false);
});

test("projectReviewQueueCompleteness defaults to complete for a missing/malformed dto", () => {
  assert.deepEqual(projectReviewQueueCompleteness(null), { truncated: false, evaluationErrorCount: 0 });
  assert.equal(reviewQueueIsComplete(projectReviewQueueCompleteness(null)), true);
});

// Review Queue closure: conclusive global-empty decision (this package) -
// reviewQueueIsConclusivelyEmpty is the ONLY authority for the
// "Nothing currently needs attention for this organization." assertion. It
// must return true ONLY when both the claim-attention rollup and the
// sensitivity/allowed-use rollup are independently, successfully, and
// conclusively empty - never merely because both happen to report zero
// items while either side's request state is unknown, still loading, or
// failed. `baseInputs` below is the fully-conclusive-zero case; each
// regression below flips exactly one input away from that baseline.
const conclusivelyEmptyBaseInputs = Object.freeze({
  reviewQueueRequestState: "success",
  reviewQueueCompleteness: { truncated: false, evaluationErrorCount: 0 },
  reviewQueueItemsLength: 0,
  sensitivityCapabilityRequestState: "success",
  sensitivityCapability: true,
  sensitivityAttentionStatus: "ready",
  sensitivityAttentionItemsLength: 0,
});

test("reviewQueueIsConclusivelyEmpty: true only for a fully conclusive zero on both sides", () => {
  assert.equal(reviewQueueIsConclusivelyEmpty(conclusivelyEmptyBaseInputs), true);
});

test("reviewQueueIsConclusivelyEmpty: false while the claim-attention request has not resolved", () => {
  assert.equal(
    reviewQueueIsConclusivelyEmpty({ ...conclusivelyEmptyBaseInputs, reviewQueueRequestState: "idle" }),
    false,
  );
  assert.equal(
    reviewQueueIsConclusivelyEmpty({ ...conclusivelyEmptyBaseInputs, reviewQueueRequestState: "loading" }),
    false,
  );
});

test("reviewQueueIsConclusivelyEmpty: false when the claim-attention request failed", () => {
  assert.equal(
    reviewQueueIsConclusivelyEmpty({ ...conclusivelyEmptyBaseInputs, reviewQueueRequestState: "error" }),
    false,
  );
});

test("reviewQueueIsConclusivelyEmpty: false when the claim-attention rollup was truncated", () => {
  assert.equal(
    reviewQueueIsConclusivelyEmpty({
      ...conclusivelyEmptyBaseInputs,
      reviewQueueCompleteness: { truncated: true, evaluationErrorCount: 0 },
    }),
    false,
  );
});

test("reviewQueueIsConclusivelyEmpty: false when the claim-attention rollup has evaluation errors", () => {
  assert.equal(
    reviewQueueIsConclusivelyEmpty({
      ...conclusivelyEmptyBaseInputs,
      reviewQueueCompleteness: { truncated: false, evaluationErrorCount: 2 },
    }),
    false,
  );
});

test("reviewQueueIsConclusivelyEmpty: false when the claim-attention rollup has items", () => {
  assert.equal(
    reviewQueueIsConclusivelyEmpty({ ...conclusivelyEmptyBaseInputs, reviewQueueItemsLength: 1 }),
    false,
  );
});

test("reviewQueueIsConclusivelyEmpty: false while the sensitivity capability is unknown/loading", () => {
  assert.equal(
    reviewQueueIsConclusivelyEmpty({
      ...conclusivelyEmptyBaseInputs,
      sensitivityCapabilityRequestState: "idle",
      sensitivityCapability: null,
      sensitivityAttentionStatus: "unavailable",
      sensitivityAttentionItemsLength: 0,
    }),
    false,
  );
  assert.equal(
    reviewQueueIsConclusivelyEmpty({
      ...conclusivelyEmptyBaseInputs,
      sensitivityCapabilityRequestState: "loading",
      sensitivityCapability: null,
      sensitivityAttentionStatus: "unavailable",
      sensitivityAttentionItemsLength: 0,
    }),
    false,
  );
});

test("reviewQueueIsConclusivelyEmpty: false when the sensitivity capability request failed", () => {
  assert.equal(
    reviewQueueIsConclusivelyEmpty({
      ...conclusivelyEmptyBaseInputs,
      sensitivityCapabilityRequestState: "error",
      sensitivityCapability: false,
      sensitivityAttentionStatus: "unavailable",
      sensitivityAttentionItemsLength: 0,
    }),
    false,
  );
});

test("reviewQueueIsConclusivelyEmpty: false when the sensitivity capability was successfully denied", () => {
  assert.equal(
    reviewQueueIsConclusivelyEmpty({
      ...conclusivelyEmptyBaseInputs,
      sensitivityCapabilityRequestState: "success",
      sensitivityCapability: false,
      sensitivityAttentionStatus: "unavailable",
      sensitivityAttentionItemsLength: 0,
    }),
    false,
  );
});

test("reviewQueueIsConclusivelyEmpty: false while the sensitivity queue read is loading", () => {
  assert.equal(
    reviewQueueIsConclusivelyEmpty({
      ...conclusivelyEmptyBaseInputs,
      sensitivityAttentionStatus: "loading",
    }),
    false,
  );
});

test("reviewQueueIsConclusivelyEmpty: false when the sensitivity queue read failed", () => {
  assert.equal(
    reviewQueueIsConclusivelyEmpty({
      ...conclusivelyEmptyBaseInputs,
      sensitivityAttentionStatus: "error",
    }),
    false,
  );
});

test("reviewQueueIsConclusivelyEmpty: false when the sensitivity queue has items", () => {
  assert.equal(
    reviewQueueIsConclusivelyEmpty({ ...conclusivelyEmptyBaseInputs, sensitivityAttentionItemsLength: 1 }),
    false,
  );
});

// Review Queue closure: sensitivity/allowed-use composition (section 6A) -
// an authorized, successful, zero-item sensitivity read must render as a
// genuine 0 while other current-attention items remain visible. The "other
// attention items remain visible" half of this is already proven by the
// claim-traceability rollup test above: sensitivityReviewQueueAttention is a
// pure projection over its own inputs only and never touches reviewQueueItems,
// so a zero-item sensitivity result can never suppress them.
test("sensitivityReviewQueueAttention: authorized zero-item read is a genuine 0, independent of other current attention", () => {
  const attention = sensitivityReviewQueueAttention({
    sensitivityCapability: true,
    loadingSensitivityReviewQueue: false,
    sensitivityReviewQueueError: "",
    sensitivityReviewQueueItems: [],
  });
  assert.deepEqual(attention, { status: "ready", items: [] });
});

test("sensitivityReviewQueueAttention: authorized non-empty read surfaces its existing items", () => {
  const items = [{ reviewQueueItemId: "q1", intakeSensitivityProfileId: "p1", summary: "file.pdf" }];
  const attention = sensitivityReviewQueueAttention({
    sensitivityCapability: true,
    loadingSensitivityReviewQueue: false,
    sensitivityReviewQueueError: "",
    sensitivityReviewQueueItems: items,
  });
  assert.equal(attention.status, "ready");
  assert.deepEqual(attention.items, items);
});

// Review Queue closure: sensitivity/allowed-use composition (section 6B) -
// none of capability unknown/loading, queue loading, queue error, or denied
// capability may ever be reported as a successful zero-item result.
test("sensitivityReviewQueueAttention: capability unknown/loading never renders as a successful zero", () => {
  const attention = sensitivityReviewQueueAttention({
    sensitivityCapability: null,
    loadingSensitivityReviewQueue: false,
    sensitivityReviewQueueError: "",
    sensitivityReviewQueueItems: [],
  });
  assert.equal(attention.status, "unavailable");
  assert.notEqual(attention.status, "ready");
});

test("sensitivityReviewQueueAttention: capability denied is preserved as unavailable, never a false 0", () => {
  const attention = sensitivityReviewQueueAttention({
    sensitivityCapability: false,
    loadingSensitivityReviewQueue: false,
    sensitivityReviewQueueError: "",
    sensitivityReviewQueueItems: [],
  });
  assert.deepEqual(attention, { status: "unavailable", items: [] });
});

test("sensitivityReviewQueueAttention: queue read in flight never renders as a successful zero", () => {
  const attention = sensitivityReviewQueueAttention({
    sensitivityCapability: true,
    loadingSensitivityReviewQueue: true,
    sensitivityReviewQueueError: "",
    sensitivityReviewQueueItems: [],
  });
  assert.equal(attention.status, "loading");
  assert.notEqual(attention.status, "ready");
});

test("sensitivityReviewQueueAttention: queue read failure never renders as a successful zero", () => {
  const attention = sensitivityReviewQueueAttention({
    sensitivityCapability: true,
    loadingSensitivityReviewQueue: false,
    sensitivityReviewQueueError: "internal error",
    sensitivityReviewQueueItems: [],
  });
  assert.equal(attention.status, "error");
  assert.equal(attention.error, "internal error");
  assert.notEqual(attention.status, "ready");
});

// Capability B: organization-level Gaps and Risks. projectOrganizationGapsAndRisks
// is a pure re-composition over the SAME reviewQueueItems the Review Queue
// section already fetches and projects (projectReviewQueue -> projectTraceability
// per claim) - these tests build real raw traceability DTOs and push them through
// the real projectReviewQueue pipeline first, exactly like the Review Queue tests
// above, so the composition under test is the real one, not a hand-built shape.
function rawTraceabilityDtoFixture(overrides = {}) {
  return {
    requestedAudience: "internal",
    eligible: false,
    blockerCodes: ["coverage_dimension_unresolved"],
    affectedDimensionKeys: [],
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
    dimensions: {},
    gap_items: [],
    client_followup_workflows: [],
    potential_conflict_groups: [],
    truncated: false,
    ...overrides,
  };
}

test("projectOrganizationGapsAndRisks: a dimension that blocks the requested audience is a current gap; an accepted/non-blocking dimension is not", () => {
  const dto = rawTraceabilityDtoFixture({
    dimensions: {
      denominator_clarity: {
        assessment_status: "unresolved",
        validator_key: "VAL-KAI-P2-02-denominator_clarity",
        internal_limitation_accepted: false,
        funder_limitation_accepted: false,
        blocks_requested_audience: true,
      },
      time_period_clarity: {
        assessment_status: "unresolved",
        validator_key: "VAL-KAI-P2-02-time_period_clarity",
        internal_limitation_accepted: true,
        funder_limitation_accepted: false,
        blocks_requested_audience: false,
      },
    },
  });
  const items = projectReviewQueue({ items: [dto] });
  const gapsAndRisks = projectOrganizationGapsAndRisks(items);
  assert.deepEqual(gapsAndRisks.gaps, [
    { claimId, dimensionKey: "denominator_clarity", assessmentStatus: "unresolved", validatorKey: "VAL-KAI-P2-02-denominator_clarity" },
  ]);
  assert.deepEqual(gapsAndRisks.conflicts, []);
  assert.deepEqual(gapsAndRisks.followups, []);
});

test("projectOrganizationGapsAndRisks: a potential-conflict group is current unless its review AND workflow are both resolved/terminal", () => {
  const dto = rawTraceabilityDtoFixture({
    blockerCodes: ["potential_conflict_review_unresolved"],
    potential_conflict_groups: [
      {
        conflict_group_id: "cg-open",
        lower_claim_id: claimId,
        higher_claim_id: "00000000-0000-4000-8000-000000000999",
        lower_claim_conflict_gap_id: "g-lower",
        higher_claim_conflict_gap_id: "g-higher",
        basis_code: "contradictory_finding",
        review_queue_item_id: "q1",
        review_status: "needs_gk_review",
        workflow_status: "open",
      },
      {
        conflict_group_id: "cg-resolved-but-workflow-open",
        lower_claim_id: claimId,
        higher_claim_id: "00000000-0000-4000-8000-000000000998",
        lower_claim_conflict_gap_id: "g-lower2",
        higher_claim_conflict_gap_id: "g-higher2",
        basis_code: "overlapping_scope",
        review_queue_item_id: "q2",
        review_status: "resolved",
        workflow_status: "open",
      },
      {
        conflict_group_id: "cg-closed",
        lower_claim_id: claimId,
        higher_claim_id: "00000000-0000-4000-8000-000000000997",
        lower_claim_conflict_gap_id: "g-lower3",
        higher_claim_conflict_gap_id: "g-higher3",
        basis_code: "stale_source",
        review_queue_item_id: "q3",
        review_status: "resolved",
        workflow_status: "closed",
      },
    ],
  });
  const items = projectReviewQueue({ items: [dto] });
  const gapsAndRisks = projectOrganizationGapsAndRisks(items);
  const conflictGroupIds = gapsAndRisks.conflicts.map((conflict) => conflict.conflictGroupId);
  assert.ok(conflictGroupIds.includes("cg-open"));
  assert.ok(conflictGroupIds.includes("cg-resolved-but-workflow-open"));
  assert.ok(!conflictGroupIds.includes("cg-closed"));
  assert.equal(gapsAndRisks.conflicts.length, 2);
});

test("projectOrganizationGapsAndRisks: a client follow-up is current unless its review is resolved AND it is not waiting on the client", () => {
  const dto = rawTraceabilityDtoFixture({
    blockerCodes: ["client_followup_unresolved"],
    gap_items: [{ gap_log_item_id: "g1", dimension_key: "denominator_clarity", assessment_status: "unresolved", validator_key: "VAL-KAI-P2-02-denominator_clarity" }],
    client_followup_workflows: [
      { client_followup_item_id: "cf-waiting", gap_log_item_id: "g1", dimension_key: "denominator_clarity", workflow_status: "waiting_on_client", review_status: "resolved", review_queue_item_id: "q4" },
      { client_followup_item_id: "cf-proposed", gap_log_item_id: "g1", dimension_key: "denominator_clarity", workflow_status: "proposed", review_status: "needs_gk_review", review_queue_item_id: "q5" },
      { client_followup_item_id: "cf-resolved", gap_log_item_id: "g1", dimension_key: "denominator_clarity", workflow_status: "closed", review_status: "resolved", review_queue_item_id: "q6" },
    ],
  });
  const items = projectReviewQueue({ items: [dto] });
  const gapsAndRisks = projectOrganizationGapsAndRisks(items);
  const followupIds = gapsAndRisks.followups.map((followup) => followup.clientFollowupItemId);
  assert.ok(followupIds.includes("cf-waiting"));
  assert.ok(followupIds.includes("cf-proposed"));
  assert.ok(!followupIds.includes("cf-resolved"));
  assert.equal(gapsAndRisks.followups.length, 2);
});

test("projectOrganizationGapsAndRisks: an empty or missing rollup returns an explicit empty projection", () => {
  assert.deepEqual(projectOrganizationGapsAndRisks([]), { gaps: [], conflicts: [], followups: [] });
  assert.deepEqual(projectOrganizationGapsAndRisks(null), { gaps: [], conflicts: [], followups: [] });
});

const gapsAndRisksEmptyBaseInputs = Object.freeze({
  reviewQueueRequestState: "success",
  reviewQueueCompleteness: { truncated: false, evaluationErrorCount: 0 },
  gapsAndRisks: { gaps: [], conflicts: [], followups: [] },
});

test("organizationGapsAndRisksIsConclusivelyEmpty: true only for a fully conclusive, successful, complete zero", () => {
  assert.equal(organizationGapsAndRisksIsConclusivelyEmpty(gapsAndRisksEmptyBaseInputs), true);
});

test("organizationGapsAndRisksIsConclusivelyEmpty: false while the rollup request has not resolved", () => {
  assert.equal(
    organizationGapsAndRisksIsConclusivelyEmpty({ ...gapsAndRisksEmptyBaseInputs, reviewQueueRequestState: "loading" }),
    false,
  );
  assert.equal(
    organizationGapsAndRisksIsConclusivelyEmpty({ ...gapsAndRisksEmptyBaseInputs, reviewQueueRequestState: "error" }),
    false,
  );
});

test("organizationGapsAndRisksIsConclusivelyEmpty: false when the rollup was truncated or had evaluation errors", () => {
  assert.equal(
    organizationGapsAndRisksIsConclusivelyEmpty({
      ...gapsAndRisksEmptyBaseInputs,
      reviewQueueCompleteness: { truncated: true, evaluationErrorCount: 0 },
    }),
    false,
  );
  assert.equal(
    organizationGapsAndRisksIsConclusivelyEmpty({
      ...gapsAndRisksEmptyBaseInputs,
      reviewQueueCompleteness: { truncated: false, evaluationErrorCount: 1 },
    }),
    false,
  );
});

test("organizationGapsAndRisksIsConclusivelyEmpty: false when any one of gaps/conflicts/followups is non-empty", () => {
  assert.equal(
    organizationGapsAndRisksIsConclusivelyEmpty({
      ...gapsAndRisksEmptyBaseInputs,
      gapsAndRisks: { gaps: [{ claimId }], conflicts: [], followups: [] },
    }),
    false,
  );
  assert.equal(
    organizationGapsAndRisksIsConclusivelyEmpty({
      ...gapsAndRisksEmptyBaseInputs,
      gapsAndRisks: { gaps: [], conflicts: [{ conflictGroupId: "cg1" }], followups: [] },
    }),
    false,
  );
  assert.equal(
    organizationGapsAndRisksIsConclusivelyEmpty({
      ...gapsAndRisksEmptyBaseInputs,
      gapsAndRisks: { gaps: [], conflicts: [], followups: [{ clientFollowupItemId: "cf1" }] },
    }),
    false,
  );
});

// Source-contract: the dedicated Gaps and Risks section must be discoverable
// on /impact-library without a manual claim-id entry, must load the real
// organization-scoped rollup (the existing review-queue endpoint - no new
// route or fan-out), and must leave the existing Review Queue / Claims /
// Traceability panels intact.
test("Impact Evidence Library renders a dedicated organization-level Gaps and Risks section sourced from the existing review-queue rollup, with no new fetch and no manual claim-id entry", () => {
  const uiSource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");

  assert.match(uiSource, /import \{[\s\S]*?projectOrganizationGapsAndRisks[\s\S]*?\} from "\.\/impactEvidenceLibraryLogic\.js";/);
  assert.match(uiSource, /import \{[\s\S]*?organizationGapsAndRisksIsConclusivelyEmpty[\s\S]*?\} from "\.\/impactEvidenceLibraryLogic\.js";/);
  assert.match(uiSource, /Gaps and Risks/);
  assert.match(uiSource, /projectOrganizationGapsAndRisks\(reviewQueueItems\)/);
  // No second organization-scope fetch/path was introduced for this section -
  // it is derived only from reviewQueueItems, which loadReviewQueue already
  // populates from the existing organizationReviewQueuePath endpoint.
  assert.doesNotMatch(uiSource, /gapsAndRisksPath|organizationGapsPath|OrganizationEvidenceGap/);
  // No free-text claim-id input for this section.
  assert.doesNotMatch(uiSource, /<input[^>]*value=\{selectedClaimId\}[^>]*onChange/);
  // The existing Review Queue heading/section remains present and unchanged.
  assert.match(uiSource, /Review Queue<\/h5>/);
  // The existing Claims panel remains present and unchanged.
  assert.match(uiSource, /<h5 className="mb-0">Claims<\/h5>/);
});
