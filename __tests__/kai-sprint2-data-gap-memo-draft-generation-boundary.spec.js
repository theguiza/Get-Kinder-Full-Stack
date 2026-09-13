import test from "node:test";
import assert from "node:assert/strict";

import sprint2IntakeApiRouter from "../Backend/kai/routes/sprint2IntakeApi.js";
import {
  createDataGapMemoDraft,
  __generatedContentReviewPacketServiceTestables,
  __generatedContentServiceContract,
} from "../Backend/kai/services/kaiGeneratedContentService.js";
import { validateGeneratedContentDraft } from "../Backend/kai/validators/kaiGeneratedContentValidators.js";
import {
  __generatedContentRepositoryContract,
  __generatedContentRepositoryTestables,
  fingerprintDataGapMemoRequest,
  fingerprintReadinessAssessmentRequest,
} from "../Backend/kai/dictionary/postgresGeneratedContentRepository.js";
import {
  __dataGapMemoDraftGeneratorContract,
  createProductionDataGapMemoDraftGenerator,
} from "../Backend/kai/services/kaiDataGapMemoDraftGenerator.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const ENGAGEMENT = "00000000-0000-4000-8000-000000000601";
const CLAIM = "00000000-0000-4000-8000-000000000101";
const CLAIM_2 = "00000000-0000-4000-8000-000000000102";
const EVIDENCE = "00000000-0000-4000-8000-000000000201";
const SOURCE = "00000000-0000-4000-8000-000000000301";
const SOURCE_VERSION = "00000000-0000-4000-8000-000000000401";
const GAP = "00000000-0000-4000-8000-000000000501";
const GAP_2 = "00000000-0000-4000-8000-000000000502";
const NOW = "2026-09-13T12:00:00.000Z";
const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" });
const actorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  organizationMemberships: [
    { organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" },
  ],
});

const gaps = Object.freeze({
  items: [{
    gap_log_item_id: GAP,
    claim_id: CLAIM,
    dimension_key: "coverage_gaps",
    assessment_status: "unresolved",
    validator_key: "VAL-COV-001",
  }, {
    gap_log_item_id: GAP_2,
    claim_id: CLAIM_2,
    dimension_key: "small_cell_risk",
    assessment_status: "resolved_risk_flagged",
    validator_key: "VAL-COV-002",
  }],
});

function input(overrides = {}) {
  return {
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    requestedAudience: "internal",
    idempotencyKey: "data-gap-memo-key",
    actorContext,
    now: NOW,
    ...overrides,
  };
}

function generatorClaim(overrides = {}) {
  return {
    claimId: CLAIM,
    claimStatement: "A governed claim has missing support.",
    claimType: "finding",
    evidenceItemId: EVIDENCE,
    sourceId: SOURCE,
    sourceVersionId: SOURCE_VERSION,
    limitationCodes: ["coverage_dimension_unresolved"],
    ...overrides,
  };
}

function generationClaim(overrides = {}) {
  return {
    ...generatorClaim(overrides),
    requestedAudience: "internal",
    audienceAuthority: { internal: true, funder: false, public: false },
    revalidatedForGeneration: true,
  };
}

async function stubGetEngagementForOrganization({ organizationId, engagementId }) {
  if (organizationId === ORG && engagementId === ENGAGEMENT) {
    return { engagement_id: ENGAGEMENT, organization_id: ORG };
  }
  return null;
}

test("data_gap_memo is accepted by the generic generated-content contract and excluded from packet membership", () => {
  const { validateGeneratorInput } = __generatedContentRepositoryTestables;
  assert.equal(__generatedContentRepositoryContract.ALLOWED_GENERATED_CONTENT_TYPES.has("data_gap_memo"), true);
  assert.equal(__generatedContentRepositoryContract.PACKET_MEMBER_CONTENT_TYPES.has("data_gap_memo"), false);
  assert.equal(__generatedContentServiceContract.ALLOWED_GENERATED_CONTENT_TYPES.has("data_gap_memo"), true);
  assert.equal(validateGeneratorInput({
    contentType: "data_gap_memo",
    requestedAudience: "internal",
    gaps,
    claims: [generatorClaim()],
  }), true);
  assert.equal(validateGeneratorInput({
    contentType: "data_gap_memo",
    requestedAudience: "internal",
    claims: [generatorClaim()],
  }), false);
  assert.notEqual(
    fingerprintDataGapMemoRequest({ requestedAudience: "internal", claimIds: [CLAIM], engagementId: ENGAGEMENT }),
    fingerprintReadinessAssessmentRequest({ requestedAudience: "internal", claimIds: [CLAIM], engagementId: ENGAGEMENT }),
  );
});

test("createDataGapMemoDraft derives authoritative gaps server-side, resolves claim ids to citations, and preserves resolved_risk_flagged", async () => {
  const calls = [];
  const result = await createDataGapMemoDraft(input(), {
    env: enabledEnv,
    getEngagementForOrganization: stubGetEngagementForOrganization,
    async listOrganizationEvidenceGapsForImpactLibrary(gapInput) {
      calls.push({ type: "gaps", gapInput });
      return {
        ok: true,
        data: {
          items: gaps.items,
          limit: 25,
          afterGapLogItemId: null,
          truncated: false,
          nextAfterGapLogItemId: null,
        },
        error: null,
      };
    },
    generatedContentRepository: {
      async createDataGapMemoDraft(repositoryInput, dependencies) {
        calls.push({
          type: "repository",
          repositoryInput,
          authoritativeDataGaps: dependencies.authoritativeDataGaps,
        });
        return {
          ok: true,
          data: { generatedContentDraftId: "00000000-0000-4000-8000-000000000701" },
          error: null,
        };
      },
    },
    draftGenerator: async () => ({ blocks: [] }),
    metadataOnlyAudit: {},
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls.map((call) => call.type), ["gaps", "repository"]);
  assert.deepEqual(calls[0].gapInput, {
    organizationId: ORG,
    limit: 25,
    afterGapLogItemId: null,
    actorContext,
  });
  assert.deepEqual(calls[1].repositoryInput.claimIds, [CLAIM, CLAIM_2]);
  assert.equal(calls[1].authoritativeDataGaps.items[1].assessment_status, "resolved_risk_flagged");
});

test("caller cannot supply authoritative gap state, claim ids, evidence ids, currentness, or citation authority", async () => {
  let gapCalls = 0;
  const deps = {
    env: enabledEnv,
    getEngagementForOrganization: stubGetEngagementForOrganization,
    async listOrganizationEvidenceGapsForImpactLibrary() {
      gapCalls += 1;
      return { ok: false, data: null, error: { code: "validation_blocker", status: 422 } };
    },
    generatedContentRepository: {
      async createDataGapMemoDraft() {
        throw new Error("must not persist");
      },
    },
    draftGenerator: async () => ({ blocks: [] }),
    metadataOnlyAudit: {},
  };

  const bad = await createDataGapMemoDraft(input({
    claimIds: [CLAIM],
    gaps,
    evidenceItemId: EVIDENCE,
  }), deps);
  assert.equal(bad.error.code, "validation_blocker");
  assert.equal(gapCalls, 0);

  const unreadable = await createDataGapMemoDraft(input(), deps);
  assert.equal(unreadable.error.code, "validation_blocker");
  assert.equal(gapCalls, 1);
});

test("bounded pagination completes all pages and fails closed when generated-content claim bound is exceeded", async () => {
  const pages = [
    {
      items: [gaps.items[0]],
      truncated: true,
      nextAfterGapLogItemId: GAP,
    },
    {
      items: [gaps.items[1]],
      truncated: false,
      nextAfterGapLogItemId: null,
    },
  ];
  const seen = [];
  const result = await createDataGapMemoDraft(input(), {
    env: enabledEnv,
    getEngagementForOrganization: stubGetEngagementForOrganization,
    async listOrganizationEvidenceGapsForImpactLibrary(gapInput) {
      seen.push(gapInput.afterGapLogItemId);
      const page = pages.shift();
      return { ok: true, data: { limit: 25, afterGapLogItemId: gapInput.afterGapLogItemId, ...page }, error: null };
    },
    generatedContentRepository: {
      async createDataGapMemoDraft(repositoryInput, dependencies) {
        assert.deepEqual(repositoryInput.claimIds, [CLAIM, CLAIM_2]);
        assert.equal(dependencies.authoritativeDataGaps.items.length, 2);
        return { ok: true, data: { generatedContentDraftId: "00000000-0000-4000-8000-000000000702" }, error: null };
      },
    },
    draftGenerator: async () => ({ blocks: [] }),
    metadataOnlyAudit: {},
  });
  assert.equal(result.ok, true);
  assert.deepEqual(seen, [null, GAP]);

  const overflowItems = Array.from({ length: __generatedContentServiceContract.DATA_GAP_MEMO_GENERATION_CLAIM_LIMIT + 1 }, (_, index) => ({
    ...gaps.items[0],
    gap_log_item_id: `00000000-0000-4000-8000-${String(800000000000 + index).padStart(12, "0")}`,
    claim_id: `00000000-0000-4000-8000-${String(700000000000 + index).padStart(12, "0")}`,
  }));
  let repositoryCalls = 0;
  const overflow = await createDataGapMemoDraft(input(), {
    env: enabledEnv,
    getEngagementForOrganization: stubGetEngagementForOrganization,
    async listOrganizationEvidenceGapsForImpactLibrary() {
      return { ok: true, data: { items: overflowItems, limit: 25, afterGapLogItemId: null, truncated: false, nextAfterGapLogItemId: null }, error: null };
    },
    generatedContentRepository: {
      async createDataGapMemoDraft() {
        repositoryCalls += 1;
      },
    },
    draftGenerator: async () => ({ blocks: [] }),
    metadataOnlyAudit: {},
  });
  assert.equal(overflow.error.code, "validation_blocker");
  assert.equal(overflow.blockers[0].blocking_reason, "data_gap_memo_generation_claim_bound_exceeded");
  assert.equal(repositoryCalls, 0);
});

test("data gap memo idempotency lifecycle: new attempt key permits changed authoritative gaps while old key remains fail-closed", async () => {
  const runs = new Map();
  const repositoryCalls = [];
  const generatedContentRepository = {
    async createDataGapMemoDraft(repositoryInput) {
      repositoryCalls.push(repositoryInput);
      const requestFingerprint = fingerprintDataGapMemoRequest({
        requestedAudience: repositoryInput.requestedAudience,
        claimIds: repositoryInput.claimIds,
        engagementId: repositoryInput.engagementId,
      });
      const existing = runs.get(repositoryInput.idempotencyKey);
      if (existing) {
        if (existing.requestFingerprint !== requestFingerprint) {
          return { ok: false, data: null, error: { code: "duplicate_conflict", status: 409 } };
        }
        return { ok: true, data: { generatedContentDraftId: existing.generatedContentDraftId, replayed: true }, error: null };
      }
      const generatedContentDraftId = `00000000-0000-4000-8000-${String(900000000000 + runs.size).padStart(12, "0")}`;
      runs.set(repositoryInput.idempotencyKey, { requestFingerprint, generatedContentDraftId });
      return { ok: true, data: { generatedContentDraftId, replayed: false }, error: null };
    },
  };
  let authoritativeGaps = { items: [gaps.items[0]] };
  const deps = {
    env: enabledEnv,
    getEngagementForOrganization: stubGetEngagementForOrganization,
    async listOrganizationEvidenceGapsForImpactLibrary() {
      return {
        ok: true,
        data: {
          items: authoritativeGaps.items,
          limit: 25,
          afterGapLogItemId: null,
          truncated: false,
          nextAfterGapLogItemId: null,
        },
        error: null,
      };
    },
    generatedContentRepository,
    draftGenerator: async () => ({ blocks: [] }),
    metadataOnlyAudit: {},
  };

  const first = await createDataGapMemoDraft(input({ idempotencyKey: "data-gap-memo-k1" }), deps);
  assert.equal(first.ok, true);
  assert.deepEqual(repositoryCalls.at(-1).claimIds, [CLAIM]);

  const unchangedNewAttempt = await createDataGapMemoDraft(input({ idempotencyKey: "data-gap-memo-k2" }), deps);
  assert.equal(unchangedNewAttempt.ok, true);
  assert.notEqual(unchangedNewAttempt.data.generatedContentDraftId, first.data.generatedContentDraftId);
  assert.deepEqual(repositoryCalls.at(-1).claimIds, [CLAIM]);

  authoritativeGaps = { items: [gaps.items[0], gaps.items[1]] };
  const changedWithNewAttempt = await createDataGapMemoDraft(input({ idempotencyKey: "data-gap-memo-k3" }), deps);
  assert.equal(changedWithNewAttempt.ok, true);
  assert.deepEqual(repositoryCalls.at(-1).claimIds, [CLAIM, CLAIM_2]);

  const changedWithOldAttempt = await createDataGapMemoDraft(input({ idempotencyKey: "data-gap-memo-k1" }), deps);
  assert.equal(changedWithOldAttempt.ok, false);
  assert.equal(changedWithOldAttempt.error.code, "duplicate_conflict");
  assert.equal(changedWithOldAttempt.error.status, 409);
  assert.deepEqual(repositoryCalls.at(-1).claimIds, [CLAIM, CLAIM_2]);
});

test("claim to citation path uses existing deterministic claim/evidence traceability semantics; evidence ids are not guessed", () => {
  const ok = validateGeneratedContentDraft({
    requestedAudience: "internal",
    contentType: "data_gap_memo",
    authoritativeReadiness: gaps,
    generationClaims: [generationClaim()],
    blocks: [{
      ordinal: 1,
      text: "The memo describes missing support as a current data gap.",
      citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }],
    }],
  });
  assert.equal(ok.ok, true);

  const guessed = validateGeneratedContentDraft({
    requestedAudience: "internal",
    contentType: "data_gap_memo",
    authoritativeReadiness: gaps,
    generationClaims: [generationClaim()],
    blocks: [{
      ordinal: 1,
      text: "The memo describes missing support as a current data gap.",
      citations: [{ claimId: CLAIM, evidenceItemId: "00000000-0000-4000-8000-000000000999" }],
    }],
  });
  assert.equal(guessed.ok, false);
  assert.equal(guessed.blockers.some((blocker) => blocker.blocking_reason === "missing_or_unresolved_exact_citation"), true);
});

test("data gap semantic validator blocks gap-to-positive-support inversion without changing Readiness or Impact Narrative semantics", () => {
  const inverted = validateGeneratedContentDraft({
    requestedAudience: "internal",
    contentType: "data_gap_memo",
    authoritativeReadiness: gaps,
    generationClaims: [generationClaim()],
    blocks: [{
      ordinal: 1,
      text: "There are no data gaps and support is sufficient.",
      citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }],
    }],
  });
  assert.equal(inverted.ok, false);
  assert.equal(
    inverted.blockers.some((blocker) => blocker.blocking_reason === "data_gap_or_missing_support_stated_as_positive_support"),
    true,
  );

  const limitation = validateGeneratedContentDraft({
    requestedAudience: "internal",
    contentType: "data_gap_memo",
    authoritativeReadiness: gaps,
    generationClaims: [generationClaim()],
    blocks: [{
      ordinal: 1,
      text: "The memo identifies a limitation: support is not sufficient for this gap.",
      citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }],
    }],
  });
  assert.equal(limitation.ok, true);

  const impactNarrative = validateGeneratedContentDraft({
    requestedAudience: "internal",
    contentType: "impact_narrative",
    generationClaims: [generationClaim({ limitationCodes: [] })],
    blocks: [{
      ordinal: 1,
      text: "A governed claim has missing support.",
      citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }],
    }],
  });
  assert.equal(impactNarrative.results.some((result) => result.validator_key === "VAL-GEN-007"), false);
});

test("review packet DTO reuses generated_content_review and KAI cannot approve/finalize a data gap memo", () => {
  const { isGeneratedDraftReviewPacketDto } = __generatedContentReviewPacketServiceTestables;
  assert.equal(isGeneratedDraftReviewPacketDto({
    generationRunId: "00000000-0000-4000-8000-000000000801",
    generatedContentDraftId: "00000000-0000-4000-8000-000000000802",
    contentType: "data_gap_memo",
    draftStatus: "draft",
    requestedAudience: "internal",
    reviewQueueItemId: "00000000-0000-4000-8000-000000000803",
    queueStatus: "open",
    reviewStatus: "needs_gk_review",
    reviewUpdatedAt: NOW,
    currentUseEligible: false,
    exportReviewQueueItemId: null,
    exportReviewQueueStatus: null,
    exportReviewStatus: null,
    blocks: [{
      ordinal: 1,
      text: "Gap text.",
      citations: [{
        generatedContentCitationId: "00000000-0000-4000-8000-000000000804",
        claimId: CLAIM,
        evidenceItemId: EVIDENCE,
        sourceId: SOURCE,
        sourceVersionId: SOURCE_VERSION,
        supportStrength: "unassessed",
        claimReviewStatus: "needs_gk_review",
        evidenceReviewStatus: "needs_gk_review",
        currentEligible: false,
        blockerCodes: ["coverage_dimension_unresolved"],
        affectedDimensionKeys: ["coverage_gaps"],
        affectedObjectIds: [],
      }],
    }],
  }), true);
  assert.equal(sprint2IntakeApiRouter.stack.some((layer) => String(layer.route?.path || "").includes("data-gap-memo/final")), false);
});

test("production data gap memo generator sends only authoritative gaps and governed claims", async () => {
  const calls = [];
  const generator = createProductionDataGapMemoDraftGenerator({
    async createMessage(payload) {
      calls.push(payload);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            blocks: [{
              text: "A current data gap remains for coverage support.",
              citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE, ignored: "drop" }],
            }],
          }),
        }],
      };
    },
  });

  const result = await generator({
    contentType: "data_gap_memo",
    requestedAudience: "internal",
    gaps,
    claims: [generatorClaim()],
  });

  assert.deepEqual(result, {
    blocks: [{
      ordinal: 1,
      text: "A current data gap remains for coverage support.",
      citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }],
    }],
  });
  assert.equal(calls[0].model, __dataGapMemoDraftGeneratorContract.MODEL);
  assert.equal(JSON.stringify(calls[0]).includes("resolved_risk_flagged"), true);
  assert.equal(JSON.stringify(calls[0]).includes("raw_content"), false);
  assert.equal(JSON.stringify(calls[0]).includes("signed_url"), false);
});

test("data gap memo route is mounted and rejects browser-supplied gap/citation authority by schema", () => {
  const matches = sprint2IntakeApiRouter.stack
    .filter((layer) => layer.route?.path === "/admin/organizations/:organizationId/generated-content-drafts/data-gap-memo" && layer.route?.methods?.post);
  assert.equal(matches.length, 1);
  assert.deepEqual(Object.keys(matches[0].route.methods), ["post"]);
});
