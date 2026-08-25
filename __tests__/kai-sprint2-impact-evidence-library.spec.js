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
  annotateGovernedAvailability,
  canCompleteGeneratedContentReview,
  canSelectClaimForInternalGeneration,
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
  nextLibraryStateForAudienceChange,
  nextLibraryStateForOrganizationChange,
  postJson,
  projectCandidateClaims,
  projectEligibleClaims,
  projectGeneratedDraftPacket,
  projectTraceability,
  reviewTransitionBody,
  shouldApplyCandidateResponse,
  shouldApplyEligibilityResponse,
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

test("Impact Evidence Library read model admits claims from kai.claims without requiring a review queue match", async () => {
  let observed = null;
  await listClaimLibraryReviewCandidates(organizationId, { limit: 25, afterClaimId: null }, {
    async query(sql, params) {
      observed = { sql, params };
      return { rows: [] };
    },
  });
  // The claim base is a plain FROM kai.claims with an optional LEFT JOIN, so a
  // claim with zero matching review_queue_items rows must still be selected.
  assert.match(observed.sql, /FROM kai\.claims c\s+LEFT JOIN kai\.review_queue_items q/);
  assert.doesNotMatch(observed.sql, /(?<!LEFT )JOIN kai\.review_queue_items/);
  assert.match(observed.sql, /q\.organization_id = c\.organization_id/);
  assert.match(
    observed.sql,
    /COALESCE\(\s*jsonb_agg\([\s\S]*?\)\s*FILTER \(WHERE q\.review_queue_item_id IS NOT NULL\),\s*'\[\]'::jsonb\s*\)/,
  );
});

test("Impact Evidence Library service exposes reviewQueueItems: [] and preserves unresolved claim state when no queue rows exist", async () => {
  const noQueueRow = row({ review_queue_items: [] });
  const deps = {
    env: { KAI_SPRINT2_ENABLED: "true" },
    async listClaimLibraryReviewCandidates() {
      return [noQueueRow];
    },
  };
  const result = await listClaimLibraryCandidates({ organizationId, limit: 25, afterClaimId: null, actorContext }, deps);
  assert.equal(result.ok, true);
  assert.equal(result.data.items.length, 1);
  const candidate = result.data.items[0];
  assert.equal(candidate.claimId, claimId);
  assert.equal(candidate.evidenceItemId, evidenceItemId);
  assert.deepEqual(candidate.reviewQueueItems, []);
  // Unresolved/unassessed state is returned unchanged; availability did not
  // require clearing claim_review_status or claim_strength.
  assert.equal(candidate.claimReviewStatus, "needs_gk_review");
  assert.equal(candidate.claimStrength, "unassessed");
});

test("Impact Evidence Library service returns exactly one claim when both claim_review and evidence_review metadata exist", async () => {
  const evidenceReviewQueueItemId = "00000000-0000-4000-8000-000000000302";
  const bothQueuesRow = row({
    review_queue_items: [
      {
        review_queue_item_id: reviewQueueItemId,
        queue_type: "claim_review",
        target_object_type: "claim",
        target_object_id: claimId,
        queue_status: "blocked",
        review_status: "needs_gk_review",
      },
      {
        review_queue_item_id: evidenceReviewQueueItemId,
        queue_type: "evidence_review",
        target_object_type: "evidence_item",
        target_object_id: evidenceItemId,
        queue_status: "open",
        review_status: "needs_gk_review",
      },
    ],
  });
  const deps = {
    env: { KAI_SPRINT2_ENABLED: "true" },
    async listClaimLibraryReviewCandidates() {
      return [bothQueuesRow];
    },
  };
  const result = await listClaimLibraryCandidates({ organizationId, limit: 25, afterClaimId: null, actorContext }, deps);
  assert.equal(result.ok, true);
  assert.equal(result.data.items.length, 1);
  assert.equal(result.data.items[0].reviewQueueItems.length, 2);
  assert.deepEqual(
    result.data.items[0].reviewQueueItems.map((item) => item.review_queue_item_id),
    [reviewQueueItemId, evidenceReviewQueueItemId],
  );
});

test("Impact Evidence Library read model scopes both the claim base and the optional queue join to the requested organization", async () => {
  let observed = null;
  await listClaimLibraryReviewCandidates(organizationId, { limit: 25, afterClaimId: null }, {
    async query(sql, params) {
      observed = { sql, params };
      return { rows: [] };
    },
  });
  assert.match(observed.sql, /WHERE c\.organization_id = \$1::uuid/);
  assert.match(observed.sql, /q\.organization_id = c\.organization_id/);
  assert.deepEqual(observed.params, [organizationId, 26]);
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

test("Impact Evidence Library bootstraps its organization selection from the server, never from a typed or fabricated id", () => {
  const uiSource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");

  // No free-text organization id input: the browser can no longer type/guess one.
  assert.doesNotMatch(uiSource, /<input[^>]*value=\{organizationId\}/);
  assert.doesNotMatch(uiSource, /onChange=\{\(event\) => setOrganizationId\(event\.target\.value\.trim\(\)\)\}/);

  // The organization list bootstraps from the existing server-authoritative
  // /admin/organizations route on mount and auto-selects a single result,
  // matching the established KAI Web Intake / Review Cockpit pattern.
  assert.match(uiSource, /import \{ organizationsPath \} from "\.\/kaiWebIntakeLogic\.js";/);
  assert.match(uiSource, /useEffect\(\(\) => \{[\s\S]*?getJson\(organizationsPath\(\)\)/);
  assert.match(uiSource, /items\.length === 1[\s\S]{0,80}setOrganizationId\(items\[0\]\.organization_id\)/);

  // Explicit empty/loading states are rendered rather than fabricating an id.
  assert.match(uiSource, /Loading your organizations\.\.\./);
  assert.match(uiSource, /No KAI organization is available for this account\./);
});

// Package 14-04: governed internal availability, audience eligibility, and
// review/strength/coverage/follow-up state are independent dimensions. None
// of them may be derived from, or gate, one another.

test("Package 14-04 case A/B/H: governed availability and audience eligibility are independent per claim", () => {
  const governedClaim = { claimId, claimReviewStatus: "needs_gk_review", claimStrength: "unassessed", libraryStatus: "needs_review" };
  const otherClaimId = "00000000-0000-4000-8000-000000000102";
  const eligibleClaim = { claimId: otherClaimId, libraryStatus: "usable" };

  // Case A: governed + ineligible claim remains present and is marked governed.
  const ineligibleAnnotated = annotateGovernedAvailability([governedClaim], [governedClaim], [], "success");
  assert.equal(ineligibleAnnotated.length, 1);
  assert.equal(ineligibleAnnotated[0].governedAvailable, true);
  assert.equal(ineligibleAnnotated[0].audienceEligibility, "not_eligible");

  // Case B: the two dimensions are reported separately, never collapsed.
  assert.notEqual(ineligibleAnnotated[0].governedAvailable, ineligibleAnnotated[0].audienceEligibility === "eligible");

  // Case H: a genuinely eligible claim still reports eligible.
  const bothAnnotated = annotateGovernedAvailability([governedClaim], [governedClaim], [governedClaim], "success");
  assert.equal(bothAnnotated[0].governedAvailable, true);
  assert.equal(bothAnnotated[0].audienceEligibility, "eligible");
});

test("Package 14-04 case C: unresolved review/strength state travels with the governed claim, unaltered by eligibility", () => {
  const unresolvedClaim = {
    claimId,
    claimReviewStatus: "needs_gk_review",
    claimStrength: "unassessed",
    libraryStatus: "needs_review",
  };
  const [annotated] = annotateGovernedAvailability([unresolvedClaim], [unresolvedClaim], [], "success");
  assert.equal(annotated.claimReviewStatus, "needs_gk_review");
  assert.equal(annotated.claimStrength, "unassessed");
  assert.equal(annotated.audienceEligibility, "not_eligible");
  assert.equal(annotated.governedAvailable, true);
});

test("Package 14-04 case D/E: an eligible-claims failure or empty result never removes a governed claim", () => {
  const governedClaim = { claimId, libraryStatus: "needs_review" };

  // Case D: eligible-claims request rejected -> eligibleRequestState "error".
  // The claim from the all-state Claim Library remains in the annotated list.
  const onFailure = annotateGovernedAvailability([governedClaim], [governedClaim], [], "error");
  assert.equal(onFailure.length, 1);
  assert.equal(onFailure[0].governedAvailable, true);
  assert.equal(onFailure[0].audienceEligibility, "eligibility_unavailable");

  // Case E: eligible-claims request succeeded with no matching claim for the
  // audience -> eligibleRequestState "success", eligibleClaims empty.
  const onEmpty = annotateGovernedAvailability([governedClaim], [governedClaim], [], "success");
  assert.equal(onEmpty.length, 1);
  assert.equal(onEmpty[0].governedAvailable, true);
  assert.equal(onEmpty[0].audienceEligibility, "not_eligible");
});

test("Package 14-04 case F: a Claim Library failure does not fabricate governed availability for an eligible-only claim", () => {
  const eligibleOnlyClaim = { claimId, libraryStatus: "usable" };
  const [annotated] = annotateGovernedAvailability([eligibleOnlyClaim], [], [eligibleOnlyClaim], "success");
  assert.equal(annotated.governedAvailable, false);
  assert.equal(annotated.audienceEligibility, "eligible");
});

test("Package 14-04 case M: sensitivity metadata renders independently and does not affect eligibility/availability data", () => {
  const traceability = projectTraceability({
    requestedAudience: "internal",
    eligible: false,
    blockerCodes: ["coverage_dimension_unresolved"],
    claim: { audience_gates: {} },
    evidence: { evidence_item_id: evidenceItemId, sensitivity_level: "unknown" },
    dimensions: {},
    client_followup_workflows: [],
    potential_conflict_groups: [],
  });
  assert.equal(traceability.evidence.sensitivity_level, "unknown");
  assert.equal(traceability.eligible, false);
  assert.equal(traceability.libraryStatus, "blocked");
});

test("Package 14-04: the historical eligible-claims-failure setClaims([]) clearing path is removed from the component", () => {
  const uiSource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");

  // The all-state Claim Library and audience-eligible-claims requests are
  // fetched, loaded, and errored independently.
  assert.match(uiSource, /loadCandidateClaims/);
  assert.match(uiSource, /loadEligibleClaims/);
  assert.match(uiSource, /loadingCandidateClaims/);
  assert.match(uiSource, /loadingEligibleClaims/);
  assert.match(uiSource, /candidateClaimsError/);
  assert.match(uiSource, /eligibleClaimsError/);

  // The eligible-claims failure branch no longer clears all-state claim data.
  assert.doesNotMatch(uiSource, /setClaims\(\[\]\)/);

  // Case G: the claims list renders unconditionally, not gated behind either
  // request's own loading state.
  assert.match(uiSource, /<div className="list-group">\s*\{claims\.map/);

  // Case I/J: organization changes reset stale state, and independently
  // in-flight requests are invalidated via separate generation guards so a
  // late cross-organization response cannot populate the new view. These are
  // supplemental structural/wiring checks only — the authoritative proof of
  // the transition and acceptance-predicate behavior is the executed
  // pure-function regressions below (14-04 lifecycle closure).
  assert.match(uiSource, /import \{[\s\S]*?nextLibraryStateForOrganizationChange[\s\S]*?\} from "\.\/impactEvidenceLibraryLogic\.js";/);
  assert.match(uiSource, /import \{[\s\S]*?nextLibraryStateForAudienceChange[\s\S]*?\} from "\.\/impactEvidenceLibraryLogic\.js";/);
  assert.match(uiSource, /import \{[\s\S]*?shouldApplyCandidateResponse[\s\S]*?\} from "\.\/impactEvidenceLibraryLogic\.js";/);
  assert.match(uiSource, /import \{[\s\S]*?shouldApplyEligibilityResponse[\s\S]*?\} from "\.\/impactEvidenceLibraryLogic\.js";/);
  assert.match(uiSource, /useEffect\(\(\) => \{\s*candidateRequestGenerationRef\.current \+= 1;\s*eligibleRequestGenerationRef\.current \+= 1;[\s\S]*?nextLibraryStateForOrganizationChange\(\)[\s\S]*?\}, \[organizationId\]\);/);
  assert.match(uiSource, /useEffect\(\(\) => \{\s*eligibleRequestGenerationRef\.current \+= 1;[\s\S]*?nextLibraryStateForAudienceChange\(\)[\s\S]*?\}, \[audience\]\);/);
  assert.match(uiSource, /shouldApplyCandidateResponse\(\{/);
  assert.match(uiSource, /shouldApplyEligibilityResponse\(\{/);

  // Each dispatched request must allocate a new generation so the executed
  // stale/newer-response predicates model behavior the component can actually
  // produce, not only manually constructed generation values in unit tests.
  assert.match(
    uiSource,
    /const requestGeneration = \+\+candidateRequestGenerationRef\.current;/,
  );
  assert.match(
    uiSource,
    /const requestGeneration = \+\+eligibleRequestGenerationRef\.current;/,
  );

  // Case K: no deployed-assistant capability claim is made anywhere in the
  // human-facing Impact Evidence Library UI or logic.
  const logicSource = readFileSync("frontend/impactEvidenceLibraryLogic.js", "utf8");
  assert.doesNotMatch(uiSource + logicSource, /Available to KAI/i);
  assert.match(uiSource, /internally available \(governed\)/);
});

// 14-04 lifecycle closure: two concrete defects (organization change can
// strand loading flags; old audience eligibility can be shown under a new
// audience's label) are corrected via pure, executed transition/predicate
// functions rather than source-pattern assertions. See
// nextLibraryStateForOrganizationChange, nextLibraryStateForAudienceChange,
// shouldApplyCandidateResponse, shouldApplyEligibilityResponse.

test("14-04 closure case A: organization change resets both loading flags and clears organization-scoped state", () => {
  const next = nextLibraryStateForOrganizationChange();
  assert.equal(next.loadingCandidateClaims, false);
  assert.equal(next.loadingEligibleClaims, false);
  assert.deepEqual(next.candidateClaims, []);
  assert.deepEqual(next.eligibleClaims, []);
  assert.equal(next.candidateClaimsError, "");
  assert.equal(next.eligibleClaimsError, "");
  assert.equal(next.eligibleRequestState, "idle");
  assert.equal(next.selectedClaimId, "");
  assert.deepEqual(next.selectedGenerationClaimIds, []);
  assert.equal(next.traceability, null);
  assert.equal(next.generatedDraftPacket, null);
});

test("14-04 closure case B/F: organization change invalidates both candidate and eligibility request identities, rejecting late org-A responses", () => {
  const orgA = "00000000-0000-4000-8000-000000000001";
  const orgB = "00000000-0000-4000-8000-000000000002";

  // Candidate request started under org A, generation 1.
  const candidateAccepted = shouldApplyCandidateResponse({
    requestGeneration: 1,
    currentGeneration: 1,
    requestOrganizationId: orgA,
    currentOrganizationId: orgA,
  });
  assert.equal(candidateAccepted, true);

  // Organization changes to org B: generation advances to 2 and the current
  // organization is now org B. The stale org-A/generation-1 response must be
  // rejected on both dimensions.
  const candidateRejected = shouldApplyCandidateResponse({
    requestGeneration: 1,
    currentGeneration: 2,
    requestOrganizationId: orgA,
    currentOrganizationId: orgB,
  });
  assert.equal(candidateRejected, false);

  const eligibilityRejected = shouldApplyEligibilityResponse({
    requestGeneration: 1,
    currentGeneration: 2,
    requestOrganizationId: orgA,
    currentOrganizationId: orgB,
    requestAudience: "internal",
    currentAudience: "internal",
  });
  assert.equal(eligibilityRejected, false);
});

test("14-04 closure case C: audience change preserves candidateClaims and resets only the eligibility dimension", () => {
  const candidateClaims = [{ claimId, libraryStatus: "needs_review" }];
  const next = nextLibraryStateForAudienceChange();
  assert.equal("candidateClaims" in next, false);
  assert.deepEqual(next.eligibleClaims, []);
  assert.equal(next.eligibleClaimsError, "");
  assert.equal(next.eligibleRequestState, "idle");
  assert.equal(next.loadingEligibleClaims, false);
  // candidateClaims is untouched by this transition: applying it must not
  // overwrite the caller's existing candidateClaims array.
  assert.deepEqual(candidateClaims, [{ claimId, libraryStatus: "needs_review" }]);
});

test("14-04 closure case D: an old audience's eligibility result cannot be applied once the audience changes", () => {
  // Eligibility request started while audience = internal, generation 1.
  const acceptedWhileInternal = shouldApplyEligibilityResponse({
    requestGeneration: 1,
    currentGeneration: 1,
    requestOrganizationId: organizationId,
    currentOrganizationId: organizationId,
    requestAudience: "internal",
    currentAudience: "internal",
  });
  assert.equal(acceptedWhileInternal, true);

  // Audience changes to public: eligibility generation advances to 2, and
  // the current audience is now "public". The late internal-audience
  // response must never attach itself to the public audience.
  const rejectedAfterAudienceChange = shouldApplyEligibilityResponse({
    requestGeneration: 1,
    currentGeneration: 2,
    requestOrganizationId: organizationId,
    currentOrganizationId: organizationId,
    requestAudience: "internal",
    currentAudience: "public",
  });
  assert.equal(rejectedAfterAudienceChange, false);
});

test("14-04 closure case E: audience change does not invalidate or reject an in-flight governed candidate request", () => {
  // A candidate (Claim Library) request is active for the current
  // organization at generation 1. Audience change bumps only the
  // eligibility generation (modeled here by leaving the candidate
  // generation/organization untouched), so the candidate request's own
  // acceptance predicate must still accept its own response.
  const candidateStillAccepted = shouldApplyCandidateResponse({
    requestGeneration: 1,
    currentGeneration: 1,
    requestOrganizationId: organizationId,
    currentOrganizationId: organizationId,
  });
  assert.equal(candidateStillAccepted, true);
});

test("14-04 closure case G: a stale earlier response cannot clear or overwrite state owned by a newer request of the same dimension", () => {
  // Request 1 (stale) and request 2 (current) both target the same
  // organization/audience; only request 2's generation is current.
  const staleRequestAccepted = shouldApplyEligibilityResponse({
    requestGeneration: 1,
    currentGeneration: 2,
    requestOrganizationId: organizationId,
    currentOrganizationId: organizationId,
    requestAudience: "internal",
    currentAudience: "internal",
  });
  assert.equal(staleRequestAccepted, false);

  const currentRequestAccepted = shouldApplyEligibilityResponse({
    requestGeneration: 2,
    currentGeneration: 2,
    requestOrganizationId: organizationId,
    currentOrganizationId: organizationId,
    requestAudience: "internal",
    currentAudience: "internal",
  });
  assert.equal(currentRequestAccepted, true);
});

// Package 14-05: internal evidence-summary generation admission is governed
// internal availability (presence in the all-state Claim Library), not
// audience/use eligibility (libraryStatus === "usable"). These are EXECUTED
// assertions against the pure helper itself -- the authoritative proof of the
// admission decision. Source-pattern assertions further below prove only
// that the component WIRES its three admission locations to this helper;
// they are not proof of the decision's correctness.

test("Package 14-05 case A: a governed claim that is blocked/needs_review is still admitted for internal generation", () => {
  assert.equal(canSelectClaimForInternalGeneration(
    { claimId, governedAvailable: true, libraryStatus: "blocked" },
    "internal",
  ), true);
  assert.equal(canSelectClaimForInternalGeneration(
    { claimId, governedAvailable: true, libraryStatus: "needs_review" },
    "internal",
  ), true);
});

test("Package 14-05 case B: a governed claim that is currently eligible/usable is still admitted for internal generation", () => {
  assert.equal(canSelectClaimForInternalGeneration(
    { claimId, governedAvailable: true, libraryStatus: "usable" },
    "internal",
  ), true);
});

test("Package 14-05 case C: a non-governed (eligible-only merge) entry is never admitted, even if it appears usable/eligible", () => {
  assert.equal(canSelectClaimForInternalGeneration(
    { claimId, governedAvailable: false, libraryStatus: "usable" },
    "internal",
  ), false);
});

test("Package 14-05 case D: the funder audience never admits internal generation, regardless of governed availability", () => {
  assert.equal(canSelectClaimForInternalGeneration(
    { claimId, governedAvailable: true, libraryStatus: "usable" },
    "funder",
  ), false);
});

test("Package 14-05 case E: the public audience never admits internal generation, regardless of governed availability", () => {
  assert.equal(canSelectClaimForInternalGeneration(
    { claimId, governedAvailable: true, libraryStatus: "usable" },
    "public",
  ), false);
});

test("Package 14-05: canSelectClaimForInternalGeneration never derives admission from libraryStatus, audienceEligibility, eligible, review status, support strength, blocker count, coverage, or client-followup state", () => {
  // A claim with every disqualifying-looking display field, but governed and
  // internal, must still be admitted -- proving the decision is not derived
  // from any of those fields.
  assert.equal(canSelectClaimForInternalGeneration({
    claimId,
    governedAvailable: true,
    libraryStatus: "blocked",
    audienceEligibility: "not_eligible",
    eligible: false,
    claimReviewStatus: "needs_gk_review",
    supportStrength: "unassessed",
    blockerCodes: ["claim_review_unresolved", "evidence_review_unresolved"],
  }, "internal"), true);
});

// Component wiring (source-pattern assertions only): these prove the three
// admission locations in ImpactEvidenceLibrary.jsx delegate to the tested
// helper above. They do NOT prove the admission decision is correct -- that
// is proven exclusively by the executed cases A-E above.

test("Package 14-05 wiring: the component's three admission locations delegate to canSelectClaimForInternalGeneration (wiring only, not decision proof)", () => {
  const uiSource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");

  assert.match(uiSource, /import \{[\s\S]*?canSelectClaimForInternalGeneration[\s\S]*?\} from "\.\/impactEvidenceLibraryLogic\.js";/);

  // libraryStatus === "usable" / !== "usable" is no longer an admission rule
  // anywhere in the component.
  assert.doesNotMatch(uiSource, /claim\.libraryStatus\s*===\s*"usable"/);
  assert.doesNotMatch(uiSource, /claim\.libraryStatus\s*!==\s*"usable"/);

  // 1. pruning selectedGenerationClaimIds
  assert.match(
    uiSource,
    /setSelectedGenerationClaimIds\(\(current\) => current\.filter\(\(claimId\) => claims\.some\(\(claim\) => claim\.claimId === claimId && canSelectClaimForInternalGeneration\(claim, audience\)\)\)\);/,
  );
  // 2. generation-selection toggle/admission
  assert.match(
    uiSource,
    /const toggleGenerationClaim = useCallback\(\(claim\) => \{\s*if \(!canSelectClaimForInternalGeneration\(claim, audience\)\) return;/,
  );
  // 3. generation-checkbox/control admission
  assert.match(uiSource, /\{canSelectClaimForInternalGeneration\(claim, audience\) \? \(/);
});

test("14-04 closure case H: 14-04 governed availability / audience eligibility semantics remain intact", () => {
  const governedClaim = { claimId, claimReviewStatus: "needs_gk_review", claimStrength: "unassessed", libraryStatus: "needs_review" };
  const annotated = annotateGovernedAvailability([governedClaim], [governedClaim], [], "success");
  assert.equal(annotated[0].governedAvailable, true);
  assert.equal(annotated[0].audienceEligibility, "not_eligible");

  const onFailure = annotateGovernedAvailability([governedClaim], [governedClaim], [], "error");
  assert.equal(onFailure[0].governedAvailable, true);
  assert.equal(onFailure[0].audienceEligibility, "eligibility_unavailable");
});

test("Impact Evidence Library mounts KAI Web Intake under its authorized organization context", () => {
  const uiSource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");

  assert.match(
    uiSource,
    /import KaiWebIntake from "\.\/KaiWebIntake\.jsx";/,
  );

  assert.match(
    uiSource,
    /\{organizationId \? \([\s\S]*?<KaiWebIntake organizationId=\{organizationId\} embedded \/>[\s\S]*?\) : null\}/,
  );
});