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
  listClaimLibraryCandidates,
  __claimLibraryServiceContract,
} from "../Backend/kai/services/kaiClaimLibraryService.js";
import { listClaimLibraryReviewCandidates } from "../Backend/kai/db/kaiClaimLibraryReadModels.js";
import {
  canCompleteGeneratedContentReview,
  canStartGeneratedContentReview,
  claimLibraryCandidatesPath,
  claimTraceabilityPath,
  createEvidenceSummaryPath,
  eligibleClaimsPath,
  generatedContentReviewCompletePath,
  generatedContentReviewStartPath,
  generatedDraftReviewPacketPath,
  getJson,
  mergeClaims,
  postJson,
  projectCandidateClaims,
  projectEligibleClaims,
  projectGeneratedDraftPacket,
  projectTraceability,
  reviewTransitionBody,
} from "../frontend/impactEvidenceLibraryLogic.js";

const basePath = "/api/kai/sprint2/intake";
const organizationId = "00000000-0000-4000-8000-000000000001";
const otherOrganizationId = "00000000-0000-4000-8000-000000000002";
const claimId = "00000000-0000-4000-8000-000000000101";
const evidenceItemId = "00000000-0000-4000-8000-000000000201";
const reviewQueueItemId = "00000000-0000-4000-8000-000000000301";
const actorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  organizationMemberships: [
    { organization_id: organizationId, membership_status: "active", role_name: "gk_reviewer" },
  ],
});

function row(overrides = {}) {
  return {
    claim_id: claimId,
    organization_id: organizationId,
    evidence_item_id: evidenceItemId,
    claim_type: "impact_metric",
    claim_status: "proposed",
    claim_review_status: "needs_gk_review",
    claim_strength: "unassessed",
    review_queue_items: [{
      review_queue_item_id: reviewQueueItemId,
      queue_type: "claim_review",
      target_object_type: "claim",
      target_object_id: claimId,
      queue_status: "blocked",
      review_status: "needs_gk_review",
      raw_content: "must not render",
      signed_url: "must not render",
    }],
    raw_content: "must not render",
    signed_url: "must not render",
    ...overrides,
  };
}

function scenario(overrides = {}) {
  return {
    authenticated: true,
    actorContext,
    calls: [],
    result: {
      ok: true,
      data: { items: [], limit: 25, afterClaimId: null, truncated: false, nextAfterClaimId: null },
      error: null,
    },
    events: [],
    ...overrides,
  };
}

function createApp(getScenario) {
  const app = express();
  app.use(basePath, setKaiSprint2NoStore, requireKaiSprint2Enabled, kaiSprint2MetadataJsonParser);
  app.use(basePath, handleKaiSprint2JsonParserError);
  app.use(basePath, (req, res, next) => {
    const current = getScenario();
    current.events.push("outer_feature_gate_passed");
    req.isAuthenticated = () => {
      current.events.push("canonical_http_authentication");
      return current.authenticated;
    };
    if (current.authenticated) {
      req.user = { id: 46 };
      req.kaiSprint2ActorContext = current.actorContext;
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

async function postRequestJson(server, path, body) {
  const { port } = server.address();
  return await new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const request = http.request({
      hostname: "127.0.0.1",
      port,
      path,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        statusCode: response.statusCode,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
      }));
    });
    request.on("error", reject);
    request.end(payload);
  });
}

test("Impact Evidence Library claim-index route is mounted once as authenticated read-only GET", () => {
  const matches = sprint2IntakeApiRouter.stack
    .filter((layer) => layer.route?.path === "/admin/organizations/:organizationId/claim-library/candidates" && layer.route?.methods?.get);
  assert.equal(matches.length, 1);
  assert.deepEqual(Object.keys(matches[0].route.methods), ["get"]);
});

test("Impact Evidence Library internal evidence-summary generation routes are mounted with narrow methods", () => {
  const createMatches = sprint2IntakeApiRouter.stack
    .filter((layer) => layer.route?.path === "/admin/organizations/:organizationId/generated-content-drafts/evidence-summary" && layer.route?.methods?.post);
  const readMatches = sprint2IntakeApiRouter.stack
    .filter((layer) => layer.route?.path === "/admin/organizations/:organizationId/generated-content-drafts/:generatedContentDraftId/review-packet" && layer.route?.methods?.get);
  const startMatches = sprint2IntakeApiRouter.stack
    .filter((layer) => layer.route?.path === "/admin/organizations/:organizationId/generated-content-drafts/:generatedContentDraftId/generated-content-review-queue/:reviewQueueItemId/start" && layer.route?.methods?.post);
  const completeMatches = sprint2IntakeApiRouter.stack
    .filter((layer) => layer.route?.path === "/admin/organizations/:organizationId/generated-content-drafts/:generatedContentDraftId/generated-content-review-queue/:reviewQueueItemId/complete" && layer.route?.methods?.post);
  assert.equal(createMatches.length, 1);
  assert.equal(readMatches.length, 1);
  assert.equal(startMatches.length, 1);
  assert.equal(completeMatches.length, 1);
  assert.deepEqual(Object.keys(createMatches[0].route.methods), ["post"]);
  assert.deepEqual(Object.keys(readMatches[0].route.methods), ["get"]);
  assert.deepEqual(Object.keys(startMatches[0].route.methods), ["post"]);
  assert.deepEqual(Object.keys(completeMatches[0].route.methods), ["post"]);
});

test("Impact Evidence Library create route pins evidence_summary/internal and accepts no browser prompt, text, citations, evidence ids, or authority", async (t) => {
  let current = scenario({
    result: {
      ok: true,
      data: {
        generatedContentDraftId: "00000000-0000-4000-8000-000000000777",
        requestedAudience: "internal",
        draftStatus: "draft",
        reviewQueueItemId: "00000000-0000-4000-8000-000000000778",
        blocks: [{ ordinal: 1, text: "A.", citations: [{ claimId, evidenceItemId }] }],
      },
      error: null,
    },
  });
  const originalFeatureFlag = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "true";
  const restore = intakeRouteTestables.setIntakeServiceForTest({
    async createEvidenceSummaryDraft(input, deps) {
      current.calls.push({ input, deps });
      return current.result;
    },
  });
  const server = await listen(createApp(() => current));

  t.after(async () => {
    restore();
    if (originalFeatureFlag === undefined) delete process.env.KAI_SPRINT2_ENABLED;
    else process.env.KAI_SPRINT2_ENABLED = originalFeatureFlag;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const path = `${basePath}/admin/organizations/${organizationId}/generated-content-drafts/evidence-summary`;
  const rejected = await postRequestJson(server, path, {
    claim_ids: [claimId],
    idempotency_key: "p3-stage-a",
    prompt: "write anything",
  });
  assert.equal(rejected.statusCode, 422);
  assert.deepEqual(current.calls, []);

  const allowed = await postRequestJson(server, path, {
    claim_ids: [claimId],
    idempotency_key: "p3-stage-a",
  });
  assert.equal(allowed.statusCode, 201);
  assert.equal(current.calls.length, 1);
  assert.deepEqual(current.calls[0].input, {
    organizationId,
    requestedAudience: "internal",
    claimIds: [claimId],
    idempotencyKey: "p3-stage-a",
    actorContext,
    now: current.calls[0].input.now,
  });
  assert.match(current.calls[0].input.now, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(typeof current.calls[0].deps.draftGenerator, "function");
  assert.equal(typeof current.calls[0].deps.metadataOnlyAudit?.prepareMetadataOnlyAudit, "function");
});

test("Impact Evidence Library P3-02 route delegates to the existing generated-draft review packet service", async (t) => {
  const generatedContentDraftId = "00000000-0000-4000-8000-000000000777";
  let current = scenario({
    result: {
      ok: true,
      data: {
        generationRunId: "00000000-0000-4000-8000-000000000779",
        generatedContentDraftId,
        contentType: "evidence_summary",
        draftStatus: "draft",
        requestedAudience: "internal",
        reviewQueueItemId: "00000000-0000-4000-8000-000000000778",
        queueStatus: "open",
        reviewStatus: "needs_gk_review",
        currentUseEligible: true,
        blocks: [{ ordinal: 1, text: "A.", citations: [] }],
      },
      error: null,
    },
  });
  const originalFeatureFlag = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "true";
  const restore = intakeRouteTestables.setIntakeServiceForTest({
    async getGeneratedDraftReviewPacket(input) {
      current.calls.push(input);
      return current.result;
    },
  });
  const server = await listen(createApp(() => current));

  t.after(async () => {
    restore();
    if (originalFeatureFlag === undefined) delete process.env.KAI_SPRINT2_ENABLED;
    else process.env.KAI_SPRINT2_ENABLED = originalFeatureFlag;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const response = await requestJson(server, `${basePath}/admin/organizations/${organizationId}/generated-content-drafts/${generatedContentDraftId}/review-packet`);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(current.calls, [{ organizationId, generatedContentDraftId, actorContext }]);
});

test("Impact Evidence Library generated-content-review transition routes accept only expected_updated_at and server-owned authority", async (t) => {
  const generatedContentDraftId = "00000000-0000-4000-8000-000000000777";
  const generatedReviewQueueItemId = "00000000-0000-4000-8000-000000000778";
  const expectedUpdatedAt = "2026-08-15T10:00:00.000Z";
  let current = scenario({
    result: { ok: true, data: { queueStatus: "in_progress", reviewStatus: "needs_gk_review" }, error: null },
  });
  const originalFeatureFlag = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "true";
  const restore = intakeRouteTestables.setIntakeServiceForTest({
    async startGeneratedContentReview(input, deps) {
      current.calls.push({ operation: "start", input, deps });
      return current.result;
    },
    async completeGeneratedContentReview(input, deps) {
      current.calls.push({ operation: "complete", input, deps });
      return { ok: true, data: { queueStatus: "resolved", reviewStatus: "resolved" }, error: null };
    },
  });
  const server = await listen(createApp(() => current));

  t.after(async () => {
    restore();
    if (originalFeatureFlag === undefined) delete process.env.KAI_SPRINT2_ENABLED;
    else process.env.KAI_SPRINT2_ENABLED = originalFeatureFlag;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const startPath = `${basePath}/admin/organizations/${organizationId}/generated-content-drafts/${generatedContentDraftId}/generated-content-review-queue/${generatedReviewQueueItemId}/start`;
  const rejected = await postRequestJson(server, startPath, { expected_updated_at: expectedUpdatedAt, actorContext: { role: "evil" } });
  assert.equal(rejected.statusCode, 422);
  assert.deepEqual(current.calls, []);

  const started = await postRequestJson(server, startPath, { expected_updated_at: expectedUpdatedAt });
  assert.equal(started.statusCode, 200);
  assert.equal(current.calls.length, 1);
  assert.equal(current.calls[0].operation, "start");
  assert.deepEqual(current.calls[0].input, {
    organizationId,
    generatedContentDraftId,
    reviewQueueItemId: generatedReviewQueueItemId,
    expectedUpdatedAt,
    actorContext,
    now: current.calls[0].input.now,
  });
  assert.equal(typeof current.calls[0].deps.metadataOnlyAudit?.prepareMetadataOnlyAudit, "function");

  const completePath = `${basePath}/admin/organizations/${organizationId}/generated-content-drafts/${generatedContentDraftId}/generated-content-review-queue/${generatedReviewQueueItemId}/complete`;
  const completed = await postRequestJson(server, completePath, { expected_updated_at: expectedUpdatedAt });
  assert.equal(completed.statusCode, 200);
  assert.equal(current.calls[1].operation, "complete");
});

test("Impact Evidence Library claim-index route reuses the existing cockpit/read access boundary", async (t) => {
  let current = scenario();
  const originalFeatureFlag = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "true";
  const restore = intakeRouteTestables.setIntakeServiceForTest({
    async listClaimLibraryCandidates(input) {
      current.calls.push(input);
      return current.result;
    },
  });
  const server = await listen(createApp(() => current));

  t.after(async () => {
    restore();
    if (originalFeatureFlag === undefined) delete process.env.KAI_SPRINT2_ENABLED;
    else process.env.KAI_SPRINT2_ENABLED = originalFeatureFlag;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  current = scenario({ authenticated: false });
  const denied = await requestJson(server, `${basePath}/admin/organizations/${organizationId}/claim-library/candidates?limit=25`);
  assert.equal(denied.statusCode, 401);
  assert.deepEqual(current.calls, []);

  current = scenario();
  const allowed = await requestJson(server, `${basePath}/admin/organizations/${organizationId}/claim-library/candidates?limit=25`);
  assert.equal(allowed.statusCode, 200);
  assert.deepEqual(current.calls, [{
    organizationId,
    limit: 25,
    afterClaimId: null,
    actorContext,
  }]);

  current = scenario();
  const clientAuthorityAttempt = await requestJson(
    server,
    `${basePath}/admin/organizations/${organizationId}/claim-library/candidates?limit=25&actorUserId=evil&organization_id=${otherOrganizationId}`,
  );
  assert.equal(clientAuthorityAttempt.statusCode, 422);
  assert.deepEqual(current.calls, []);
});

test("Impact Evidence Library claim-index service authorizes like the existing internal cockpit read and fails closed when disabled", async () => {
  let calls = 0;
  const deps = {
    env: { KAI_SPRINT2_ENABLED: "true" },
    async listClaimLibraryReviewCandidates() {
      calls += 1;
      return [row()];
    },
  };
  const allowed = await listClaimLibraryCandidates({ organizationId, limit: 25, afterClaimId: null, actorContext }, deps);
  assert.equal(allowed.ok, true);
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(allowed).includes("must not render"), false);
  assert.equal(allowed.data.items[0].reviewQueueItems[0].queue_status, "blocked");

  const deniedRole = await listClaimLibraryCandidates({
    organizationId,
    limit: 25,
    afterClaimId: null,
    actorContext: {
      ...actorContext,
      organizationMemberships: [{ organization_id: organizationId, membership_status: "active", role_name: "client_reviewer" }],
    },
  }, deps);
  assert.equal(deniedRole.ok, false);
  assert.equal(deniedRole.error.code, "authorization_denied");

  const disabled = await listClaimLibraryCandidates(
    { organizationId, limit: 25, afterClaimId: null, actorContext },
    { ...deps, env: { KAI_SPRINT2_ENABLED: "false" } },
  );
  assert.equal(disabled.ok, false);
  assert.equal(disabled.error.code, "feature_disabled");
});

test("Impact Evidence Library read model is bounded, organization-scoped, ordered, and read-only", async () => {
  let observed = null;
  await listClaimLibraryReviewCandidates(organizationId, { limit: 25, afterClaimId: claimId }, {
    async query(sql, params) {
      observed = { sql, params };
      return { rows: [] };
    },
  });
  assert.match(observed.sql, /WHERE c\.organization_id = \$1::uuid/);
  assert.match(observed.sql, /AND c\.claim_id > \$3::uuid/);
  assert.match(observed.sql, /ORDER BY claim_id ASC/);
  assert.match(observed.sql, /LIMIT \$2::int/);
  assert.match(observed.sql, /claim_id::text AS claim_id/);
  assert.match(observed.sql, /review_queue_item_id::text/);
  assert.doesNotMatch(observed.sql, /kai\.client_followup_items|kai\.conflict_groups/);
  assert.deepEqual(observed.params, [organizationId, 26, claimId]);
  assert.doesNotMatch(observed.sql, /\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bTRUNCATE\b|FOR UPDATE/i);
});

test("Impact Evidence Library frontend paths preserve audience, claim, and server-owned organization transport", async () => {
  assert.equal(
    eligibleClaimsPath(organizationId, "funder"),
    `${basePath}/admin/organizations/${organizationId}/eligible-claims?requested_audience=funder&limit=25`,
  );
  assert.equal(
    claimTraceabilityPath(organizationId, claimId, "public"),
    `${basePath}/admin/organizations/${organizationId}/claims/${claimId}/traceability?requested_audience=public`,
  );
  assert.equal(
    claimLibraryCandidatesPath(organizationId),
    `${basePath}/admin/organizations/${organizationId}/claim-library/candidates?limit=25`,
  );

  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (path, init) => {
    calls.push({ path, init });
    return { status: 200, json: async () => ({ ok: true, data: {} }) };
  };
  try {
    await getJson(eligibleClaimsPath(organizationId, "internal"));
    assert.equal(calls[0].init.method, "GET");
    assert.equal(calls[0].init.credentials, "same-origin");
    assert.equal(calls[0].init.headers.Accept, "application/json");
    assert.equal(calls[0].init.body, undefined);
  } finally {
    global.fetch = originalFetch;
  }
});

test("Impact Evidence Library frontend projections compose P2-08 and P2-06 without browser eligibility or blocker computation", () => {
  const usable = projectEligibleClaims({
    requestedAudience: "internal",
    eligibleClaims: [{
      claimId,
      evidenceItemId,
      claimType: "impact_metric",
      claimStatus: "approved",
      claimReviewStatus: "approved",
      supportStrength: "strong",
      sourceId: "00000000-0000-4000-8000-000000000401",
      sourceVersionId: "00000000-0000-4000-8000-000000000501",
      requestedAudience: "internal",
      raw_content: "must not render",
    }],
  });
  assert.equal(usable[0].libraryStatus, "usable");

  const candidates = projectCandidateClaims({
    items: [{
      claimId: "00000000-0000-4000-8000-000000000102",
      evidenceItemId,
      claimType: "impact_metric",
      claimStatus: "proposed",
      claimReviewStatus: "needs_gk_review",
      claimStrength: "unassessed",
      reviewQueueItems: [{ review_queue_item_id: reviewQueueItemId, queue_type: "claim_review", queue_status: "blocked" }],
    }],
  });
  assert.equal(candidates[0].libraryStatus, "needs_review");

  const traceability = projectTraceability({
    requestedAudience: "internal",
    eligible: false,
    blockerCodes: ["coverage_dimension_unresolved"],
    affectedDimensionKeys: ["definition_clarity"],
    affectedObjectIds: [reviewQueueItemId],
    claim: { audience_gates: { internal_only: true } },
    evidence: { evidence_item_id: evidenceItemId },
    source: { source_id: "00000000-0000-4000-8000-000000000401" },
    source_version: { source_version_id: "00000000-0000-4000-8000-000000000501" },
    claim_review: { queue_status: "resolved", review_status: "resolved" },
    dimensions: {
      definition_clarity: {
        assessment_status: "unresolved",
        validator_key: "definition_clarity",
        internal_limitation_accepted: true,
        blocks_requested_audience: false,
      },
    },
    gap_items: [],
    client_followup_workflows: [{
      client_followup_item_id: "00000000-0000-4000-8000-000000000601",
      gap_log_item_id: "00000000-0000-4000-8000-000000000602",
      dimension_key: "definition_clarity",
      workflow_status: "resolved",
      review_status: "resolved",
      review_queue_item_id: "00000000-0000-4000-8000-000000000603",
    }],
    potential_conflict_groups: [],
    raw_content: "must not render",
  });
  assert.equal(traceability.libraryStatus, "blocked");
  assert.equal(traceability.dimensions[0].displayStatus, "known_limitation");
  assert.equal(traceability.clientFollowupWorkflows[0].workflowDisposition, "completed_workflow_obligation");
  assert.equal(JSON.stringify(traceability).includes("must not render"), false);

  const packet = projectGeneratedDraftPacket({
    generatedContentDraftId: "00000000-0000-4000-8000-000000000777",
    contentType: "evidence_summary",
    draftStatus: "draft",
    requestedAudience: "internal",
    reviewQueueItemId,
    queueStatus: "open",
    reviewStatus: "needs_gk_review",
    reviewUpdatedAt: "2026-08-15T10:00:00.000Z",
    currentUseEligible: true,
    blocks: [{
      ordinal: 1,
      text: "Enrollment increased by 12% in 2025.",
      raw_content: "must not render",
      citations: [{
        claimId,
        evidenceItemId,
        sourceId: "00000000-0000-4000-8000-000000000401",
        sourceVersionId: "00000000-0000-4000-8000-000000000501",
        supportStrength: "strong",
        currentEligible: true,
        signed_url: "must not render",
      }],
    }],
  });
  assert.equal(packet.contentType, "evidence_summary");
  assert.equal(packet.requestedAudience, "internal");
  assert.equal(packet.draftStatus, "draft");
  assert.equal(canStartGeneratedContentReview(packet), true);
  assert.equal(canCompleteGeneratedContentReview(packet), false);
  assert.deepEqual(reviewTransitionBody(packet.reviewUpdatedAt), { expected_updated_at: "2026-08-15T10:00:00.000Z" });
  assert.match(generatedContentReviewStartPath(organizationId, packet.generatedContentDraftId, packet.reviewQueueItemId), /generated-content-review-queue/);
  assert.match(generatedContentReviewCompletePath(organizationId, packet.generatedContentDraftId, packet.reviewQueueItemId), /complete$/);
  assert.equal(JSON.stringify(packet).includes("must not render"), false);

  assert.deepEqual(mergeClaims(usable, candidates).map((claim) => claim.libraryStatus), ["usable", "needs_review"]);
});

test("Impact Evidence Library source has only the Stage-A internal generation call and no assistant, export, or raw-source paths", () => {
  const serviceSource = readFileSync("Backend/kai/services/kaiClaimLibraryService.js", "utf8");
  const readModelSource = readFileSync("Backend/kai/db/kaiClaimLibraryReadModels.js", "utf8");
  const uiSource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");
  const logicSource = readFileSync("frontend/impactEvidenceLibraryLogic.js", "utf8");

  assert.deepEqual([...__claimLibraryServiceContract.CLAIM_LIBRARY_READ_ROLES], ["gk_admin", "gk_operator", "gk_reviewer"]);
  assert.equal(__claimLibraryServiceContract.CLAIM_LIBRARY_READ_OPERATION, "read_intake");
  assert.doesNotMatch(
    serviceSource,
    /completeEvidenceReview|completeClaimReview|recordCoverageReviewDecision|completeClientFollowup|createGenerated/i,
  );
  assert.doesNotMatch(readModelSource, /\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bTRUNCATE\b|FOR UPDATE/i);
  assert.match(uiSource + logicSource, /generated-content-drafts\/evidence-summary/);
  assert.match(uiSource + logicSource, /claim_ids/);
  assert.match(uiSource + logicSource, /idempotency_key/);
  assert.doesNotMatch(uiSource + logicSource, /\bPUT\b|\bPATCH\b|\bDELETE\b|assistant|export-review|export candidate/i);
  assert.doesNotMatch(uiSource + logicSource, /raw_content|signed_url|storage_object|api[_-]?key|secret/i);
});
