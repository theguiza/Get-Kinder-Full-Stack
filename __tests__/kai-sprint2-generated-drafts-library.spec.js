import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { readFileSync } from "node:fs";

import sprint2IntakeApiRouter, { __testables as intakeRouteTestables } from "../Backend/kai/routes/sprint2IntakeApi.js";
import { requireKaiSprint2Enabled } from "../Backend/kai/config/kaiSprint2Config.js";
import {
  createAttachKaiSprint2ActorContext,
  requireKaiSprint2Authenticated,
} from "../Backend/kai/middleware/kaiSprint2Authentication.js";
import {
  handleKaiSprint2JsonParserError,
  kaiSprint2ActorMutationLimiter,
  kaiSprint2MetadataJsonParser,
  kaiSprint2OrganizationMutationLimiter,
  setKaiSprint2NoStore,
} from "../Backend/kai/middleware/kaiSprint2RequestSafety.js";
import {
  listGeneratedDraftLibraryIndex,
  __generatedDraftLibraryServiceContract,
  __testables as generatedDraftLibraryServiceTestables,
} from "../Backend/kai/services/kaiGeneratedDraftLibraryService.js";
import { listGeneratedDraftLibraryIndex as readGeneratedDraftLibraryIndex } from "../Backend/kai/db/kaiGeneratedDraftLibraryReadModels.js";
import {
  CLAIM_REVIEW_DECISIONS,
  generatedDraftLibraryIndexPath,
  generatedDraftReviewLabel,
  generatedDraftReviewPacketPath,
  projectGeneratedDraftLibraryItems,
  projectGeneratedDraftPacket,
  projectTraceability,
} from "../frontend/impactEvidenceLibraryLogic.js";

const basePath = "/api/kai/sprint2/intake";
const organizationId = "00000000-0000-4000-8000-000000000001";
const otherOrganizationId = "00000000-0000-4000-8000-000000000002";
const draftId = "00000000-0000-4000-8000-000000000777";
const reviewQueueItemId = "00000000-0000-4000-8000-000000000778";
const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" });
const actorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  organizationMemberships: [
    { organization_id: organizationId, membership_status: "active", role_name: "gk_reviewer" },
  ],
});

function draftRow(overrides = {}) {
  return {
    generated_content_draft_id: draftId,
    organization_id: organizationId,
    content_type: "evidence_summary",
    requested_audience: "internal",
    draft_status: "draft",
    review_queue_item_id: reviewQueueItemId,
    queue_status: "open",
    review_status: "needs_gk_review",
    created_at: "2026-08-15T10:00:00.000Z",
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
      data: { items: [], limit: 25, afterGeneratedContentDraftId: null, truncated: false, nextAfterGeneratedContentDraftId: null },
      error: null,
    },
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
    if (current.authenticated) {
      req.user = { id: 46 };
    }
    return next();
  });
  // Real attachment middleware, stubbed only at the resolver seam so the
  // route is exercised exactly as production mounts it (no manual
  // req.kaiSprint2ActorContext injection that would mask the middleware
  // being missing from the chain).
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

test("Generated Drafts index route is mounted once as authenticated read-only GET", () => {
  const matches = sprint2IntakeApiRouter.stack
    .filter((layer) => layer.route?.path === "/admin/organizations/:organizationId/generated-content-drafts" && layer.route?.methods?.get);
  assert.equal(matches.length, 1);
  assert.deepEqual(Object.keys(matches[0].route.methods), ["get"]);
});

test("Generated Drafts index route delegates to the generated-draft library service and rejects unknown query fields", async (t) => {
  let current = scenario({
    result: {
      ok: true,
      data: {
        items: [{
          generatedContentDraftId: draftId,
          contentType: "evidence_summary",
          requestedAudience: "internal",
          draftStatus: "draft",
          reviewQueueItemId,
          queueStatus: "open",
          reviewStatus: "needs_gk_review",
          createdAt: "2026-08-15T10:00:00.000Z",
        }],
        limit: 25,
        afterGeneratedContentDraftId: null,
        truncated: false,
        nextAfterGeneratedContentDraftId: null,
      },
      error: null,
    },
  });
  const restore = intakeRouteTestables.setIntakeServiceForTest({
    async listGeneratedDraftLibraryIndex(input) {
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

  const path = `${basePath}/admin/organizations/${organizationId}/generated-content-drafts?limit=25`;
  const rejected = await requestJson(server, `${path}&raw_content=1`);
  assert.equal(rejected.statusCode, 422);
  assert.deepEqual(current.calls, []);

  const first = await requestJson(server, path);
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.data.items[0].generatedContentDraftId, draftId);
  assert.deepEqual(current.calls, [{
    organizationId,
    limit: 25,
    afterGeneratedContentDraftId: null,
    actorContext,
  }]);

  // A second, independent request (simulating a fresh Library reload) rediscovers
  // the same persisted draft without any generation/provider dependency.
  const second = await requestJson(server, path);
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.data.items[0].generatedContentDraftId, draftId);
  assert.equal(current.calls.length, 2);
});

test("Generated Drafts index route populates req.kaiSprint2ActorContext through the real attachment middleware, not manual test injection", async (t) => {
  // Unlike createApp() above, this app never assigns req.kaiSprint2ActorContext
  // directly. It only sets req.user and req.isAuthenticated, then relies on the
  // production middleware chain (requireKaiSprint2Authenticated followed by the
  // router-mounted attachKaiSprint2ActorContext) to populate the actor context
  // from a stubbed resolver, exactly as production does from the real one.
  let observedResolverCalls = 0;
  const restoreActorContextMiddleware = intakeRouteTestables.setActorContextMiddlewareForTest(
    createAttachKaiSprint2ActorContext({
      resolveActorContext: async () => {
        observedResolverCalls += 1;
        return { ok: true, actorContext };
      },
    }),
  );

  const calls = [];
  const restoreService = intakeRouteTestables.setIntakeServiceForTest({
    async listGeneratedDraftLibraryIndex(input) {
      calls.push(input);
      return {
        ok: true,
        data: { items: [], limit: 25, afterGeneratedContentDraftId: null, truncated: false, nextAfterGeneratedContentDraftId: null },
        error: null,
      };
    },
  });

  const originalFeatureFlag = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "true";

  const app = express();
  app.use(basePath, setKaiSprint2NoStore, requireKaiSprint2Enabled, kaiSprint2MetadataJsonParser);
  app.use(basePath, handleKaiSprint2JsonParserError);
  app.use(basePath, (req, res, next) => {
    req.isAuthenticated = () => true;
    req.user = { id: 46 };
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
  const server = await listen(app);

  t.after(async () => {
    restoreActorContextMiddleware();
    restoreService();
    if (originalFeatureFlag === undefined) delete process.env.KAI_SPRINT2_ENABLED;
    else process.env.KAI_SPRINT2_ENABLED = originalFeatureFlag;
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  const path = `${basePath}/admin/organizations/${organizationId}/generated-content-drafts?limit=25`;
  const response = await requestJson(server, path);

  assert.equal(response.statusCode, 200);
  assert.equal(observedResolverCalls, 1);
  assert.equal(calls.length, 1);
  // The service must receive the resolver's full actor context (roles,
  // memberships, etc.), not a hand-built {actorType, actorUserId} stub.
  assert.deepEqual(calls[0].actorContext, actorContext);
});

test("Generated Drafts library service authorizes like the existing generated-draft read packet and fails closed", async () => {
  let calls = 0;
  const deps = {
    env: enabledEnv,
    async listGeneratedDraftLibraryIndex() {
      calls += 1;
      return [draftRow()];
    },
  };

  const allowed = await listGeneratedDraftLibraryIndex(
    { organizationId, limit: 25, afterGeneratedContentDraftId: null, actorContext },
    deps,
  );
  assert.equal(allowed.ok, true);
  assert.equal(calls, 1);
  assert.equal(allowed.data.items.length, 1);
  assert.equal(allowed.data.items[0].contentType, "evidence_summary");
  assert.equal(allowed.data.items[0].requestedAudience, "internal");
  assert.equal(allowed.data.items[0].draftStatus, "draft");
  assert.equal(JSON.stringify(allowed).includes("must not render"), false);

  const globalAdmin = await listGeneratedDraftLibraryIndex(
    {
      organizationId,
      limit: 25,
      afterGeneratedContentDraftId: null,
      actorContext: {
        ...actorContext,
        kaiRoles: ["gk_admin"],
        organizationMemberships: [{ organization_id: organizationId, membership_status: "active", role_name: "client_contributor" }],
      },
    },
    deps,
  );
  assert.equal(globalAdmin.ok, true);

  // Cross-tenant: actor has no active membership in the requested organization.
  const crossTenant = await listGeneratedDraftLibraryIndex(
    { organizationId: otherOrganizationId, limit: 25, afterGeneratedContentDraftId: null, actorContext },
    deps,
  );
  assert.equal(crossTenant.ok, false);
  assert.equal(crossTenant.error.code, "authorization_denied");

  // Disallowed role for this operation.
  const deniedRole = await listGeneratedDraftLibraryIndex(
    {
      organizationId,
      limit: 25,
      afterGeneratedContentDraftId: null,
      actorContext: {
        ...actorContext,
        organizationMemberships: [{ organization_id: organizationId, membership_status: "active", role_name: "gk_operator" }],
      },
    },
    deps,
  );
  assert.equal(deniedRole.ok, false);
  assert.equal(deniedRole.error.code, "authorization_denied");

  // Feature disabled fails closed with no read model call.
  calls = 0;
  const disabled = await listGeneratedDraftLibraryIndex(
    { organizationId, limit: 25, afterGeneratedContentDraftId: null, actorContext },
    { ...deps, env: { KAI_SPRINT2_ENABLED: "false", KAI_GENERATION_ENABLED: "true" } },
  );
  assert.equal(disabled.ok, false);
  assert.equal(disabled.error.code, "feature_disabled");
  assert.equal(calls, 0);
});

test("Generated Drafts library service pins draftStatus=draft even for a resolved review lifecycle", async () => {
  const deps = {
    env: enabledEnv,
    async listGeneratedDraftLibraryIndex() {
      return [draftRow({ queue_status: "resolved", review_status: "resolved" })];
    },
  };
  const result = await listGeneratedDraftLibraryIndex(
    { organizationId, limit: 25, afterGeneratedContentDraftId: null, actorContext },
    deps,
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.items[0].draftStatus, "draft");
  assert.equal(result.data.items[0].queueStatus, "resolved");
  assert.equal(result.data.items[0].reviewStatus, "resolved");
  assert.equal(generatedDraftReviewLabel(result.data.items[0].queueStatus, result.data.items[0].reviewStatus), "Review completed");
});

test("Generated Drafts read model is bounded, organization-scoped, deterministically ordered, and read-only", async () => {
  let observed = null;
  await readGeneratedDraftLibraryIndex(organizationId, { limit: 25, afterGeneratedContentDraftId: draftId }, {
    async query(sql, params) {
      observed = { sql, params };
      return { rows: [] };
    },
  });
  assert.match(observed.sql, /WHERE d\.organization_id = \$1::uuid/);
  assert.match(observed.sql, /AND d\.content_type IN \('evidence_summary', 'impact_narrative'\)/);
  assert.match(observed.sql, /AND d\.requested_audience = 'internal'/);
  assert.match(observed.sql, /AND d\.draft_status = 'draft'/);
  assert.match(observed.sql, /AND q\.priority = 'medium'/);
  assert.match(observed.sql, /AND q\.assigned_to IS NULL/);
  assert.match(observed.sql, /AND q\.due_at IS NULL/);
  assert.match(observed.sql, /AND q\.created_by_type = 'system'/);
  assert.match(observed.sql, /\(q\.queue_status = 'open' AND q\.review_status = 'needs_gk_review'\)/);
  assert.match(observed.sql, /\(q\.queue_status = 'in_progress' AND q\.review_status = 'needs_gk_review'\)/);
  assert.match(observed.sql, /\(q\.queue_status = 'resolved' AND q\.review_status = 'resolved'\)/);
  assert.match(observed.sql, /AND d\.generated_content_draft_id > \$3::uuid/);
  assert.match(observed.sql, /ORDER BY d\.generated_content_draft_id ASC/);
  assert.match(observed.sql, /LIMIT \$2::int/);
  assert.deepEqual(observed.params, [organizationId, 26, draftId]);
  assert.doesNotMatch(observed.sql, /\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bTRUNCATE\b|FOR UPDATE/i);
});

test("Generated Drafts review-label mapping reflects open/in_progress/resolved server states", () => {
  assert.equal(generatedDraftReviewLabel("open", "needs_gk_review"), "Needs review");
  assert.equal(generatedDraftReviewLabel("in_progress", "needs_gk_review"), "In review");
  assert.equal(generatedDraftReviewLabel("resolved", "resolved"), "Review completed");
});

test("Generated Drafts frontend projection strips unsafe fields and preserves safe list fields", () => {
  const items = projectGeneratedDraftLibraryItems({
    items: [{
      generatedContentDraftId: draftId,
      contentType: "evidence_summary",
      requestedAudience: "internal",
      draftStatus: "draft",
      reviewQueueItemId,
      queueStatus: "open",
      reviewStatus: "needs_gk_review",
      createdAt: "2026-08-15T10:00:00.000Z",
      raw_content: "must not render",
      signed_url: "must not render",
    }],
  });
  assert.equal(items.length, 1);
  assert.equal(JSON.stringify(items).includes("must not render"), false);
  assert.equal(
    generatedDraftLibraryIndexPath(organizationId),
    `${basePath}/admin/organizations/${organizationId}/generated-content-drafts?limit=25`,
  );
  assert.notEqual(generatedDraftLibraryIndexPath(organizationId), generatedDraftReviewPacketPath(organizationId, draftId));
});

test("Generated Drafts library source causes no model/provider call and no unsafe field rendering", () => {
  const serviceSource = readFileSync("Backend/kai/services/kaiGeneratedDraftLibraryService.js", "utf8");
  const readModelSource = readFileSync("Backend/kai/db/kaiGeneratedDraftLibraryReadModels.js", "utf8");
  const uiSource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");
  const logicSource = readFileSync("frontend/impactEvidenceLibraryLogic.js", "utf8");

  assert.doesNotMatch(serviceSource, /kaiEvidenceSummaryDraftGenerator|draftGenerator|createEvidenceSummaryDraft/i);
  assert.doesNotMatch(readModelSource, /\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bTRUNCATE\b|FOR UPDATE/i);
  assert.match(uiSource, /Generated Drafts/);
  assert.match(uiSource + logicSource, /generatedDraftLibraryIndexPath|generated-content-drafts\?limit/);

  // A1C-2: the old file-wide `/\bfinal\b|\bapproved\b|export-ready/i` ban
  // regressed once A1/A1C-1 legitimately added human-review wire vocabulary
  // ("approved", "approved_with_limitation") - plus the safety disclaimer
  // that spells out this very invariant in prose ("not final ... release
  // authority") - elsewhere in these two SHARED component files. That
  // vocabulary is legitimate and must not be renamed just to satisfy a test.
  // The test boundary is repaired, not the vocabulary: the ban is narrowed to
  // exactly the Generated-Drafts-only source regions, located by stable,
  // unique code markers (not line numbers) so the slice tracks the file
  // instead of a snapshot of it.
  function sliceBetween(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    assert.ok(start !== -1, `A1C-2 test-boundary marker not found: ${startMarker}`);
    if (endMarker === null) return source.slice(start);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.ok(end !== -1, `A1C-2 test-boundary marker not found: ${endMarker}`);
    return source.slice(start, end);
  }

  const generatedDraftsUiSurface = [
    sliceBetween(uiSource, "const loadGeneratedDrafts = useCallback", "const runExtractEvidence = useCallback"),
    sliceBetween(uiSource, '<h5 className="mb-0">Generated Drafts</h5>', '<div className="admin-card'),
    sliceBetween(uiSource, "{generatedDraftPacket ? (", null),
  ].join("\n");
  const generatedDraftsLogicSurface = [
    sliceBetween(logicSource, "export function generatedDraftLibraryIndexPath", "export function evidenceExtractionPath"),
    sliceBetween(logicSource, "export function generatedContentReviewStartPath", "export function reviewTransitionBody"),
    sliceBetween(logicSource, "export function projectGeneratedDraftPacket", null),
  ].join("\n");
  const generatedDraftsSurface = generatedDraftsUiSurface + generatedDraftsLogicSurface;

  // Does not expose final/export-ready/released state, and does not infer
  // release authority from claim approval: "approved" is legitimate
  // vocabulary elsewhere in these files, but nothing in the Generated-Drafts-
  // only surface needs to reason about claim/evidence approval to decide what
  // a generated draft looks like, so it must never appear here either.
  assert.doesNotMatch(generatedDraftsSurface, /\bfinal\b|export-ready|\breleased?\b|\bapproved\b/i);
  // Does not expose prohibited/raw/private fields (whole-file: legitimate
  // nowhere in this component).
  assert.doesNotMatch(uiSource + logicSource, /raw_content|signed_url|storage_object|api[_-]?key|secret/i);

  assert.deepEqual(
    [...__generatedDraftLibraryServiceContract.GENERATED_DRAFT_LIBRARY_READ_ROLES],
    ["gk_admin", "gk_reviewer"],
  );
  assert.equal(__generatedDraftLibraryServiceContract.GENERATED_DRAFT_LIBRARY_READ_OPERATION, "get_generated_draft_review_packet");
  assert.equal(typeof generatedDraftLibraryServiceTestables.responseDraftSummary, "function");
});

test("A1C-2 regression: a claim review decision of 'approved' is real wire vocabulary, and it confers no final/export/release authority on generated drafts", async () => {
  // Fact 1: "approved" is legitimate, current claim-review wire vocabulary -
  // not something this suite may rename or remove - and the traceability
  // projection surfaces it verbatim.
  assert.ok(CLAIM_REVIEW_DECISIONS.includes("approved"));
  const traceability = projectTraceability({
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
    claim_review_decision: {
      decision_id: "00000000-0000-4000-8000-000000000902",
      decision_outcome: "approved",
      approved_audiences: ["internal", "funder"],
    },
  });
  assert.equal(traceability.claimReviewDecision.decisionOutcome, "approved");

  // Fact 2: that same approved claim decision has zero bearing on what a
  // generated draft is allowed to look like. The generated-draft projection
  // and the read-only service both still pin draftStatus to "draft" and
  // requestedAudience to "internal" regardless, and expose no final/export/
  // released/approved field of their own.
  const packet = projectGeneratedDraftPacket({
    generatedContentDraftId: draftId,
    contentType: "evidence_summary",
    draftStatus: "draft",
    requestedAudience: "internal",
    reviewQueueItemId,
    queueStatus: "resolved",
    reviewStatus: "resolved",
    currentUseEligible: true,
    blocks: [{ ordinal: 1, text: "Enrollment increased.", citations: [] }],
  });
  assert.equal(packet.draftStatus, "draft");
  assert.doesNotMatch(JSON.stringify(packet), /\bfinal\b|export-ready|\breleased?\b|\bapproved\b/i);

  const deps = {
    env: enabledEnv,
    async listGeneratedDraftLibraryIndex() {
      // Simulating the read model returning a draft whose linked claim has
      // already been through an "approved" human review - the read model
      // itself never even carries a decision_outcome/approved field, since
      // it is scoped to kai.generated_content_drafts + its own review queue.
      return [draftRow({ queue_status: "resolved", review_status: "resolved" })];
    },
  };
  const result = await listGeneratedDraftLibraryIndex(
    { organizationId, limit: 25, afterGeneratedContentDraftId: null, actorContext },
    deps,
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.items[0].draftStatus, "draft");
  assert.equal(result.data.items[0].requestedAudience, "internal");
  assert.doesNotMatch(JSON.stringify(result), /\bfinal\b|export-ready|\breleased?\b|\bapproved\b/i);
});
