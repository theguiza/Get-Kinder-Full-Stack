import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import sprint2IntakeApiRouter, { __testables as intakeRouteTestables } from "../Backend/kai/routes/sprint2IntakeApi.js";
import { requireKaiSprint2Enabled } from "../Backend/kai/config/kaiSprint2Config.js";
import {
  createAttachKaiSprint2ActorContext,
} from "../Backend/kai/middleware/kaiSprint2Authentication.js";
import {
  createCaseForSupportDraft,
} from "../Backend/kai/services/kaiGeneratedContentService.js";
import { __generatedContentReviewPacketServiceTestables } from "../Backend/kai/services/kaiGeneratedContentService.js";
import {
  __generatedContentRepositoryTestables,
  fingerprintEvidenceSummaryRequest,
  fingerprintCaseForSupportRequest,
} from "../Backend/kai/dictionary/postgresGeneratedContentRepository.js";
import { generatedDraftContentTypeLabel } from "../frontend/impactEvidenceLibraryLogic.js";
import {
  __caseForSupportDraftGeneratorContract,
  createProductionCaseForSupportDraftGenerator,
} from "../Backend/kai/services/kaiCaseForSupportDraftGenerator.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const ENGAGEMENT = "00000000-0000-4000-8000-000000000601";
const CLAIM = "00000000-0000-4000-8000-000000000101";
const EVIDENCE = "00000000-0000-4000-8000-000000000201";
const NOW = "2026-08-06T10:00:00.000Z";
const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" });
const adminActorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  source: "public.userdata",
  organizationMemberships: [
    { organization_id: ORG, membership_status: "active", role_name: "gk_admin" },
  ],
});
const clientActorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000003",
  source: "public.userdata",
  organizationMemberships: [
    { organization_id: ORG, membership_status: "active", role_name: "client" },
  ],
});

function input(overrides = {}) {
  return {
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    requestedAudience: "internal",
    claimIds: [CLAIM],
    idempotencyKey: "p13-ext1-case-for-support-key",
    actorContext: adminActorContext,
    now: NOW,
    ...overrides,
  };
}

async function stubGetEngagementForOrganization({ organizationId, engagementId }) {
  if (organizationId === ORG && engagementId === ENGAGEMENT) {
    return { engagement_id: ENGAGEMENT, organization_id: ORG };
  }
  return null;
}

const basePath = "/api/kai/sprint2/intake";
const routePath = "/admin/organizations/:organizationId/generated-content-drafts/case-for-support";

function createResponse() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    set(field, value) {
      this.headers[field] = value;
      return this;
    },
    json(body) {
      this.body = body;
      return body;
    },
  };
}

async function invokeCaseForSupportRoute(body, { actorContext = adminActorContext } = {}) {
  const routeLayer = sprint2IntakeApiRouter.stack
    .find((layer) => layer.route?.path === routePath && layer.route?.methods?.post);
  assert.ok(routeLayer);
  const req = {
    params: { organizationId: ORG },
    query: {},
    body,
    headers: { "content-type": "application/json" },
  };
  const res = createResponse();
  const restoreActorContextMiddleware = intakeRouteTestables.setActorContextMiddlewareForTest(
    createAttachKaiSprint2ActorContext({
      resolveActorContext: async () => ({ ok: true, actorContext }),
    }),
  );
  try {
    let index = 0;
    const next = async (error) => {
      if (error) throw error;
      const layer = routeLayer.route.stack[index++];
      if (!layer) return;
      await layer.handle(req, res, next);
    };
    await next();
    return res;
  } finally {
    restoreActorContextMiddleware();
  }
}

function requestBody(overrides = {}) {
  return {
    engagement_id: ENGAGEMENT,
    requested_audience: "internal",
    claim_ids: [CLAIM],
    idempotency_key: "p13-ext1-case-for-support-route-key",
    ...overrides,
  };
}

test("P13-EXT-1 route is mounted as an authenticated case_for_support draft-generation POST", () => {
  const matches = sprint2IntakeApiRouter.stack
    .filter((layer) => layer.route?.path === routePath && layer.route?.methods?.post);
  assert.equal(matches.length, 1);
  assert.deepEqual(Object.keys(matches[0].route.methods), ["post"]);
});

test("P13-EXT-1 HTTP route preserves Sprint-2/generation controls and delegates internal/funder/public through createCaseForSupportDraft", async (t) => {
  const calls = [];
  const restoreService = intakeRouteTestables.setIntakeServiceForTest({
    async createCaseForSupportDraft(input, dependencies) {
      calls.push({ input, dependencies });
      if (process.env.KAI_GENERATION_ENABLED !== "true") {
        return { ok: false, data: null, error: { code: "feature_disabled" }, blockers: [] };
      }
      if (input.requestedAudience === "public") {
        return { ok: false, data: null, error: { code: "validation_blocker" }, blockers: [] };
      }
      return {
        ok: true,
        data: {
          generationRunId: "00000000-0000-4000-8000-000000000801",
          generatedContentDraftId: "00000000-0000-4000-8000-000000000802",
          requestedAudience: input.requestedAudience,
          draftStatus: "draft",
          reviewStatus: "needs_gk_review",
          reviewQueueItemId: "00000000-0000-4000-8000-000000000803",
          blocks: [{ ordinal: 1, text: "A claim-backed statement.", citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }] }],
          replayed: false,
        },
        error: null,
      };
    },
  });
  const originalSprint2 = process.env.KAI_SPRINT2_ENABLED;
  const originalGeneration = process.env.KAI_GENERATION_ENABLED;

  t.after(() => {
    restoreService();
    if (originalSprint2 === undefined) delete process.env.KAI_SPRINT2_ENABLED;
    else process.env.KAI_SPRINT2_ENABLED = originalSprint2;
    if (originalGeneration === undefined) delete process.env.KAI_GENERATION_ENABLED;
    else process.env.KAI_GENERATION_ENABLED = originalGeneration;
  });

  process.env.KAI_SPRINT2_ENABLED = "false";
  process.env.KAI_GENERATION_ENABLED = "true";
  const featureDisabled = createResponse();
  let featureGateNextCalled = false;
  requireKaiSprint2Enabled({}, featureDisabled, () => {
    featureGateNextCalled = true;
  });
  assert.equal(featureGateNextCalled, false);
  assert.equal(featureDisabled.statusCode, 403);
  assert.equal(featureDisabled.body.error.code, "feature_disabled");
  assert.equal(calls.length, 0);

  process.env.KAI_SPRINT2_ENABLED = "true";
  process.env.KAI_GENERATION_ENABLED = "false";
  const generationDisabled = await invokeCaseForSupportRoute(requestBody());
  assert.equal(generationDisabled.statusCode, 403);
  assert.equal(generationDisabled.body.error.code, "feature_disabled");
  assert.equal(calls.length, 1, "generation feature control is enforced by the delegated service boundary");

  process.env.KAI_GENERATION_ENABLED = "true";

  const internal = await invokeCaseForSupportRoute(requestBody({ requested_audience: "internal" }));
  assert.equal(internal.statusCode, 201);
  assert.equal(internal.body.data.requestedAudience, "internal");

  const funder = await invokeCaseForSupportRoute(requestBody({ requested_audience: "funder" }));
  assert.equal(funder.statusCode, 201);
  assert.equal(funder.body.data.requestedAudience, "funder");

  const publicResult = await invokeCaseForSupportRoute(requestBody({ requested_audience: "public" }));
  assert.equal(publicResult.statusCode, 422);
  assert.equal(publicResult.body.error.code, "validation_blocker");

  assert.equal(calls.length, 4);
  assert.deepEqual(calls.map((call) => call.input.requestedAudience), ["internal", "internal", "funder", "public"]);
  assert.equal(calls[1].input.organizationId, ORG);
  assert.equal(calls[1].input.engagementId, ENGAGEMENT);
  assert.deepEqual(calls[1].input.claimIds, [CLAIM]);
  assert.equal(calls[1].input.idempotencyKey, "p13-ext1-case-for-support-route-key");
  assert.deepEqual(calls[1].input.actorContext, adminActorContext);
  assert.equal(typeof calls[1].input.now, "string");
  assert.equal(typeof calls[1].dependencies.draftGenerator, "function");
  assert.equal(typeof calls[1].dependencies.metadataOnlyAudit?.prepareMetadataOnlyAudit, "function");
});

test("P13-EXT-1 HTTP route source delegates only and contains no direct persistence behavior", () => {
  const routeSource = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
  const start = routeSource.indexOf('router.post(\n  "/admin/organizations/:organizationId/generated-content-drafts/case-for-support"');
  assert.ok(start >= 0);
  // P13-EXT-2's board-update route was inserted directly after this one
  // (before the review-packet route), so bound this section at the
  // board-update route's own start rather than review-packet's - keeping
  // this test scoped to case-for-support's own route only.
  const end = routeSource.indexOf('router.post(\n  "/admin/organizations/:organizationId/generated-content-drafts/board-update"', start);
  assert.ok(end > start);
  const section = routeSource.slice(start, end);
  assert.match(section, /createCaseForSupportDraft/);
  assert.doesNotMatch(section, /\bkai\./);
  assert.doesNotMatch(section, /\b(?:pool|db)\.query\s*\(/);
  assert.doesNotMatch(section, /\b(?:SELECT|INSERT|UPDATE|DELETE)\b/i);
});

test("P13-EXT-1 service gates: disabled, generation-disabled, malformed, and public-audience calls do not call the repository or generator", async () => {
  let repositoryCalls = 0;
  let generatorCalls = 0;
  const repository = {
    async createCaseForSupportDraft() {
      repositoryCalls += 1;
      throw new Error("must not call");
    },
  };
  const deps = {
    generatedContentRepository: repository,
    getEngagementForOrganization: stubGetEngagementForOrganization,
    draftGenerator() {
      generatorCalls += 1;
      throw new Error("must not call");
    },
    metadataOnlyAudit: {},
  };
  assert.equal((await createCaseForSupportDraft(input(), { ...deps, env: {} })).error.code, "feature_disabled");
  assert.equal((await createCaseForSupportDraft(input(), { ...deps, env: { KAI_SPRINT2_ENABLED: "true" } })).error.code, "feature_disabled");
  assert.equal((await createCaseForSupportDraft({ ...input(), extra: true }, { ...deps, env: enabledEnv })).error.code, "validation_blocker");
  // Decision: case_for_support generation is internal + funder only - public
  // must be rejected at the service-level input validator, never silently
  // coerced.
  assert.equal((await createCaseForSupportDraft(input({ requestedAudience: "public" }), { ...deps, env: enabledEnv })).error.code, "validation_blocker");
  assert.equal((await createCaseForSupportDraft(input({ requestedAudience: "not_a_real_audience" }), { ...deps, env: enabledEnv })).error.code, "validation_blocker");
  assert.equal((await createCaseForSupportDraft(input({ actorContext: { actorType: "system", actorUserId: adminActorContext.actorUserId } }), { ...deps, env: enabledEnv })).error.code, "authorization_denied");
  assert.equal(repositoryCalls, 0);
  assert.equal(generatorCalls, 0);
});

test("P13-EXT-1 RBAC: a disallowed ('client') actor is rejected before the repository is ever called", async () => {
  let repositoryCalls = 0;
  const repository = {
    async createCaseForSupportDraft() {
      repositoryCalls += 1;
      throw new Error("must not call");
    },
  };
  const result = await createCaseForSupportDraft(input({ actorContext: clientActorContext }), {
    env: enabledEnv,
    generatedContentRepository: repository,
    getEngagementForOrganization: stubGetEngagementForOrganization,
    metadataOnlyAudit: {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
  assert.equal(repositoryCalls, 0);
});

test("P13-EXT-1 tenant-boundary: an organizationId/engagementId pair outside the actor's tenant is rejected before the repository is ever called", async () => {
  let repositoryCalls = 0;
  const repository = {
    async createCaseForSupportDraft() {
      repositoryCalls += 1;
      throw new Error("must not call");
    },
  };
  const wrongOrgResult = await createCaseForSupportDraft(input({ organizationId: OTHER_ORG }), {
    env: enabledEnv,
    generatedContentRepository: repository,
    getEngagementForOrganization: stubGetEngagementForOrganization,
    metadataOnlyAudit: {},
  });
  assert.equal(wrongOrgResult.ok, false);
  assert.equal(wrongOrgResult.error.code, "authorization_denied");

  const wrongEngagementResult = await createCaseForSupportDraft(input({ engagementId: "00000000-0000-4000-8000-000000000999" }), {
    env: enabledEnv,
    generatedContentRepository: repository,
    getEngagementForOrganization: stubGetEngagementForOrganization,
    metadataOnlyAudit: {},
  });
  assert.equal(wrongEngagementResult.ok, false);
  assert.equal(wrongEngagementResult.error.code, "tenant_boundary_violation");
  assert.equal(repositoryCalls, 0);
});

for (const requestedAudience of ["internal", "funder"]) {
  test(`P13-EXT-1 successful creation for requestedAudience "${requestedAudience}": the service delegates to repository.createCaseForSupportDraft once all gates pass`, async () => {
    let repositoryCalls = 0;
    let capturedInput = null;
    const repository = {
      async createCaseForSupportDraft(repoInput) {
        repositoryCalls += 1;
        capturedInput = repoInput;
        return {
          ok: true,
          data: {
            generationRunId: "00000000-0000-4000-8000-000000000801",
            generatedContentDraftId: "00000000-0000-4000-8000-000000000802",
            requestedAudience,
            draftStatus: "draft",
            reviewStatus: "needs_gk_review",
            reviewQueueItemId: "00000000-0000-4000-8000-000000000803",
            blocks: [{ ordinal: 1, text: "A claim-backed statement.", citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }] }],
            replayed: false,
          },
          error: null,
        };
      },
    };
    const result = await createCaseForSupportDraft(input({ requestedAudience }), {
      env: enabledEnv,
      generatedContentRepository: repository,
      getEngagementForOrganization: stubGetEngagementForOrganization,
      metadataOnlyAudit: {},
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(repositoryCalls, 1);
    assert.equal(capturedInput.requestedAudience, requestedAudience);
    assert.equal(result.data.draftStatus, "draft");
    assert.equal(result.data.reviewStatus, "needs_gk_review");
  });
}

test("P13-EXT-1 rejection when the input shape is otherwise invalid (missing required field, duplicate/unsorted claimIds, malformed idempotency key)", async () => {
  let repositoryCalls = 0;
  const repository = {
    async createCaseForSupportDraft() {
      repositoryCalls += 1;
      throw new Error("must not call");
    },
  };
  const deps = {
    env: enabledEnv,
    generatedContentRepository: repository,
    getEngagementForOrganization: stubGetEngagementForOrganization,
    metadataOnlyAudit: {},
  };

  const { organizationId, ...missingOrganizationId } = input();
  assert.equal((await createCaseForSupportDraft(missingOrganizationId, deps)).error.code, "validation_blocker");

  assert.equal((await createCaseForSupportDraft(input({ claimIds: [] }), deps)).error.code, "validation_blocker");
  assert.equal((await createCaseForSupportDraft(input({ claimIds: [CLAIM, CLAIM] }), deps)).error.code, "validation_blocker");
  assert.equal((await createCaseForSupportDraft(input({ idempotencyKey: "" }), deps)).error.code, "validation_blocker");
  assert.equal(repositoryCalls, 0);
});

test("P13-EXT-1 contentType participates in the request fingerprint: evidence_summary and case_for_support never share an identity for the same org/audience/claims/idempotency key", () => {
  const evidenceSummaryFingerprint = fingerprintEvidenceSummaryRequest({
    requestedAudience: "internal",
    claimIds: [CLAIM],
  });
  const caseForSupportFingerprint = fingerprintCaseForSupportRequest({
    requestedAudience: "internal",
    claimIds: [CLAIM],
  });
  assert.notEqual(evidenceSummaryFingerprint, caseForSupportFingerprint);

  // Deterministic: identical content type/audience/claims always hash the same.
  assert.equal(
    fingerprintCaseForSupportRequest({ requestedAudience: "internal", claimIds: [CLAIM] }),
    caseForSupportFingerprint,
  );
});

test("P13-EXT-1 repository generator-input contract allows case_for_support (standard shape, no readiness/gap extras)", () => {
  const { validateGeneratorInput } = __generatedContentRepositoryTestables;
  const baseClaim = {
    claimId: CLAIM,
    claimStatement: "A claim.",
    claimType: "finding",
    evidenceItemId: EVIDENCE,
    sourceId: "00000000-0000-4000-8000-000000000301",
    sourceVersionId: "00000000-0000-4000-8000-000000000401",
    limitationCodes: [],
  };
  assert.equal(validateGeneratorInput({ contentType: "case_for_support", requestedAudience: "internal", claims: [baseClaim] }), true);
  assert.equal(validateGeneratorInput({ contentType: "case_for_support", requestedAudience: "funder", claims: [baseClaim] }), true);
  assert.equal(validateGeneratorInput({ contentType: "case_for_support", requestedAudience: "public", claims: [baseClaim] }), true);
  assert.equal(validateGeneratorInput({ contentType: "grant_response_paragraph", requestedAudience: "internal", claims: [baseClaim] }), false);
});

test("P13-EXT-1 review-packet DTO contract accepts case_for_support alongside the other content types", () => {
  const { isGeneratedDraftReviewPacketDto } = __generatedContentReviewPacketServiceTestables;
  const basePacket = {
    generationRunId: "00000000-0000-4000-8000-000000000501",
    generatedContentDraftId: "00000000-0000-4000-8000-000000000502",
    contentType: "case_for_support",
    draftStatus: "draft",
    requestedAudience: "internal",
    reviewQueueItemId: "00000000-0000-4000-8000-000000000503",
    queueStatus: "open",
    reviewStatus: "needs_gk_review",
    reviewUpdatedAt: NOW,
    currentUseEligible: true,
    exportReviewQueueItemId: null,
    exportReviewQueueStatus: null,
    exportReviewStatus: null,
    blocks: [{
      ordinal: 1,
      text: "Narrative text.",
      citations: [{
        claimId: CLAIM,
        evidenceItemId: EVIDENCE,
        sourceId: "00000000-0000-4000-8000-000000000301",
        sourceCode: null,
        sourceVersionId: "00000000-0000-4000-8000-000000000401",
        supportStrength: "unassessed",
        claimReviewStatus: "needs_gk_review",
        evidenceReviewStatus: "needs_gk_review",
        currentEligible: true,
        blockerCodes: [],
        affectedDimensionKeys: [],
        affectedObjectIds: [],
        approvedAudiences: null,
      }],
    }],
  };
  assert.equal(isGeneratedDraftReviewPacketDto(basePacket), true);
  assert.equal(isGeneratedDraftReviewPacketDto({ ...basePacket, requestedAudience: "funder" }), true);
  assert.equal(isGeneratedDraftReviewPacketDto({ ...basePacket, contentType: "grant_response_paragraph" }), false);
});

test("P13-EXT-1 production case-for-support draft-generator adapter sends only the governed projection, normalizes provider JSON, and accepts both internal and funder audiences", async () => {
  for (const requestedAudience of ["internal", "funder"]) {
    const calls = [];
    const generator = createProductionCaseForSupportDraftGenerator({
      async createMessage(payload) {
        calls.push(payload);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              blocks: [{
                text: "This organization's work is traceable to a governed evidence item.",
                citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE, ignored: "drop" }],
                ignored: "drop",
              }],
            }),
          }],
        };
      },
    });

    const result = await generator({
      contentType: "case_for_support",
      requestedAudience,
      claims: [{
        claimId: CLAIM,
        claimStatement: "This organization's work is traceable to a governed evidence item.",
        claimType: "finding",
        evidenceItemId: EVIDENCE,
        sourceId: "00000000-0000-4000-8000-000000000301",
        sourceVersionId: "00000000-0000-4000-8000-000000000401",
        limitationCodes: [],
      }],
    });

    assert.deepEqual(result, {
      blocks: [{
        ordinal: 1,
        text: "This organization's work is traceable to a governed evidence item.",
        citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }],
      }],
    });
    assert.equal(__generatedContentRepositoryTestables.validateGeneratorResult(result), true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].model, __caseForSupportDraftGeneratorContract.MODEL);
    assert.equal(calls[0].tools, undefined);
    assert.equal(JSON.stringify(calls[0]).includes("prompt"), false);
    assert.equal(JSON.stringify(calls[0]).includes("signed_url"), false);
    assert.equal(JSON.stringify(calls[0]).includes("raw_content"), false);
  }

  // A "public" requestedAudience is out of scope for this generator (the
  // service-level input validator already rejects it before generation is
  // ever reached) - the generator itself fails closed too, tagging the
  // input-contract-rejected reason rather than calling the provider.
  const publicCalls = [];
  const publicGenerator = createProductionCaseForSupportDraftGenerator({
    async createMessage(payload) {
      publicCalls.push(payload);
      throw new Error("must not call");
    },
  });
  const publicResult = await publicGenerator({
    contentType: "case_for_support",
    requestedAudience: "public",
    claims: [],
  });
  assert.deepEqual(publicResult, { blocks: [] });
  assert.equal(publicCalls.length, 0);
});
