// P14-09: governed FUNDER evidence-summary content generation for an
// explicit engagement. This suite proves the new, additive
// POST /admin/organizations/:organizationId/generated-content-drafts/evidence-summary/funder
// route (backend-only) reuses the exact existing P3-01
// createEvidenceSummaryDraft service/repository/generator/validator/audit
// vertical unmodified, that requestedAudience is server-owned ("funder")
// and never client-controlled, that a freshly-evaluated funder-ineligible
// claim fails closed BEFORE the generator is ever invoked, that
// post-generation eligibility loss rolls back with no durable state, and
// that the existing internal evidence-summary route/behavior (including
// Package 14-05 governed-but-currently-ineligible internal admission) is
// completely untouched.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { randomUUID } from "node:crypto";

import sprint2IntakeApiRouter, { __testables as intakeRouteTestables } from "../Backend/kai/routes/sprint2IntakeApi.js";
import { requireKaiSprint2Enabled } from "../Backend/kai/config/kaiSprint2Config.js";
import {
  handleKaiSprint2JsonParserError,
  kaiSprint2ActorMutationLimiter,
  kaiSprint2MetadataJsonParser,
  kaiSprint2OrganizationMutationLimiter,
  setKaiSprint2NoStore,
} from "../Backend/kai/middleware/kaiSprint2RequestSafety.js";
import { createEvidenceSummaryDraft } from "../Backend/kai/services/kaiGeneratedContentService.js";
import {
  createPostgresGeneratedContentRepository,
  fingerprintEvidenceSummaryRequest,
} from "../Backend/kai/dictionary/postgresGeneratedContentRepository.js";
import { GENERATED_CONTENT_REVIEW_QUEUE_CONTRACT } from "../Backend/kai/dictionary/generatedContentReviewQueueContract.js";
import {
  __evidenceSummaryDraftGeneratorContract,
  createProductionEvidenceSummaryDraftGenerator,
} from "../Backend/kai/services/kaiEvidenceSummaryDraftGenerator.js";

const basePath = "/api/kai/sprint2/intake";
const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const ENGAGEMENT = "00000000-0000-4000-8000-000000000501";
const CLAIM = "00000000-0000-4000-8000-000000000101";
const EVIDENCE = "00000000-0000-4000-8000-000000000201";
const SOURCE = "00000000-0000-4000-8000-000000000301";
const SOURCE_VERSION = "00000000-0000-4000-8000-000000000401";
const NOW = "2026-08-06T10:00:00.000Z";
const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" });
const actorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  source: "public.userdata",
  organizationMemberships: [
    { organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" },
  ],
});

async function stubGetEngagementForOrganization({ organizationId, engagementId }) {
  if (organizationId === ORG && engagementId === ENGAGEMENT) {
    return { engagement_id: ENGAGEMENT, organization_id: ORG };
  }
  return null;
}

function auditRecorder() {
  return { prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } };
}

// --- HTTP-level route harness (mirrors the existing Impact Evidence Library
// route-boundary harness; backend-only, no frontend import) ---

function createApp(getScenario) {
  const app = express();
  app.use(basePath, setKaiSprint2NoStore, requireKaiSprint2Enabled, kaiSprint2MetadataJsonParser);
  app.use(basePath, handleKaiSprint2JsonParserError);
  app.use(basePath, (req, res, next) => {
    const current = getScenario();
    req.isAuthenticated = () => current.authenticated;
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
    (req, res, next) => (req.isAuthenticated() ? next() : res.status(401).json({ ok: false, error: { code: "unauthorized" }, data: null })),
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

async function postRequestJson(server, path, body) {
  const { port } = server.address();
  return await new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const request = http.request({
      hostname: "127.0.0.1",
      port,
      path,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ statusCode: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }));
    });
    request.on("error", reject);
    request.end(payload);
  });
}

function scenario(overrides = {}) {
  return {
    authenticated: true,
    actorContext,
    calls: [],
    result: {
      ok: true,
      data: {
        generatedContentDraftId: "00000000-0000-4000-8000-000000000777",
        requestedAudience: "funder",
        draftStatus: "draft",
        reviewQueueItemId: "00000000-0000-4000-8000-000000000778",
        blocks: [{ ordinal: 1, text: "A.", citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }] }],
      },
      error: null,
    },
    ...overrides,
  };
}

test("P14-09 exactly one funder evidence-summary POST route exists, additive to (never replacing) the internal route", () => {
  const funderMatches = sprint2IntakeApiRouter.stack
    .filter((layer) => layer.route?.path === "/admin/organizations/:organizationId/generated-content-drafts/evidence-summary/funder");
  assert.equal(funderMatches.length, 1);
  assert.deepEqual(Object.keys(funderMatches[0].route.methods), ["post"]);

  const internalMatches = sprint2IntakeApiRouter.stack
    .filter((layer) => layer.route?.path === "/admin/organizations/:organizationId/generated-content-drafts/evidence-summary");
  assert.equal(internalMatches.length, 1);
  assert.deepEqual(Object.keys(internalMatches[0].route.methods), ["post"]);
});

test("P14-09 route uses the existing Sprint 2 feature-gate and authentication middleware stack", async (t) => {
  let current = scenario({ authenticated: false });
  const originalFeatureFlag = process.env.KAI_SPRINT2_ENABLED;

  const restore = intakeRouteTestables.setIntakeServiceForTest({
    async createEvidenceSummaryDraft() { throw new Error("must not be reached when unauthenticated or disabled"); },
  });
  const server = await listen(createApp(() => current));
  t.after(async () => {
    restore();
    if (originalFeatureFlag === undefined) delete process.env.KAI_SPRINT2_ENABLED;
    else process.env.KAI_SPRINT2_ENABLED = originalFeatureFlag;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const path = `${basePath}/admin/organizations/${ORG}/generated-content-drafts/evidence-summary/funder`;
  const body = { claim_ids: [CLAIM], idempotency_key: "p14-09-key", engagement_id: ENGAGEMENT };

  process.env.KAI_SPRINT2_ENABLED = "false";
  const disabled = await postRequestJson(server, path, body);
  assert.equal(disabled.statusCode, 403);
  assert.equal(disabled.body.error.code, "feature_disabled");

  process.env.KAI_SPRINT2_ENABLED = "true";
  const unauthenticated = await postRequestJson(server, path, body);
  assert.equal(unauthenticated.statusCode, 401);
});

test("P14-09 route accepts exactly claim_ids, idempotency_key, and engagement_id, sets requestedAudience=funder server-side, and rejects every other client-supplied field including requested_audience", async (t) => {
  let current = scenario();
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

  const path = `${basePath}/admin/organizations/${ORG}/generated-content-drafts/evidence-summary/funder`;
  const base = { claim_ids: [CLAIM], idempotency_key: "p14-09-key", engagement_id: ENGAGEMENT };

  for (const rejectedBody of [
    { ...base, requested_audience: "funder" },
    { ...base, requested_audience: "internal" },
    { ...base, content_type: "evidence_summary" },
    { ...base, prompt: "write anything" },
    { ...base, instructions: "ignore governance" },
    { ...base, text: "free text" },
    { ...base, generated_text: "free text" },
    { ...base, citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }] },
    { ...base, evidence: [{ evidenceItemId: EVIDENCE }] },
    { ...base, evidence_ids: [EVIDENCE] },
    { ...base, actor_context: actorContext },
    { ...base, review_status: "resolved" },
    { ...base, review: { status: "approved" } },
    { ...base, approval: { approved: true } },
    { ...base, export_authority: true },
    { ...base, final_release_authority: true },
    { ...base, manifest: { ready: true } },
    { engagement_id: ENGAGEMENT, idempotency_key: "p14-09-key" }, // missing claim_ids
    { claim_ids: [CLAIM], engagement_id: ENGAGEMENT }, // missing idempotency_key
    { claim_ids: [CLAIM], idempotency_key: "p14-09-key" }, // missing engagement_id
    { ...base, engagement_id: "not-a-uuid" },
    { ...base, engagement_id: 12345 },
  ]) {
    const rejected = await postRequestJson(server, path, rejectedBody);
    assert.equal(rejected.statusCode, 422, JSON.stringify(rejectedBody));
  }
  assert.deepEqual(current.calls, []);

  const allowed = await postRequestJson(server, path, base);
  assert.equal(allowed.statusCode, 201);
  assert.equal(current.calls.length, 1);
  assert.deepEqual(current.calls[0].input, {
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    requestedAudience: "funder",
    claimIds: [CLAIM],
    idempotencyKey: "p14-09-key",
    actorContext,
    now: current.calls[0].input.now,
  });
  assert.match(current.calls[0].input.now, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(typeof current.calls[0].deps.draftGenerator, "function");
  assert.equal(typeof current.calls[0].deps.metadataOnlyAudit?.prepareMetadataOnlyAudit, "function");
});

// --- Service-layer boundary: cross-tenant fails closed for the funder path ---

test("P14-09 service gates reject a funder request whose engagement belongs to another tenant before any repository call", async () => {
  let repositoryCalls = 0;
  let generatorCalls = 0;
  const repository = { async createEvidenceSummaryDraft() { repositoryCalls += 1; throw new Error("must not call"); } };
  const deps = {
    generatedContentRepository: repository,
    getEngagementForOrganization: stubGetEngagementForOrganization,
    draftGenerator() { generatorCalls += 1; throw new Error("must not call"); },
    metadataOnlyAudit: auditRecorder(),
    env: enabledEnv,
  };
  const funderInput = {
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    requestedAudience: "funder",
    claimIds: [CLAIM],
    idempotencyKey: "p14-09-cross-tenant",
    actorContext,
    now: NOW,
  };
  // Engagement lookup miss (cross-tenant engagement) -> tenant boundary violation.
  const wrongOrg = await createEvidenceSummaryDraft({ ...funderInput, organizationId: OTHER_ORG }, deps);
  assert.equal(wrongOrg.error.code, "authorization_denied");
  assert.equal(repositoryCalls, 0);
  assert.equal(generatorCalls, 0);
});

// --- Repository-level transaction behavior against a fake authoritative
// transaction (mirrors the existing p3-09 fake-tx dispatch-by-SQL-text
// convention used elsewhere in this suite) ---

function claimRow(overrides = {}) {
  return {
    claim_id: CLAIM,
    claim_statement: "Enrollment increased by 12% in 2025.",
    claim_type: "finding",
    evidence_item_id: EVIDENCE,
    internal_only: true,
    funder_use_allowed: true,
    public_use_allowed: false,
    source_id: SOURCE,
    source_version_id: SOURCE_VERSION,
    intake_file_id: "00000000-0000-4000-8000-000000000901",
    upload_state: "confirmed",
    ...overrides,
  };
}

function makeState({ claims = [claimRow()] } = {}) {
  return {
    generationRuns: [],
    generatedContentDrafts: [],
    generatedContentBlocks: [],
    generatedContentCitations: [],
    reviewQueueItems: [],
    uploadLifecycleAudit: [],
    claims,
  };
}

function makeFakeTx(draft) {
  return {
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, " ").trim();

      if (s.startsWith("INSERT INTO kai.generation_runs")) {
        const [organizationId, engagementId, idempotencyKey, requestFingerprint, contentType, requestedAudience, now] = params;
        const conflict = draft.generationRuns.some((r) => r.organization_id === organizationId && r.idempotency_key === idempotencyKey);
        if (conflict) return { rows: [] };
        const row = {
          generation_run_id: randomUUID(),
          organization_id: organizationId,
          engagement_id: engagementId,
          idempotency_key: idempotencyKey,
          request_fingerprint: requestFingerprint,
          content_type: contentType,
          requested_audience: requestedAudience,
          created_by_type: "system",
          created_at: now,
        };
        draft.generationRuns.push(row);
        return { rows: [{ generation_run_id: row.generation_run_id }] };
      }

      if (s.startsWith("SELECT generation_run_id::text AS generation_run_id")) {
        const [organizationId, idempotencyKey] = params;
        const row = draft.generationRuns.find((r) => r.organization_id === organizationId && r.idempotency_key === idempotencyKey);
        return { rows: row ? [row] : [] };
      }

      if (s.startsWith("SELECT generated_content_draft_id::text AS generated_content_draft_id, generation_run_id")) {
        const [organizationId, generationRunId] = params;
        const rows = draft.generatedContentDrafts.filter((d) => d.organization_id === organizationId && d.generation_run_id === generationRunId);
        return { rows };
      }

      if (s.startsWith("INSERT INTO kai.generated_content_drafts")) {
        const [generationRunId, organizationId, contentType, requestedAudience, draftStatus, reviewStatus, , now] = params;
        const row = {
          generated_content_draft_id: randomUUID(),
          generation_run_id: generationRunId,
          organization_id: organizationId,
          content_type: contentType,
          requested_audience: requestedAudience,
          draft_status: draftStatus,
          review_status: reviewStatus,
          created_by_type: "system",
          created_at: now,
        };
        draft.generatedContentDrafts.push(row);
        return { rows: [{ generated_content_draft_id: row.generated_content_draft_id }] };
      }

      if (s.startsWith("SELECT generated_content_block_id::text AS generated_content_block_id")) {
        const [organizationId, draftId] = params;
        const rows = draft.generatedContentBlocks
          .filter((b) => b.organization_id === organizationId && b.generated_content_draft_id === draftId)
          .sort((a, b) => a.ordinal - b.ordinal);
        return { rows };
      }

      if (s.startsWith("INSERT INTO kai.generated_content_blocks")) {
        const [draftId, organizationId, ordinal, text, now] = params;
        const row = {
          generated_content_block_id: randomUUID(),
          generated_content_draft_id: draftId,
          organization_id: organizationId,
          ordinal,
          text,
          created_at: now,
        };
        draft.generatedContentBlocks.push(row);
        return { rows: [{ generated_content_block_id: row.generated_content_block_id }] };
      }

      if (s.startsWith("SELECT c.generated_content_citation_id::text AS generated_content_citation_id")) {
        const [organizationId, draftId] = params;
        const blockIds = new Set(draft.generatedContentBlocks.filter((b) => b.generated_content_draft_id === draftId).map((b) => b.generated_content_block_id));
        const rows = draft.generatedContentCitations.filter((c) => c.organization_id === organizationId && blockIds.has(c.generated_content_block_id));
        return { rows };
      }

      if (s.startsWith("INSERT INTO kai.generated_content_citations")) {
        const [blockId, organizationId, claimId, evidenceItemId, now] = params;
        draft.generatedContentCitations.push({
          generated_content_citation_id: randomUUID(),
          generated_content_block_id: blockId,
          organization_id: organizationId,
          claim_id: claimId,
          evidence_item_id: evidenceItemId,
          created_at: now,
        });
        return { rows: [] };
      }

      if (s.startsWith("SELECT c.claim_id::text AS claim_id")) {
        const [, claimIds] = params;
        const rows = draft.claims
          .filter((c) => claimIds.includes(c.claim_id))
          .sort((a, b) => (a.claim_id < b.claim_id ? -1 : 1));
        return { rows };
      }

      if (s.startsWith("SELECT review_queue_item_id::text AS review_queue_item_id") && s.includes("queue_type = $2") && !s.includes("updated_at")) {
        const [organizationId, queueType, targetObjectType, targetObjectId] = params;
        const rows = draft.reviewQueueItems.filter((q) =>
          q.organization_id === organizationId
          && q.queue_type === queueType
          && q.target_object_type === targetObjectType
          && q.target_object_id === targetObjectId);
        return { rows };
      }

      if (s.startsWith("INSERT INTO kai.review_queue_items")) {
        const [organizationId, queueType, targetObjectType, targetObjectId, reviewStatus, summary, requiredAction, now] = params;
        const row = {
          review_queue_item_id: randomUUID(),
          organization_id: organizationId,
          engagement_id: null,
          queue_type: queueType,
          target_object_type: targetObjectType,
          target_object_id: targetObjectId,
          priority: "medium",
          queue_status: "open",
          review_status: reviewStatus,
          blocked_reason: null,
          assigned_to: null,
          due_at: null,
          summary,
          required_action: requiredAction,
          queue_metadata: {},
          created_by: null,
          created_by_type: "system",
          created_at: now,
          updated_at: now,
        };
        draft.reviewQueueItems.push(row);
        return { rows: [{ review_queue_item_id: row.review_queue_item_id }] };
      }

      if (s.startsWith("INSERT INTO kai.upload_lifecycle_audit")) {
        const [organizationId, intakeFileId, operation, fromState, metadataJson, now] = params;
        draft.uploadLifecycleAudit.push({ organization_id: organizationId, intake_file_id: intakeFileId, operation, from_state: fromState, metadata: JSON.parse(metadataJson), created_at: now });
        return { rows: [] };
      }

      throw new Error(`unhandled fake query: ${s}`);
    },
  };
}

function withFakeTransaction(state) {
  return async (callback) => {
    const draft = structuredClone(state);
    const result = await callback(makeFakeTx(draft));
    for (const key of Object.keys(draft)) state[key] = draft[key];
    return result;
  };
}

function makeEvaluator({ eligibleForClaim = () => true } = {}) {
  const callCounts = new Map();
  return async (tx, { claimId, requestedAudience }) => {
    const n = (callCounts.get(claimId) || 0) + 1;
    callCounts.set(claimId, n);
    return {
      ok: true,
      data: {
        claim: { claim_id: claimId },
        evidence: { evidence_item_id: EVIDENCE },
        requestedAudience,
        eligible: eligibleForClaim(claimId, n),
        blockerCodes: [],
        affectedDimensionKeys: [],
        affectedObjectIds: [],
      },
      error: null,
    };
  };
}

function makeRepository(state, evaluator) {
  return createPostgresGeneratedContentRepository({
    runInTransaction: withFakeTransaction(state),
    evaluator,
  });
}

function funderGenerator({ calls = [] } = {}) {
  return async (input) => {
    calls.push(input);
    return {
      blocks: [{ ordinal: 1, text: "Enrollment increased by 12% in 2025.", citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }] }],
    };
  };
}

function funderInput(overrides = {}) {
  return {
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    requestedAudience: "funder",
    claimIds: [CLAIM],
    idempotencyKey: "p14-09-repo-key",
    actorContext,
    now: NOW,
    ...overrides,
  };
}

test("P14-09 a currently funder-ineligible claim fails BEFORE the generator is invoked, and no durable rows are created", async () => {
  const state = makeState();
  const generatorCalls = [];
  const evaluator = makeEvaluator({ eligibleForClaim: () => false });
  const repository = makeRepository(state, evaluator);
  const result = await repository.createEvidenceSummaryDraft(funderInput(), {
    draftGenerator: funderGenerator({ calls: generatorCalls }),
    metadataOnlyAudit: auditRecorder(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "funder_use_not_currently_eligible");
  assert.equal(generatorCalls.length, 0);
  assert.equal(state.generationRuns.length, 0);
  assert.equal(state.generatedContentDrafts.length, 0);
  assert.equal(state.generatedContentBlocks.length, 0);
  assert.equal(state.generatedContentCitations.length, 0);
  assert.equal(state.reviewQueueItems.length, 0);
});

test("P14-09 a currently funder-eligible claim reaches the generator and persists engagement binding, requested_audience=funder, content_type=evidence_summary, and an open review row", async () => {
  const state = makeState();
  const generatorCalls = [];
  const evaluator = makeEvaluator({ eligibleForClaim: () => true });
  const repository = makeRepository(state, evaluator);
  const result = await repository.createEvidenceSummaryDraft(funderInput(), {
    draftGenerator: funderGenerator({ calls: generatorCalls }),
    metadataOnlyAudit: auditRecorder(),
  });
  assert.equal(result.ok, true);
  assert.equal(generatorCalls.length, 1);
  assert.equal(generatorCalls[0].requestedAudience, "funder");
  assert.equal(result.data.requestedAudience, "funder");
  assert.equal(result.data.replayed, false);
  assert.equal(state.generationRuns.length, 1);
  assert.equal(state.generationRuns[0].engagement_id, ENGAGEMENT);
  assert.equal(state.generationRuns[0].requested_audience, "funder");
  assert.equal(state.generationRuns[0].content_type, "evidence_summary");
  assert.equal(state.generatedContentDrafts.length, 1);
  assert.equal(state.generatedContentDrafts[0].requested_audience, "funder");
  assert.equal(state.generatedContentDrafts[0].content_type, "evidence_summary");
  assert.equal(state.reviewQueueItems.length, 1);
  assert.equal(state.reviewQueueItems[0].queue_status, GENERATED_CONTENT_REVIEW_QUEUE_CONTRACT.queueStatus);
  assert.equal(state.reviewQueueItems[0].review_status, GENERATED_CONTENT_REVIEW_QUEUE_CONTRACT.reviewStatus);
});

test("P14-09 post-generation eligibility loss (eligible at pre-check, ineligible at revalidation) fails closed and rolls back all request state", async () => {
  const state = makeState();
  const generatorCalls = [];
  // First evaluator call per claim (pre-generation) reports eligible; the
  // second (post-generation revalidation) reports the claim became
  // ineligible before commit.
  const evaluator = makeEvaluator({ eligibleForClaim: (claimId, n) => n === 1 });
  const repository = makeRepository(state, evaluator);
  const result = await repository.createEvidenceSummaryDraft(funderInput(), {
    draftGenerator: funderGenerator({ calls: generatorCalls }),
    metadataOnlyAudit: auditRecorder(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "funder_use_not_currently_eligible");
  assert.equal(generatorCalls.length, 1, "the generator was invoked once (pre-check passed) but nothing may be persisted");
  assert.equal(state.generationRuns.length, 0);
  assert.equal(state.generatedContentDrafts.length, 0);
  assert.equal(state.generatedContentBlocks.length, 0);
  assert.equal(state.generatedContentCitations.length, 0);
  assert.equal(state.reviewQueueItems.length, 0);
});

test("P14-09 idempotency/replay: the same idempotency_key returns the same result without re-invoking the generator", async () => {
  const state = makeState();
  const generatorCalls = [];
  const evaluator = makeEvaluator({ eligibleForClaim: () => true });
  const repository = makeRepository(state, evaluator);
  const deps = { draftGenerator: funderGenerator({ calls: generatorCalls }), metadataOnlyAudit: auditRecorder() };

  const first = await repository.createEvidenceSummaryDraft(funderInput(), deps);
  assert.equal(first.ok, true);
  assert.equal(first.data.replayed, false);
  assert.equal(generatorCalls.length, 1);

  const replay = await repository.createEvidenceSummaryDraft(funderInput(), deps);
  assert.equal(replay.ok, true);
  assert.equal(replay.data.replayed, true);
  assert.equal(replay.data.generatedContentDraftId, first.data.generatedContentDraftId);
  assert.equal(generatorCalls.length, 1, "replay must not re-invoke the generator");
  assert.equal(state.generationRuns.length, 1);
  assert.equal(state.generatedContentDrafts.length, 1);
});

// --- Internal semantics are completely untouched ---

test("P14-09 impact_narrative remains internal-only: the repository rejects a funder-audience impact-narrative request before any transaction begins", async () => {
  const { createImpactNarrativeDraft } = createPostgresGeneratedContentRepository({
    runInTransaction: async () => { throw new Error("must not begin a transaction"); },
  });
  const result = await createImpactNarrativeDraft(funderInput({ idempotencyKey: "p14-09-impact-narrative-funder" }), {
    draftGenerator: async () => { throw new Error("must not call"); },
    metadataOnlyAudit: auditRecorder(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
});

test("P14-09 an internal request is never subject to the funder eligibility gate: a currently-ineligible claim still admits internal generation (Package 14-05 preserved)", async () => {
  const state = makeState();
  const generatorCalls = [];
  const evaluator = makeEvaluator({ eligibleForClaim: () => false });
  const repository = makeRepository(state, evaluator);
  const result = await repository.createEvidenceSummaryDraft(
    { ...funderInput(), requestedAudience: "internal", idempotencyKey: "p14-09-internal-ineligible" },
    { draftGenerator: funderGenerator({ calls: generatorCalls }), metadataOnlyAudit: auditRecorder() },
  );
  assert.equal(result.ok, true);
  assert.equal(generatorCalls.length, 1);
  assert.equal(state.generatedContentDrafts.length, 1);
  assert.equal(state.generatedContentDrafts[0].requested_audience, "internal");
});

// --- Generator adapter: funder audience is accepted, internal wording is unchanged ---

test("P14-09 the shared evidence-summary generator adapter accepts requestedAudience=funder without altering the internal system-prompt wording", async () => {
  const calls = [];
  const generator = createProductionEvidenceSummaryDraftGenerator({
    async createMessage(payload) {
      calls.push(payload);
      return { content: [{ type: "text", text: JSON.stringify({ blocks: [{ text: "Enrollment increased by 12% in 2025.", citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }] }] }) }] };
    },
  });
  const claims = [{
    claimId: CLAIM,
    claimStatement: "Enrollment increased by 12% in 2025.",
    claimType: "finding",
    evidenceItemId: EVIDENCE,
    sourceId: SOURCE,
    sourceVersionId: SOURCE_VERSION,
    limitationCodes: [],
  }];

  const internalResult = await generator({ contentType: "evidence_summary", requestedAudience: "internal", claims });
  assert.equal(internalResult.blocks.length, 1);
  assert.equal(calls[0].system.includes("You generate internal evidence summaries for Get Kinder."), true);

  const funderResult = await generator({ contentType: "evidence_summary", requestedAudience: "funder", claims });
  assert.equal(funderResult.blocks.length, 1);
  assert.equal(calls[1].system.includes("You generate funder-facing evidence summaries for Get Kinder."), true);
  assert.equal(calls[1].system.includes("You generate internal evidence summaries"), false);

  // Public audience remains unsupported by this adapter - a governed empty
  // result, not an error, matching the existing "unrecognized input" contract.
  const publicResult = await generator({ contentType: "evidence_summary", requestedAudience: "public", claims });
  assert.deepEqual(publicResult, { blocks: [] });

  assert.equal(__evidenceSummaryDraftGeneratorContract.FUNDER_REQUESTED_AUDIENCE, "funder");
  assert.equal(__evidenceSummaryDraftGeneratorContract.ALLOWED_REQUESTED_AUDIENCES.has("funder"), true);
  assert.equal(__evidenceSummaryDraftGeneratorContract.ALLOWED_REQUESTED_AUDIENCES.has("public"), false);
});

test("P14-09 request fingerprint distinguishes funder from internal for the same claims/engagement", () => {
  assert.notEqual(
    fingerprintEvidenceSummaryRequest({ requestedAudience: "funder", claimIds: [CLAIM], engagementId: ENGAGEMENT }),
    fingerprintEvidenceSummaryRequest({ requestedAudience: "internal", claimIds: [CLAIM], engagementId: ENGAGEMENT }),
  );
});
