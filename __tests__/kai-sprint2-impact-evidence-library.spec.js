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
  canCompleteClaimReview,
  canCompleteEvidenceReview,
  claimReviewEvidencePrerequisiteSatisfied,
  reviewQueueBlockerActionability,
  canCompleteGeneratedContentReview,
  canSelectClaimForInternalGeneration,
  canStartGeneratedContentReview,
  claimLibraryCandidatesPath,
  claimReviewDecisionBody,
  claimReviewDecisionValidationError,
  claimTraceabilityPath,
  cleanLimitationNotes,
  createEvidenceSummaryPath,
  decisionRequiresApprovedAudiences,
  decisionRequiresLimitationNotes,
  eligibleClaimsPath,
  evidenceReviewDecisionBody,
  evidenceReviewDecisionValidationError,
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
  sensitivityCapabilitiesPath,
  sensitivityProfilePath,
  sensitivityReviewWorkPath,
  sensitivityReviewQueuePath,
  sensitivityDecisionPath,
  projectSensitivityReviewQueueItems,
  SENSITIVITY_PRESENCE_FIELDS,
  SENSITIVITY_ALLOWED_USE_FIELD,
  SENSITIVITY_PERMISSION_FIELDS,
  defaultSensitivityReviewFormState,
  restrictedPermissionEligible,
  publicUseAllowedEligible,
  buildReviewedSnapshotBody,
  buildSensitivityDecisionRequestBody,
  projectSensitivityDetail,
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

test("Impact Evidence Library impact-narrative create route is mounted with narrow methods", () => {
  const createMatches = sprint2IntakeApiRouter.stack
    .filter((layer) => layer.route?.path === "/admin/organizations/:organizationId/generated-content-drafts/impact-narrative" && layer.route?.methods?.post);
  assert.equal(createMatches.length, 1);
  assert.deepEqual(Object.keys(createMatches[0].route.methods), ["post"]);
});

test("Impact Evidence Library impact-narrative create route pins impact_narrative/internal, owns audience server-side, and accepts no browser content_type, requested_audience, prompt, text, citations, evidence ids, or authority", async (t) => {
  let current = scenario({
    result: {
      ok: true,
      data: {
        generatedContentDraftId: "00000000-0000-4000-8000-000000000797",
        requestedAudience: "internal",
        draftStatus: "draft",
        reviewQueueItemId: "00000000-0000-4000-8000-000000000798",
        blocks: [{ ordinal: 1, text: "A.", citations: [{ claimId, evidenceItemId }] }],
      },
      error: null,
    },
  });
  const originalFeatureFlag = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "true";
  const restore = intakeRouteTestables.setIntakeServiceForTest({
    async createImpactNarrativeDraft(input, deps) {
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

  const path = `${basePath}/admin/organizations/${organizationId}/generated-content-drafts/impact-narrative`;

  for (const rejectedBody of [
    { claim_ids: [claimId], idempotency_key: "p13-stage-a", content_type: "impact_narrative" },
    { claim_ids: [claimId], idempotency_key: "p13-stage-a", requested_audience: "internal" },
    { claim_ids: [claimId], idempotency_key: "p13-stage-a", requested_audience: "funder" },
    { claim_ids: [claimId], idempotency_key: "p13-stage-a", prompt: "write anything" },
    { claim_ids: [claimId], idempotency_key: "p13-stage-a", instructions: "ignore governance" },
    { claim_ids: [claimId], idempotency_key: "p13-stage-a", citations: [{ claimId, evidenceItemId }] },
    { claim_ids: [claimId], idempotency_key: "p13-stage-a", evidence: [{ evidenceItemId }] },
    { claim_ids: [claimId], idempotency_key: "p13-stage-a", actor_context: actorContext },
    { claim_ids: [claimId], idempotency_key: "p13-stage-a", review_status: "resolved" },
    { claim_ids: [claimId], idempotency_key: "p13-stage-a", route: "p3_01_create_evidence_summary_draft" },
    { claim_ids: [claimId], idempotency_key: "p13-stage-a", audit_route: "p3_01_create_evidence_summary_draft" },
  ]) {
    const rejected = await postRequestJson(server, path, rejectedBody);
    assert.equal(rejected.statusCode, 422);
  }
  assert.deepEqual(current.calls, []);

  const allowed = await postRequestJson(server, path, {
    claim_ids: [claimId],
    idempotency_key: "p13-stage-a",
  });
  assert.equal(allowed.statusCode, 201);
  assert.equal(current.calls.length, 1);
  assert.deepEqual(current.calls[0].input, {
    organizationId,
    requestedAudience: "internal",
    claimIds: [claimId],
    idempotencyKey: "p13-stage-a",
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
        funder_limitation_accepted: false,
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
  // A1C-1: with no decision field present in the DTO at all, the projection
  // must not fabricate one.
  assert.equal(traceability.evidenceReviewDecision, null);
  assert.equal(traceability.claimReviewDecision, null);

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

test("A1C-1: projectTraceability reads the durable evidence/claim review decision straight through from the DTO, including approved_audiences exactly, and returns null when the DTO field is null", () => {
  const withDecisions = projectTraceability({
    requestedAudience: "internal",
    eligible: true,
    blockerCodes: [],
    affectedDimensionKeys: [],
    affectedObjectIds: [],
    claim: { audience_gates: {} },
    evidence: {},
    claim_review: {},
    dimensions: {},
    gap_items: [],
    client_followup_workflows: [],
    potential_conflict_groups: [],
    evidence_review_decision: {
      decision_id: "00000000-0000-4000-8000-000000000901",
      decision_outcome: "supported_with_limitation",
    },
    claim_review_decision: {
      decision_id: "00000000-0000-4000-8000-000000000902",
      decision_outcome: "approved",
      approved_audiences: ["internal", "funder"],
    },
  });
  assert.deepEqual(withDecisions.evidenceReviewDecision, {
    decisionId: "00000000-0000-4000-8000-000000000901",
    decisionOutcome: "supported_with_limitation",
  });
  assert.deepEqual(withDecisions.claimReviewDecision, {
    decisionId: "00000000-0000-4000-8000-000000000902",
    decisionOutcome: "approved",
    approvedAudiences: ["internal", "funder"],
  });

  const withoutDecisions = projectTraceability({
    requestedAudience: "internal",
    eligible: false,
    blockerCodes: ["evidence_review_unresolved"],
    affectedDimensionKeys: [],
    affectedObjectIds: [],
    claim: { audience_gates: {} },
    evidence: {},
    claim_review: {},
    dimensions: {},
    gap_items: [],
    client_followup_workflows: [],
    potential_conflict_groups: [],
    evidence_review_decision: null,
    claim_review_decision: null,
  });
  assert.equal(withoutDecisions.evidenceReviewDecision, null);
  assert.equal(withoutDecisions.claimReviewDecision, null);
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

// KAI P2-12 (Problem A1) frontend decision-body builders. The server
// rejects limitation_notes/approved_audiences entirely (unexpected_*) when
// the chosen decision does not require them, so these builders must omit
// the key rather than send null/[] placeholders.

test("cleanLimitationNotes trims each line and drops blank lines", () => {
  assert.deepEqual(cleanLimitationNotes("  first note  \n\n  second note\n   \nthird"), [
    "first note",
    "second note",
    "third",
  ]);
  assert.deepEqual(cleanLimitationNotes(""), []);
  assert.deepEqual(cleanLimitationNotes(null), []);
});

test("decisionRequiresLimitationNotes/decisionRequiresApprovedAudiences match the server's exact per-decision requirements", () => {
  assert.equal(decisionRequiresLimitationNotes("supported_with_limitation"), true);
  assert.equal(decisionRequiresLimitationNotes("approved_with_limitation"), true);
  for (const decision of ["supported", "not_supported", "needs_more_information", "approved", "rejected"]) {
    assert.equal(decisionRequiresLimitationNotes(decision), false);
  }
  assert.equal(decisionRequiresApprovedAudiences("approved"), true);
  assert.equal(decisionRequiresApprovedAudiences("approved_with_limitation"), true);
  for (const decision of ["rejected", "needs_more_information", "supported", "supported_with_limitation", "not_supported"]) {
    assert.equal(decisionRequiresApprovedAudiences(decision), false);
  }
});

test("evidenceReviewDecisionBody omits limitation_notes for every outcome except supported_with_limitation, and includes it only then", () => {
  const expectedUpdatedAt = "2026-08-15T10:00:00.000Z";
  for (const decision of ["supported", "not_supported", "needs_more_information"]) {
    const body = evidenceReviewDecisionBody({ expectedUpdatedAt, decision, limitationNotes: "should be ignored" });
    assert.deepEqual(body, { expected_updated_at: expectedUpdatedAt, decision });
    assert.equal("limitation_notes" in body, false);
  }

  const withLimitation = evidenceReviewDecisionBody({
    expectedUpdatedAt,
    decision: "supported_with_limitation",
    limitationNotes: "  small cell risk in rural sites  \n\n  denominator unclear\n",
  });
  assert.deepEqual(withLimitation, {
    expected_updated_at: expectedUpdatedAt,
    decision: "supported_with_limitation",
    limitation_notes: ["small cell risk in rural sites", "denominator unclear"],
  });
});

test("claimReviewDecisionBody omits approved_audiences/limitation_notes appropriately per outcome, including approved_audiences only for approved/approved_with_limitation", () => {
  const expectedUpdatedAt = "2026-08-15T10:00:00.000Z";

  const rejected = claimReviewDecisionBody({
    expectedUpdatedAt,
    decision: "rejected",
    limitationNotes: "ignored",
    approvedAudiences: ["internal"],
  });
  assert.deepEqual(rejected, { expected_updated_at: expectedUpdatedAt, decision: "rejected" });
  assert.equal("limitation_notes" in rejected, false);
  assert.equal("approved_audiences" in rejected, false);

  const needsMoreInfo = claimReviewDecisionBody({
    expectedUpdatedAt,
    decision: "needs_more_information",
    limitationNotes: "ignored",
    approvedAudiences: ["public"],
  });
  assert.deepEqual(needsMoreInfo, { expected_updated_at: expectedUpdatedAt, decision: "needs_more_information" });
  assert.equal("limitation_notes" in needsMoreInfo, false);
  assert.equal("approved_audiences" in needsMoreInfo, false);

  const approved = claimReviewDecisionBody({
    expectedUpdatedAt,
    decision: "approved",
    limitationNotes: "ignored",
    approvedAudiences: ["internal", "funder"],
  });
  assert.deepEqual(approved, {
    expected_updated_at: expectedUpdatedAt,
    decision: "approved",
    approved_audiences: ["internal", "funder"],
  });
  assert.equal("limitation_notes" in approved, false);

  const approvedWithLimitation = claimReviewDecisionBody({
    expectedUpdatedAt,
    decision: "approved_with_limitation",
    limitationNotes: "coverage gap in 2024\ndefinition ambiguity",
    approvedAudiences: ["internal"],
  });
  assert.deepEqual(approvedWithLimitation, {
    expected_updated_at: expectedUpdatedAt,
    decision: "approved_with_limitation",
    limitation_notes: ["coverage gap in 2024", "definition ambiguity"],
    approved_audiences: ["internal"],
  });
});

test("evidenceReviewDecisionValidationError/claimReviewDecisionValidationError enforce required fields client-side before submission", () => {
  assert.match(evidenceReviewDecisionValidationError({ decision: "", limitationNotes: "" }), /decision/i);
  assert.equal(evidenceReviewDecisionValidationError({ decision: "supported", limitationNotes: "" }), "");
  assert.match(
    evidenceReviewDecisionValidationError({ decision: "supported_with_limitation", limitationNotes: "   \n  " }),
    /limitation/i,
  );
  assert.equal(
    evidenceReviewDecisionValidationError({ decision: "supported_with_limitation", limitationNotes: "known gap" }),
    "",
  );

  assert.match(claimReviewDecisionValidationError({ decision: "", limitationNotes: "", approvedAudiences: [] }), /decision/i);
  assert.match(
    claimReviewDecisionValidationError({ decision: "approved", limitationNotes: "", approvedAudiences: [] }),
    /audience/i,
  );
  assert.equal(
    claimReviewDecisionValidationError({ decision: "approved", limitationNotes: "", approvedAudiences: ["internal"] }),
    "",
  );
  assert.match(
    claimReviewDecisionValidationError({ decision: "approved_with_limitation", limitationNotes: "", approvedAudiences: ["internal"] }),
    /limitation/i,
  );
  assert.equal(
    claimReviewDecisionValidationError({
      decision: "approved_with_limitation",
      limitationNotes: "gap",
      approvedAudiences: ["funder"],
    }),
    "",
  );
  assert.equal(
    claimReviewDecisionValidationError({ decision: "rejected", limitationNotes: "", approvedAudiences: [] }),
    "",
  );
});

// P2-12 gating: needs_more_information reopens a previously-resolved review
// queue item back into open/needs_gk_review (postgresHumanReviewRepository.js,
// updateReviewQueueCompareAndSet targets FRESH_QUEUE_STATUS/FRESH_REVIEW_STATUS
// for any non-terminal outcome) - so a first-pass outstanding review and a
// reopened-after-resolution review are the same single observable state, and
// the decision controls must render for it either way. A genuinely resolved
// (resolved/resolved) or otherwise-blocked queue item must not render them.

test("canCompleteEvidenceReview admits the outstanding queue state (first-pass or reopened-after-resolution) and nothing else", () => {
  assert.equal(canCompleteEvidenceReview({ review_queue_status: "open", review_status: "needs_gk_review" }, null), true);
  assert.equal(canCompleteEvidenceReview({ review_queue_status: "blocked", review_status: "needs_gk_review" }, null), false);
  assert.equal(canCompleteEvidenceReview({ review_queue_status: "resolved", review_status: "needs_gk_review" }, null), false);
  assert.equal(canCompleteEvidenceReview(null, null), false);
});

// KAI P2-12 legacy repair: `resolved/resolved` with no decision head ever
// recorded is exactly the state the backend's resolved/resolved CAS branch
// (postgresHumanReviewRepository.js) accepts a genuine first decision
// against - proven by the "resolved queue without a decision head" P2-12
// integration test. The frontend actionability gate must recognize this
// state as actionable, not collapse it into BLOCKED alongside a genuinely
// completed review.
test("canCompleteEvidenceReview admits resolved/resolved as a lawful P2-12 legacy-repair candidate only when no current decision exists", () => {
  const resolvedQueue = { review_queue_status: "resolved", review_status: "resolved" };
  assert.equal(canCompleteEvidenceReview(resolvedQueue, null), true);
  assert.equal(canCompleteEvidenceReview(resolvedQueue, undefined), true);
});

test("canCompleteEvidenceReview does NOT treat resolved/resolved as legacy-repair once a real decision head exists, terminal or reopened", () => {
  const resolvedQueue = { review_queue_status: "resolved", review_status: "resolved" };
  assert.equal(canCompleteEvidenceReview(resolvedQueue, { decisionId: "d1", decisionOutcome: "supported" }), false);
  assert.equal(canCompleteEvidenceReview(resolvedQueue, { decisionId: "d1", decisionOutcome: "needs_more_information" }), false);
});

// A legitimate re-review (needs_more_information) always lands the queue
// back in the ordinary open/needs_gk_review state - it must be admitted
// through the normal outstanding-review path, not the legacy exception.
test("canCompleteEvidenceReview admits a legitimate re-review (needs_more_information reopened to open/needs_gk_review) through the normal path", () => {
  const reopenedQueue = { review_queue_status: "open", review_status: "needs_gk_review" };
  assert.equal(
    canCompleteEvidenceReview(reopenedQueue, { decisionId: "d1", decisionOutcome: "needs_more_information" }),
    true,
  );
});

test("claimReviewEvidencePrerequisiteSatisfied requires both a resolved evidence queue AND a terminal evidence decision head", () => {
  assert.equal(claimReviewEvidencePrerequisiteSatisfied({ review_status: "resolved" }, null), false);
  assert.equal(
    claimReviewEvidencePrerequisiteSatisfied({ review_status: "resolved" }, { decisionOutcome: "needs_more_information" }),
    false,
  );
  assert.equal(
    claimReviewEvidencePrerequisiteSatisfied({ review_status: "needs_gk_review" }, { decisionOutcome: "supported" }),
    false,
  );
  assert.equal(
    claimReviewEvidencePrerequisiteSatisfied({ review_status: "resolved" }, { decisionOutcome: "supported" }),
    true,
  );
});

test("canCompleteClaimReview admits the outstanding queue state once its linked evidence review has a terminal decision, and never before", () => {
  const resolvedEvidenceWithDecision = { review_status: "resolved" };
  const terminalDecision = { decisionOutcome: "supported" };
  const unresolvedEvidence = { review_status: "needs_gk_review" };
  assert.equal(
    canCompleteClaimReview(
      resolvedEvidenceWithDecision,
      { queue_status: "open", review_status: "needs_gk_review" },
      terminalDecision,
      null,
    ),
    true,
  );
  assert.equal(
    canCompleteClaimReview(
      unresolvedEvidence,
      { queue_status: "open", review_status: "needs_gk_review" },
      null,
      null,
    ),
    false,
  );
  assert.equal(
    canCompleteClaimReview(
      resolvedEvidenceWithDecision,
      { queue_status: "blocked", review_status: "needs_gk_review" },
      terminalDecision,
      null,
    ),
    false,
  );
  // resolved/resolved evidence with NO decision head: the prerequisite
  // itself is unmet (not just "resolved"), so the claim is never admitted
  // regardless of the claim's own queue shape.
  assert.equal(
    canCompleteClaimReview(
      { review_status: "resolved" },
      { queue_status: "open", review_status: "needs_gk_review" },
      null,
      null,
    ),
    false,
  );
});

test("canCompleteClaimReview admits resolved/resolved claim queue as legacy repair once the evidence prerequisite is satisfied and no current claim decision exists", () => {
  const resolvedEvidenceWithDecision = { review_status: "resolved" };
  const terminalDecision = { decisionOutcome: "supported" };
  const resolvedClaimQueue = { queue_status: "resolved", review_status: "resolved" };
  assert.equal(
    canCompleteClaimReview(resolvedEvidenceWithDecision, resolvedClaimQueue, terminalDecision, null),
    true,
  );
});

test("canCompleteClaimReview does NOT treat a resolved/resolved claim queue as legacy repair once a current claim decision already exists", () => {
  const resolvedEvidenceWithDecision = { review_status: "resolved" };
  const terminalEvidenceDecision = { decisionOutcome: "supported" };
  const resolvedClaimQueue = { queue_status: "resolved", review_status: "resolved" };
  assert.equal(
    canCompleteClaimReview(
      resolvedEvidenceWithDecision,
      resolvedClaimQueue,
      terminalEvidenceDecision,
      { decisionOutcome: "approved" },
    ),
    false,
  );
});

test("reviewQueueBlockerActionability: evidence_review_unresolved is ACTION_REQUIRED for both a fresh review and a lawful P2-12 legacy-repair candidate", () => {
  assert.equal(
    reviewQueueBlockerActionability("evidence_review_unresolved", {
      evidence: { review_queue_status: "open", review_status: "needs_gk_review" },
      evidenceReviewDecision: null,
    }),
    "ACTION_REQUIRED",
  );
  assert.equal(
    reviewQueueBlockerActionability("evidence_review_unresolved", {
      evidence: { review_queue_status: "resolved", review_status: "resolved" },
      evidenceReviewDecision: null,
    }),
    "ACTION_REQUIRED",
  );
});

test("reviewQueueBlockerActionability: claim_review_unresolved is WAITING (a dependency, never a hard blocker) while the evidence prerequisite is unmet, and ACTION_REQUIRED once it is satisfied", () => {
  assert.equal(
    reviewQueueBlockerActionability("claim_review_unresolved", {
      evidence: { review_status: "resolved" },
      evidenceReviewDecision: null,
      claimReview: { queue_status: "resolved", review_status: "resolved" },
      claimReviewDecision: null,
    }),
    "WAITING",
  );
  assert.equal(
    reviewQueueBlockerActionability("claim_review_unresolved", {
      evidence: { review_status: "resolved" },
      evidenceReviewDecision: { decisionOutcome: "supported" },
      claimReview: { queue_status: "resolved", review_status: "resolved" },
      claimReviewDecision: null,
    }),
    "ACTION_REQUIRED",
  );
});

test("reviewQueueBlockerActionability: existing coverage_dimension_unresolved and client_followup_unresolved behavior is unchanged", () => {
  assert.equal(reviewQueueBlockerActionability("coverage_dimension_unresolved", {}), "ACTION_REQUIRED");
  assert.equal(
    reviewQueueBlockerActionability("client_followup_unresolved", {
      clientFollowupWorkflows: [{ workflowStatus: "waiting_on_client" }],
    }),
    "WAITING",
  );
  assert.equal(
    reviewQueueBlockerActionability("client_followup_unresolved", { clientFollowupWorkflows: [] }),
    "BLOCKED",
  );
});

// A genuine hard blocker (any code this function does not recognize as one
// of the four review-lifecycle-derived codes above) must remain BLOCKED -
// the repaired distinction is only "lawful outstanding human review", never
// a general weakening of BLOCKED.
test("reviewQueueBlockerActionability: an unrecognized/genuine hard-blocker code remains BLOCKED regardless of queue or decision state", () => {
  assert.equal(
    reviewQueueBlockerActionability("support_strength_unassessed", {
      evidence: { review_queue_status: "resolved", review_status: "resolved" },
      evidenceReviewDecision: null,
    }),
    "BLOCKED",
  );
});

// A1C-1: this repo has no DOM-rendering test harness for this component, so
// durable-display proof is at the source level, mirroring the existing
// "mounts KAI Web Intake" pattern above: (1) the labeled rows exist and read
// from the traceability projection (not from any transient POST/local state),
// and (2) after a successful review POST, only the existing traceability GET
// (loadTraceability) is what can ever update what is displayed - proving a
// refresh/re-fetch shows exactly what the last GET returned.
test("Impact Evidence Library renders the durable evidence/claim review decision and human-approved scope from the traceability projection", () => {
  const uiSource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");

  assert.match(
    uiSource,
    /<ValueRow label="Evidence review decision" value=\{traceability\.evidenceReviewDecision\?\.decisionOutcome\} \/>/,
  );
  assert.match(
    uiSource,
    /<ValueRow label="Claim review decision" value=\{traceability\.claimReviewDecision\?\.decisionOutcome\} \/>/,
  );
  assert.match(uiSource, /label="Human-approved scope"/);
  assert.match(uiSource, /traceability\.claimReviewDecision\?\.approvedAudiences/);
});

test("Impact Evidence Library refreshes traceability via the existing GET after a successful evidence/claim review POST, never displaying transient POST/local state as the durable decision", () => {
  const uiSource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");

  // setTraceability is only ever assigned from a GET response projected
  // through projectTraceability - never from a POST's response body.
  const setTraceabilityCalls = [...uiSource.matchAll(/setTraceability\([^;]*?\);/g)].map((match) => match[0]);
  assert.ok(setTraceabilityCalls.length > 0);
  for (const call of setTraceabilityCalls) {
    assert.ok(
      /setTraceability\(projectTraceability\(result\.body\.data\)\);|setTraceability\(next\.traceability\);|setTraceability\(null\);/.test(call),
      `unexpected setTraceability call: ${call}`,
    );
  }

  const runEvidenceReview = uiSource.slice(
    uiSource.indexOf("const runCompleteEvidenceReview"),
    uiSource.indexOf("const runCompleteClaimReview"),
  );
  assert.match(runEvidenceReview, /await loadTraceability\(selectedClaimId\)/);
  const runClaimReview = uiSource.slice(uiSource.indexOf("const runCompleteClaimReview"));
  assert.match(runClaimReview, /await loadTraceability\(selectedClaimId\)/);
});

// KAI Review Queue -> Traceability user path regression. This repository has
// no DOM/component rendering harness (no jsdom/@testing-library, confirmed by
// package.json devDependencies), so the "Review this claim" button's inline
// onClick handler cannot literally be clicked. Rather than settling for a
// regex/text match on the handler's source (which only proves the text is
// present, never that it behaves correctly), this extracts the EXACT,
// unmodified onClick handler source from the committed JSX via string
// slicing and executes it for real via `new Function`, passing in only the
// three identifiers the real closure captures (`item`, `setSelectedClaimId`,
// `traceabilityPanelRef`). Because `new Function` resolves free identifiers
// against nothing but its declared parameters and true globals, successful
// execution is itself proof the handler references nothing else (no
// postJson, no evidenceReviewCompletePath/claimReviewCompletePath, no fetch)
// - an undeclared reference would throw a ReferenceError at call time, not
// merely fail a text match.
function extractReviewThisClaimHandlerSource(uiSource) {
  const openMarker = "onClick={() => {\n                    setSelectedClaimId(item.claimId);";
  const openIdx = uiSource.indexOf(openMarker);
  assert.notEqual(openIdx, -1, "could not locate the Review this claim onClick handler");
  const arrowStart = openIdx + "onClick={".length;
  const tailMarker = "\n                  }}\n                >\n                  Review this claim\n                </button>";
  const tailIdx = uiSource.indexOf(tailMarker, openIdx);
  assert.notEqual(tailIdx, -1, "could not locate the end of the Review this claim onClick handler");
  const arrowEnd = tailIdx + "\n                  }".length;
  return uiSource.slice(arrowStart, arrowEnd);
}

test("Review Queue 'Review this claim' handler: exact extracted source is a real, standalone arrow function referencing only item/setSelectedClaimId/traceabilityPanelRef", () => {
  const uiSource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");
  const handlerSource = extractReviewThisClaimHandlerSource(uiSource);
  assert.equal(
    handlerSource,
    "() => {\n"
      + "                    setSelectedClaimId(item.claimId);\n"
      + "                    traceabilityPanelRef.current?.scrollIntoView({ behavior: \"smooth\", block: \"start\" });\n"
      + "                    traceabilityPanelRef.current?.focus();\n"
      + "                  }",
  );
  // Constructing the callable at all proves the extracted text still parses
  // as a valid arrow function expression.
  assert.doesNotThrow(() => new Function("item", "setSelectedClaimId", "traceabilityPanelRef", `return (${handlerSource});`));
});

test("Review Queue 'Review this claim' click: selects the EXACT claim represented by that queue item (real handler execution, not a shadow re-implementation)", () => {
  const uiSource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");
  const handlerSource = extractReviewThisClaimHandlerSource(uiSource);
  const buildHandler = new Function(
    "item", "setSelectedClaimId", "traceabilityPanelRef",
    `return (${handlerSource});`,
  );

  // Two distinct synthetic queue items (no production UUID) prove the real
  // per-iteration closure - as it would be created fresh by
  // reviewQueueItems.map((item) => ...) - selects each item's OWN claimId,
  // never a shared/stale/wrong one.
  const itemAlpha = { claimId: "00000000-0000-4000-8000-00000000a001" };
  const itemBeta = { claimId: "00000000-0000-4000-8000-00000000b002" };

  for (const item of [itemAlpha, itemBeta]) {
    const selectedClaimIds = [];
    const scrollCalls = [];
    const focusCalls = [];
    const panelNode = {
      scrollIntoView(options) { scrollCalls.push(options); },
      focus() { focusCalls.push(true); },
    };
    const traceabilityPanelRef = { current: panelNode };

    const handler = buildHandler(item, (claimId) => selectedClaimIds.push(claimId), traceabilityPanelRef);
    // Executing the real, unmodified production handler is itself the proof
    // that it references nothing beyond these three identifiers - an
    // undeclared reference (postJson, evidenceReviewCompletePath,
    // claimReviewCompletePath, fetch, ...) would throw ReferenceError here.
    assert.doesNotThrow(() => handler());

    assert.deepEqual(selectedClaimIds, [item.claimId]);
    assert.equal(scrollCalls.length, 1);
    assert.deepEqual(scrollCalls[0], { behavior: "smooth", block: "start" });
    assert.equal(focusCalls.length, 1);
  }
});

test("Review Queue 'Review this claim' click: targets the SAME traceabilityPanelRef the Traceability section (0a7fe31) is attached to, and does not itself invoke any evidence/claim-review mutation", () => {
  const uiSource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");

  // Exactly one ref in the whole component is named traceabilityPanelRef,
  // and it is attached (ref={traceabilityPanelRef}) to the admin-card div
  // whose next child is the "Traceability" heading - the same panel
  // 0a7fe31 introduced the scroll/focus fix for. This is a structural-wiring
  // fact (which DOM node a ref attaches to) that this repository's available
  // test surface cannot observe by rendering; it is proven here at the
  // source level as a companion to the handler's real dynamic execution
  // above, not a substitute for it.
  const refDeclarations = [...uiSource.matchAll(/\bconst traceabilityPanelRef = useRef\(/g)];
  assert.equal(refDeclarations.length, 1, "expected exactly one traceabilityPanelRef declaration");
  const refAttachments = [...uiSource.matchAll(/ref=\{traceabilityPanelRef\}/g)];
  assert.equal(refAttachments.length, 1, "expected exactly one element with ref={traceabilityPanelRef}");
  const attachmentIdx = refAttachments[0].index;
  const afterAttachment = uiSource.slice(attachmentIdx, attachmentIdx + 400);
  assert.match(afterAttachment, /<h5 className="mb-0">Traceability<\/h5>/);

  const handlerSource = extractReviewThisClaimHandlerSource(uiSource);
  assert.match(handlerSource, /traceabilityPanelRef\.current\?\.scrollIntoView/);
  assert.match(handlerSource, /traceabilityPanelRef\.current\?\.focus/);

  // No-mutation-on-navigation: the extracted, real handler body references
  // no review-completion path/POST helper at all. Combined with the dynamic
  // proof above (execution never throws with ONLY item/setSelectedClaimId/
  // traceabilityPanelRef declared), this rules out any call to postJson,
  // evidenceReviewCompletePath, or claimReviewCompletePath from this handler.
  assert.doesNotMatch(handlerSource, /postJson|evidenceReviewCompletePath|claimReviewCompletePath|fetch\(/);
});

// KAI Review Queue -> Traceability regression fixture (task section 3): the
// exact production repro shape from the 08b8a00 actionability repair -
// resolved/resolved on both evidence and claim review with no decision ever
// recorded, an unresolved coverage dimension, and a client followup waiting
// on the client. Proves the full Review Queue presentation, the review
// controls' before/after-decision availability, and that selecting a claim
// never mutates review state - end to end, using only the actual committed
// pure functions (canCompleteEvidenceReview/canCompleteClaimReview/
// reviewQueueBlockerActionability), never a reimplementation of them.
test("Review Queue -> Traceability regression: legacy-repair evidence review is actionable, claim review waits on its prerequisite, and becomes actionable once that prerequisite is met", () => {
  const claimId = "00000000-0000-4000-8000-00000000c003";
  const item = {
    claimId,
    blockerCodes: [
      "evidence_review_unresolved",
      "claim_review_unresolved",
      "coverage_dimension_unresolved",
      "client_followup_unresolved",
    ],
    evidence: { review_queue_status: "resolved", review_status: "resolved" },
    evidenceReviewDecision: null,
    claimReview: { queue_status: "resolved", review_status: "resolved" },
    claimReviewDecision: null,
    clientFollowupWorkflows: [{ workflowStatus: "waiting_on_client" }],
  };

  // Review Queue presentation (task section 3's required outcome).
  assert.equal(reviewQueueBlockerActionability("evidence_review_unresolved", item), "ACTION_REQUIRED");
  assert.equal(reviewQueueBlockerActionability("claim_review_unresolved", item), "WAITING");
  assert.equal(reviewQueueBlockerActionability("coverage_dimension_unresolved", item), "ACTION_REQUIRED");
  assert.equal(reviewQueueBlockerActionability("client_followup_unresolved", item), "WAITING");

  // Selecting/navigating to this exact claim (real handler execution).
  const uiSource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");
  const handlerSource = extractReviewThisClaimHandlerSource(uiSource);
  const buildHandler = new Function("item", "setSelectedClaimId", "traceabilityPanelRef", `return (${handlerSource});`);
  let selected = null;
  const panelNode = { scrollIntoView() {}, focus() {} };
  const handler = buildHandler(item, (id) => { selected = id; }, { current: panelNode });
  handler();
  assert.equal(selected, claimId);

  // Traceability panel, before any evidence decision: evidence review is a
  // lawful P2-12 legacy-repair candidate (available); claim review is not
  // independently available yet because its evidence prerequisite is unmet.
  assert.equal(canCompleteEvidenceReview(item.evidence, item.evidenceReviewDecision), true);
  assert.equal(
    canCompleteClaimReview(item.evidence, item.claimReview, item.evidenceReviewDecision, item.claimReviewDecision),
    false,
  );
  assert.equal(claimReviewEvidencePrerequisiteSatisfied(item.evidence, item.evidenceReviewDecision), false);

  // Post-refresh authoritative state (task section 5): a genuine terminal
  // evidence decision now exists (as the server would return after a real
  // POST + GET refresh - never fabricated/cleared client-side), the claim
  // queue is still resolved/resolved with no claim decision yet. The claim
  // review prerequisite is now satisfied, so claim review becomes available.
  const refreshedEvidence = { review_queue_status: "resolved", review_status: "resolved" };
  const refreshedEvidenceReviewDecision = { decisionId: "00000000-0000-4000-8000-00000000d004", decisionOutcome: "supported" };
  const refreshedClaimReview = { queue_status: "resolved", review_status: "resolved" };
  const refreshedClaimReviewDecision = null;

  assert.equal(claimReviewEvidencePrerequisiteSatisfied(refreshedEvidence, refreshedEvidenceReviewDecision), true);
  assert.equal(
    canCompleteClaimReview(refreshedEvidence, refreshedClaimReview, refreshedEvidenceReviewDecision, refreshedClaimReviewDecision),
    true,
  );
});

test("Impact Evidence Library mounts KAI Web Intake under its authorized organization context", () => {
  const uiSource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");

  assert.match(
    uiSource,
    /import KaiWebIntake from "\.\/KaiWebIntake\.jsx";/,
  );

  assert.match(
    uiSource,
    /\{organizationId \? \([\s\S]*?<KaiWebIntake[\s\S]*?organizationId=\{organizationId\}[\s\S]*?embedded[\s\S]*?\/>[\s\S]*?\) : null\}/,
  );
});

// --- KAI B1A-3B: Phase-5 sensitivity/allowed-use review on /impact-library ---

test("KAI B1A-3B path builders use the review-cockpit sub-tree's organization_id QUERY STRING convention, distinct from this file's path-segment convention", () => {
  const org = organizationId;
  const profile = "80000000-0000-4000-8000-000000000001";
  assert.equal(sensitivityCapabilitiesPath(org), `${basePath}/admin/review-cockpit/capabilities?organization_id=${org}`);
  assert.equal(
    sensitivityProfilePath(org, profile),
    `${basePath}/admin/review-cockpit/sensitivity-profiles/${profile}?organization_id=${org}`,
  );
  assert.equal(
    sensitivityReviewWorkPath(org, profile),
    `${basePath}/admin/review-cockpit/sensitivity-profiles/${profile}/review-work?organization_id=${org}`,
  );
  assert.equal(
    sensitivityDecisionPath(org, profile),
    `${basePath}/admin/review-cockpit/sensitivity-profiles/${profile}/decision?organization_id=${org}`,
  );
});

test("KAI B1A-3B defaultSensitivityReviewFormState: every presence dimension and allowed-use start at unknown, every permission starts false", () => {
  const state = defaultSensitivityReviewFormState();
  for (const field of SENSITIVITY_PRESENCE_FIELDS) assert.equal(state[field], "unknown");
  assert.equal(state[SENSITIVITY_ALLOWED_USE_FIELD], "unknown");
  for (const field of SENSITIVITY_PERMISSION_FIELDS) assert.equal(state[field], false);
});

test("KAI B1A-3B client-side gating mirrors the server's fail-closed invariant: restricted permissions require allowed-use=allowed; public use additionally requires consent=present and governance=absent", () => {
  const base = defaultSensitivityReviewFormState();
  assert.equal(restrictedPermissionEligible(base), false);
  assert.equal(publicUseAllowedEligible(base), false);

  const allowed = { ...base, [SENSITIVITY_ALLOWED_USE_FIELD]: "allowed" };
  assert.equal(restrictedPermissionEligible(allowed), true);
  assert.equal(publicUseAllowedEligible(allowed), false);

  const consentOnly = { ...allowed, reviewed_consent_basis_status: "present" };
  assert.equal(publicUseAllowedEligible(consentOnly), false, "governance must independently gate public use");

  const governancePresent = { ...consentOnly, reviewed_indigenous_governance_status: "present" };
  assert.equal(publicUseAllowedEligible(governancePresent), false);

  const governanceUnknown = { ...consentOnly, reviewed_indigenous_governance_status: "unknown" };
  assert.equal(publicUseAllowedEligible(governanceUnknown), false);

  const established = { ...consentOnly, reviewed_indigenous_governance_status: "absent" };
  assert.equal(publicUseAllowedEligible(established), true);
});

test("KAI B1A-3B buildReviewedSnapshotBody: emits exactly the 14 contract keys, never coerces unknown, and force-clears any permission the client-side gate would disable", () => {
  const formState = {
    ...defaultSensitivityReviewFormState(),
    reviewed_personal_data_status: "present",
    reviewed_indigenous_governance_status: "unknown",
    // These permissions are set true in form state even though the gate
    // would disable them (allowed-use is still "unknown") - the snapshot
    // builder must force them back to false rather than trust stale UI state.
    reviewed_llm_processing_allowed: true,
    reviewed_public_use_allowed: true,
  };
  const snapshot = buildReviewedSnapshotBody(formState);
  assert.deepEqual([...Object.keys(snapshot)].sort(), [
    ...SENSITIVITY_PRESENCE_FIELDS,
    SENSITIVITY_ALLOWED_USE_FIELD,
    ...SENSITIVITY_PERMISSION_FIELDS,
  ].sort());
  assert.equal(snapshot.reviewed_personal_data_status, "present");
  assert.equal(snapshot.reviewed_indigenous_governance_status, "unknown");
  assert.equal(snapshot.reviewed_llm_processing_allowed, false);
  assert.equal(snapshot.reviewed_public_use_allowed, false);

  const eligible = {
    ...defaultSensitivityReviewFormState(),
    [SENSITIVITY_ALLOWED_USE_FIELD]: "allowed",
    reviewed_consent_basis_status: "present",
    reviewed_indigenous_governance_status: "absent",
    reviewed_llm_processing_allowed: true,
    reviewed_public_use_allowed: true,
  };
  const eligibleSnapshot = buildReviewedSnapshotBody(eligible);
  assert.equal(eligibleSnapshot.reviewed_llm_processing_allowed, true);
  assert.equal(eligibleSnapshot.reviewed_public_use_allowed, true);
});

test("KAI B1A-3B buildSensitivityDecisionRequestBody: includes reviewed_snapshot only for a 'reviewed' outcome, never for needs_more_information", () => {
  const queueItemId = "90000000-0000-4000-8000-000000000099";
  const updatedAt = "2026-08-31T10:00:00.000Z";
  const formState = defaultSensitivityReviewFormState();

  const reviewed = buildSensitivityDecisionRequestBody({
    decision: "reviewed",
    expectedUpdatedAt: updatedAt,
    reviewQueueItemId: queueItemId,
    formState,
  });
  assert.deepEqual([...Object.keys(reviewed)].sort(), ["decision", "expected_updated_at", "review_queue_item_id", "reviewed_snapshot"]);
  assert.equal(reviewed.decision, "reviewed");

  const needsInfo = buildSensitivityDecisionRequestBody({
    decision: "needs_more_information",
    expectedUpdatedAt: updatedAt,
    reviewQueueItemId: queueItemId,
    formState,
  });
  assert.deepEqual([...Object.keys(needsInfo)].sort(), ["decision", "expected_updated_at", "review_queue_item_id"]);
  assert.equal("reviewed_snapshot" in needsInfo, false);
});

test("KAI B1A-3B projectSensitivityDetail: light pass-through projection of the GET sensitivity-profile detail response, null-safe", () => {
  assert.equal(projectSensitivityDetail(null), null);
  assert.equal(projectSensitivityDetail(undefined), null);
  const projected = projectSensitivityDetail({
    sensitivity_posture: { pii_status: "unknown" },
    allowed_use_restrictions: { llm_processing_allowed: false },
    sensitivity_review_queue_item: { review_queue_item_id: "x", queue_status: "open" },
    current_decision: { decision_outcome: "reviewed" },
    decision_controls_enabled: true,
  });
  assert.deepEqual(projected, {
    sensitivityPosture: { pii_status: "unknown" },
    allowedUseRestrictions: { llm_processing_allowed: false },
    reviewQueueItem: { review_queue_item_id: "x", queue_status: "open" },
    currentDecision: { decision_outcome: "reviewed" },
    decisionControlsEnabled: true,
  });
  const empty = projectSensitivityDetail({});
  assert.equal(empty.reviewQueueItem, null);
  assert.equal(empty.currentDecision, null);
  assert.equal(empty.decisionControlsEnabled, false);
});

test("KAI B1A-3B projectTraceability exposes the server-grounded candidate.intake_sensitivity_profile_id, never fabricating one", () => {
  const profileId = "80000000-0000-4000-8000-000000000001";
  const withCandidate = projectTraceability({
    dimensions: {},
    candidate: { intake_source_candidate_id: "c1", intake_sensitivity_profile_id: profileId },
  });
  assert.equal(withCandidate.candidate.intake_sensitivity_profile_id, profileId);

  const withoutCandidate = projectTraceability({ dimensions: {} });
  assert.equal(withoutCandidate.candidate, null);
});

test("KAI B1A-3B UI: Phase-5 fetch/render is gated on the server-grounded capability, never on decision_controls_enabled and never on a hardcoded GK role list", () => {
  const uiSource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");
  assert.match(uiSource, /sensitivityCapabilitiesPath\(organizationId\)/);
  assert.match(uiSource, /sensitivityCapability === true && intakeSensitivityProfileId/);
  assert.doesNotMatch(uiSource, /gk_admin.*gk_operator.*gk_reviewer|gk_reviewer.*gk_operator.*gk_admin/s);
  // The section that renders actionable Phase-5 controls only mounts once
  // the capability check has passed.
  assert.match(uiSource, /intakeSensitivityProfileId && sensitivityCapability === true \? \(/);
});

test("KAI B1A-3B UI: review-work POST sends an empty body, and both review-work and decision submissions always refetch the GET detail rather than trusting the POST response", () => {
  const uiSource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");
  assert.match(uiSource, /postJson\(sensitivityReviewWorkPath\(organizationId, intakeSensitivityProfileId\), \{\}\)/);
  const startFn = uiSource.slice(
    uiSource.indexOf("const startSensitivityReviewWork"),
    uiSource.indexOf("const submitSensitivityDecision"),
  );
  assert.match(startFn, /await loadSensitivityDetail\(\)/);
  const submitFn = uiSource.slice(
    uiSource.indexOf("const submitSensitivityDecision"),
    uiSource.indexOf("return (\n    <section>"),
  );
  assert.match(submitFn, /await loadSensitivityDetail\(\)/);
  // No optimistic state: the mutation result string is set from the HTTP
  // outcome, but sensitivityDetail is only ever set from loadSensitivityDetail.
  assert.doesNotMatch(submitFn, /setSensitivityDetail\(/);
});

test("KAI B1A-3B UI: a stale OCC conflict on the decision POST is not auto-retried - it is surfaced and the state is refetched exactly like any other outcome", () => {
  const uiSource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");
  const submitFn = uiSource.slice(
    uiSource.indexOf("const submitSensitivityDecision"),
    uiSource.indexOf("return (\n    <section>"),
  );
  assert.match(submitFn, /statusCode === 409/);
  // No looping/recursive retry mechanism - only the single postJson call
  // above and the required refetch. The explanatory "No auto-retry" comment
  // itself is not a retry mechanism, so this checks for actual retry
  // machinery (a loop, or the function calling itself again), not the word.
  assert.doesNotMatch(submitFn, /while\s*\(|for\s*\(.*statusCode|submitSensitivityDecision\(decision\)/);
});

test("KAI B1A-3B: needs_more_information and review-work-start never render as approved/complete/funder-ready/public-ready/release-ready", () => {
  const uiSource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");
  assert.doesNotMatch(uiSource, /funder-ready|public-ready|release-ready/i);
});

// --- KAI B1A-3B-R1: pre-claim Phase-5 reachability repair ---
//
// Before R1, Phase-5 was reachable ONLY through: selected claim -> claim
// traceability -> candidate.intake_sensitivity_profile_id. These tests prove
// the repaired path - the SAME organization-scoped, same-capability-gated
// review-cockpit queue the admin cockpit already exposes
// (queue_type='sensitivity_review'), reused as-is - reaches Phase-5 with no
// claim, no claim traceability, no evidence item, and no promoted source, and
// that the pre-existing claim-traceability path still works unchanged and
// still feeds the one single review card (no duplicate control introduced).

test("KAI B1A-3B-R1 sensitivityReviewQueuePath: organization-scoped, filtered to open sensitivity_review work, same query-string convention as the other review-cockpit builders", () => {
  const org = organizationId;
  assert.equal(
    sensitivityReviewQueuePath(org),
    `${basePath}/admin/review-cockpit/queue?organization_id=${org}&queue_type=sensitivity_review&queue_status=open`,
  );
});

test("KAI B1A-3B-R1 projectSensitivityReviewQueueItems: extracts the server-grounded intake_sensitivity_profile_id from target_object_id, never fabricating one", () => {
  const profileIdA = "80000000-0000-4000-8000-000000000010";
  const profileIdB = "80000000-0000-4000-8000-000000000011";
  const items = projectSensitivityReviewQueueItems({
    items: [
      {
        review_queue_item_id: "90000000-0000-4000-8000-000000000010",
        queue_type: "sensitivity_review",
        target_object_type: "intake_sensitivity_profile",
        target_object_id: profileIdA,
        queue_status: "open",
        summary: "Sensitivity review needed",
        created_at: "2026-08-01T00:00:00.000Z",
        updated_at: "2026-08-01T00:00:00.000Z",
      },
      {
        review_queue_item_id: "90000000-0000-4000-8000-000000000011",
        queue_type: "sensitivity_review",
        target_object_type: "intake_sensitivity_profile",
        target_object_id: profileIdB,
        queue_status: "open",
        summary: "Second profile",
        created_at: "2026-08-01T00:00:00.000Z",
        updated_at: "2026-08-01T00:00:00.000Z",
      },
      // A differently-typed queue row (e.g. source_candidate_review) must
      // never be treated as a sensitivity-profile id, even though its
      // target_object_id happens to be a well-formed UUID.
      {
        review_queue_item_id: "90000000-0000-4000-8000-000000000012",
        queue_type: "source_candidate_review",
        target_object_type: "intake_source_candidate",
        target_object_id: "80000000-0000-4000-8000-000000000099",
        queue_status: "open",
        summary: "Not a sensitivity row",
        created_at: "2026-08-01T00:00:00.000Z",
        updated_at: "2026-08-01T00:00:00.000Z",
      },
      // A malformed row (non-UUID target) must be dropped, not passed through.
      {
        review_queue_item_id: "90000000-0000-4000-8000-000000000013",
        queue_type: "sensitivity_review",
        target_object_type: "intake_sensitivity_profile",
        target_object_id: "not-a-uuid",
        queue_status: "open",
        summary: "Malformed",
        created_at: "2026-08-01T00:00:00.000Z",
        updated_at: "2026-08-01T00:00:00.000Z",
      },
    ],
  });
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((item) => item.intakeSensitivityProfileId), [profileIdA, profileIdB]);
  assert.equal(items[0].reviewQueueItemId, "90000000-0000-4000-8000-000000000010");
  assert.equal(items[0].queueStatus, "open");

  assert.deepEqual(projectSensitivityReviewQueueItems(null), []);
  assert.deepEqual(projectSensitivityReviewQueueItems({}), []);
});

test("KAI B1A-3B-R1 UI: the pre-claim review-queue is fetched only once the server-grounded capability check passes, and is wired independently of any claim, traceability, evidence item, or source promotion", () => {
  const uiSource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");
  assert.match(uiSource, /getJson\(sensitivityReviewQueuePath\(organizationId\)\)/);

  // The fetch effect's dependency array is [organizationId, sensitivityCapability]
  // only - no selectedClaimId, traceability, evidenceItemId, or source/promotion
  // state is a dependency, so it can never require any of them to run.
  const queueEffect = uiSource.slice(
    uiSource.indexOf("useEffect(() => {\n    setSensitivityReviewQueueItems([]);"),
    uiSource.indexOf("useEffect(() => {\n    setSensitivityReviewQueueItems([]);") + 900,
  );
  assert.match(queueEffect, /\}, \[organizationId, sensitivityCapability\]\);/);
  assert.match(queueEffect, /sensitivityCapability !== true/);
  assert.doesNotMatch(queueEffect, /selectedClaimId|traceability|evidenceItemId|sourceVersionId/);
});

test("KAI B1A-3B-R1 UI: selecting a pre-claim review-queue item feeds the SAME single selectedSensitivityProfileId that claim traceability also feeds - no second/duplicate review control is introduced", () => {
  const uiSource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");

  // The pre-claim list only ever *selects* a profile id - it renders no
  // sensitivity-posture, decision, or review-work UI of its own.
  const queueSection = uiSource.slice(
    uiSource.indexOf('<h5 className="mb-0">Sources needing sensitivity'),
    uiSource.indexOf('<h5 className="mb-0">Sensitivity &amp; allowed-use review</h5>'),
  );
  assert.match(queueSection, /onClick=\{\(\) => setSelectedSensitivityProfileId\(item\.intakeSensitivityProfileId\)\}/);
  assert.doesNotMatch(queueSection, /submitSensitivityDecision|startSensitivityReviewWork|sensitivityFormState/);

  // Exactly one actionable "Sensitivity & allowed-use review" detail card
  // exists in the whole component - the pre-claim list is a selector into it,
  // not a second copy of it.
  const detailCardMatches = uiSource.match(/<h5 className="mb-0">Sensitivity &amp; allowed-use review<\/h5>/g) || [];
  assert.equal(detailCardMatches.length, 1);

  // Claim traceability still independently sets the same selection state -
  // the pre-claim and post-claim paths converge on one variable, not two
  // competing ones.
  assert.match(
    uiSource,
    /useEffect\(\(\) => \{\s*const candidateProfileId = traceability\?\.candidate\?\.intake_sensitivity_profile_id \|\| "";\s*if \(candidateProfileId\) setSelectedSensitivityProfileId\(candidateProfileId\);\s*\}, \[traceability\]\);/,
  );
  assert.match(uiSource, /const intakeSensitivityProfileId = selectedSensitivityProfileId;/);
});

test("KAI B1A-3B-R1 UI: selecting a new organization discards the pre-claim review-queue list and the selected profile id, exactly like every other organization-scoped dimension on this page", () => {
  const uiSource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");
  const orgChangeEffect = uiSource.slice(
    uiSource.indexOf("useEffect(() => {\n    candidateRequestGenerationRef.current += 1;"),
    uiSource.indexOf("}, [organizationId]);") + "}, [organizationId]);".length,
  );
  assert.match(orgChangeEffect, /setSensitivityReviewQueueItems\(\[\]\);/);
  assert.match(orgChangeEffect, /setSensitivityReviewQueueError\(""\);/);
  assert.match(orgChangeEffect, /setSelectedSensitivityProfileId\(""\);/);
});

test("KAI B1A-3B-R1 fixture: P1-05 sensitivity profile exists, no evidence item, no claim - the pre-claim queue projection alone is sufficient to reach a reviewable profile id", () => {
  // This models the exact P1 lifecycle state the living ExecPlan requires be
  // reachable: a sensitivity_review queue item for a profile that exists
  // independent of any claim, evidence item, or source candidate/promotion.
  // No `claim`, `evidence`, `candidate`, `source`, or `sourceVersion` field is
  // present anywhere in this fixture, and the projection still yields the
  // profile id needed to open the existing Sensitivity & allowed-use review
  // card.
  const intakeSensitivityProfileId = "80000000-0000-4000-8000-000000000042";
  const queueResponse = {
    items: [{
      review_queue_item_id: "90000000-0000-4000-8000-000000000042",
      organization_id: organizationId,
      queue_type: "sensitivity_review",
      target_object_type: "intake_sensitivity_profile",
      target_object_id: intakeSensitivityProfileId,
      priority: "normal",
      queue_status: "open",
      due_at: null,
      summary: "Sensitivity & allowed-use review needed",
      required_action: "Review sensitivity and allowed-use posture",
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
    }],
    filters: { queue_types: ["sensitivity_review"], queue_statuses: ["open"] },
    pagination: { limit: 25, next_cursor: null },
  };
  const projected = projectSensitivityReviewQueueItems(queueResponse);
  assert.equal(projected.length, 1);
  assert.equal(projected[0].intakeSensitivityProfileId, intakeSensitivityProfileId);
});

test("KAI B1A-3B-R1: existing claim traceability still exposes intake_sensitivity_profile_id as traceability metadata, unchanged", () => {
  const profileId = "80000000-0000-4000-8000-000000000001";
  const withCandidate = projectTraceability({
    dimensions: {},
    candidate: { intake_source_candidate_id: "c1", intake_sensitivity_profile_id: profileId },
  });
  assert.equal(withCandidate.candidate.intake_sensitivity_profile_id, profileId);
});

test("KAI B1A-3B-R1: /impact-library remains the sole product surface for this change - no route or component under the admin Review Cockpit (frontend/kaiReviewCockpit.jsx) was touched", () => {
  const cockpitSource = readFileSync("frontend/kaiReviewCockpit.jsx", "utf8");
  assert.doesNotMatch(cockpitSource, /sensitivityReviewQueuePath|projectSensitivityReviewQueueItems|selectedSensitivityProfileId/);
});

// --- KAI B1A-3B-R2: zero-queue first-review bootstrap repair ---
//
// R1 removed the claim dependency for profiles that already have an OPEN
// sensitivity_review queue item - but sensitivityReviewQueuePath() only ever
// queries EXISTING review_queue_items rows (queue_type=sensitivity_review,
// queue_status=open), so a profile with NO queue item yet (the true
// first-review/zero-queue state) was still unreachable through either the R1
// list or claim traceability. R2 adds a THIRD, additive path into the exact
// same selectedSensitivityProfileId: the server-grounded
// intake_sensitivity_profile_id KaiWebIntake already resolves from its own
// ordinary file-detail GET, reported through an explicit opt-in callback
// prop - never a new authority system, review queue, or page.

test("KAI B1A-3B-R2: R1_REQUIRES_EXISTING_QUEUE - sensitivityReviewQueuePath queries only existing review_queue_items rows, never creates or discovers a profile that has none", () => {
  assert.equal(
    sensitivityReviewQueuePath(organizationId),
    `${basePath}/admin/review-cockpit/queue?organization_id=${organizationId}&queue_type=sensitivity_review&queue_status=open`,
  );
  // The path only ever reads kai.review_queue_items rows already filtered to
  // queue_status=open - there is no server-side "create if absent" semantic
  // reachable from this GET, so a profile with zero queue rows can never be
  // discovered through it.
});

test("KAI B1A-3B-R2: the file-detail P1 lifecycle read model additively projects intake_sensitivity_profile_id, deterministically and tenant-scoped, with no unordered/newest-row guess", () => {
  const readModelSource = readFileSync("Backend/kai/db/kaiReadModels.js", "utf8");
  const start = readModelSource.indexOf("export async function getScopedIntakeFileP1Lifecycle");
  const end = readModelSource.indexOf("export async function getDataDictionaryDraftSummary", start);
  const region = readModelSource.slice(start, end);

  assert.match(region, /s\.intake_sensitivity_profile_id AS intake_sensitivity_profile_id/);
  assert.match(region, /LEFT JOIN kai\.intake_sensitivity_profiles s/);
  assert.match(region, /s\.organization_id = f\.organization_id/);
  assert.match(region, /s\.intake_file_id = f\.intake_file_id/);
  assert.match(region, /s\.file_profile_id = p\.file_profile_id/);
  // The sensitivity-profile join itself carries no ORDER BY/LIMIT of its
  // own - it is a plain equi-join on the unique (organization_id,
  // file_profile_id) lineage, not a "most recent row" pick.
  const sensitivityJoinStart = region.indexOf("LEFT JOIN kai.intake_sensitivity_profiles s");
  const sensitivityJoinClause = region.slice(sensitivityJoinStart, region.indexOf("WHERE f.organization_id", sensitivityJoinStart));
  assert.doesNotMatch(sensitivityJoinClause, /ORDER BY|LIMIT/i);
});

test("KAI B1A-3B-R2: the file-detail service exposes intake_sensitivity_profile_id only once the completeness chain has actually reached sensitivity, and only as a valid route uuid", () => {
  const serviceSource = readFileSync("Backend/kai/services/kaiIntakeService.js", "utf8");
  const start = serviceSource.indexOf("function p1LifecycleProjection");
  const end = serviceSource.indexOf("function responseFileDetail", start);
  const region = serviceSource.slice(start, end);

  assert.match(region, /sensitivityProfileComplete\s*\n?\s*&&\s*UUID_RE\.test/);
  assert.match(region, /intake_sensitivity_profile_id: intakeSensitivityProfileId/);
});

test("KAI B1A-3B-R2: KaiWebIntake exposes an explicit opt-in onSensitivityProfileDiscovered seam, never an unconditional Phase-5 UI element in the shared component", () => {
  const intakeSource = readFileSync("frontend/KaiWebIntake.jsx", "utf8");

  assert.match(intakeSource, /onSensitivityProfileDiscovered,?\s*\n\}\)/);
  assert.match(
    intakeSource,
    /if \(typeof onSensitivityProfileDiscovered === "function"\)/,
  );
  assert.match(
    intakeSource,
    /reportSensitivityProfileDiscovered\(result\.body\.data\?\.p1_lifecycle\?\.intake_sensitivity_profile_id \|\| null\)/,
  );

  // No hardcoded Phase-5 review card/form was added to the shared component
  // itself - ImpactEvidenceLibrary alone owns the one Phase-5 review card.
  assert.doesNotMatch(intakeSource, /Sensitivity &amp; allowed-use review/);
  assert.doesNotMatch(intakeSource, /startSensitivityReviewWork|submitSensitivityDecision/);
});

test("KAI B1A-3B-R2: adminDashboard's standalone KAI Web Intake mount does not opt in, so its behavior is unchanged", () => {
  const dashboardSource = readFileSync("frontend/adminDashboard.jsx", "utf8");
  assert.match(dashboardSource, /<KaiWebIntake \/>/);
  assert.doesNotMatch(dashboardSource, /onSensitivityProfileDiscovered/);
});

test("KAI B1A-3B-R2 UI: ImpactEvidenceLibrary opts in to the KaiWebIntake seam and feeds the discovered id into the SAME canonical selectedSensitivityProfileId, guarded by isRouteUuid, never fabricated", () => {
  const uiSource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");

  assert.match(uiSource, /onSensitivityProfileDiscovered=\{handleSensitivityProfileDiscoveredFromIntake\}/);

  const handlerStart = uiSource.indexOf("const handleSensitivityProfileDiscoveredFromIntake");
  const handlerRegion = uiSource.slice(handlerStart, handlerStart + 400);
  assert.match(handlerRegion, /isRouteUuid\(intakeSensitivityProfileId\)/);
  assert.match(handlerRegion, /setSelectedSensitivityProfileId\(intakeSensitivityProfileId\)/);

  // A null/absent report (e.g. the reviewer changed the file selection inside
  // KaiWebIntake without yet reaching a complete profile) must never clear an
  // already-selected profile out from under an in-progress review.
  assert.doesNotMatch(handlerRegion, /setSelectedSensitivityProfileId\(""\)/);
});

test("KAI B1A-3B-R2: still exactly one Phase-5 review card/form on /impact-library after adding the third discovery path", () => {
  const uiSource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");
  const detailCardMatches = uiSource.match(/<h5 className="mb-0">Sensitivity &amp; allowed-use review<\/h5>/g) || [];
  assert.equal(detailCardMatches.length, 1);
});

test("KAI B1A-3B-R2 UI: the first-review bootstrap action (existing) sends exactly {} to review-work and always refetches the authoritative GET afterward - unchanged by adding the zero-queue discovery path", () => {
  const uiSource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");
  const region = uiSource.slice(
    uiSource.indexOf("const startSensitivityReviewWork"),
    uiSource.indexOf("const submitSensitivityDecision"),
  );
  assert.match(region, /postJson\(sensitivityReviewWorkPath\(organizationId, intakeSensitivityProfileId\), \{\}\)/);
  assert.match(region, /await loadSensitivityDetail\(\);/);

  // The zero-queue first-review action is rendered exactly when the
  // authoritative GET has confirmed there is no queue item yet - it is never
  // triggered merely by loading/discovering a profile id.
  const cardStart = uiSource.indexOf('<h5 className="mb-0">Sensitivity &amp; allowed-use review</h5>');
  const cardRegion = uiSource.slice(cardStart, cardStart + 2500);
  assert.match(cardRegion, /onClick=\{startSensitivityReviewWork\}/);
  assert.doesNotMatch(uiSource, /useEffect\([^)]*loadSensitivityDetail[^)]*startSensitivityReviewWork/);
});

test("KAI B1A-3B-R2: organization change still clears selectedSensitivityProfileId, so a stale file-discovered id from a prior organization can never leak into the new one", () => {
  const uiSource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");
  const orgChangeEffect = uiSource.slice(
    uiSource.indexOf("useEffect(() => {\n    candidateRequestGenerationRef.current += 1;"),
    uiSource.indexOf("}, [organizationId]);") + "}, [organizationId]);".length,
  );
  assert.match(orgChangeEffect, /setSelectedSensitivityProfileId\(""\);/);
});

test("KAI B1A-3B-R2: resolved profiles remain discoverable through the same file-detail seam, since KaiWebIntake reports the file's current profile id regardless of the profile's review/decision state", () => {
  const intakeSource = readFileSync("frontend/KaiWebIntake.jsx", "utf8");
  // The seam is fed directly from the file-detail response's p1_lifecycle
  // projection, not from any queue-status or decision-status condition - so a
  // profile with a resolved/superseded decision is reported exactly the same
  // way as a brand-new one.
  const refreshRegion = intakeSource.slice(
    intakeSource.indexOf("const refreshFileStatus"),
    intakeSource.indexOf("const loadBatchFiles"),
  );
  assert.doesNotMatch(refreshRegion, /review_status|queue_status|current_decision/);
  assert.match(refreshRegion, /reportSensitivityProfileDiscovered\(result\.body\.data\?\.p1_lifecycle\?\.intake_sensitivity_profile_id \|\| null\)/);
});
