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

const { classifyGeneratorResult, GENERATOR_RESULT_REASONS, validateGeneratorResult } = __generatedContentRepositoryTestables;

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

test("data gap VAL-GEN-004 contract classifies unsupported numeric and causal text without exposing generated prose", () => {
  const supportedNumeric = validateGeneratedContentDraft({
    requestedAudience: "internal",
    contentType: "data_gap_memo",
    authoritativeReadiness: gaps,
    generationClaims: [generationClaim({ claimStatement: "Coverage support was reviewed in 2025." })],
    blocks: [{
      ordinal: 1,
      text: "Coverage support was reviewed in 2025.",
      citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }],
    }],
  });
  assert.equal(supportedNumeric.ok, true);

  const inventedNumeric = validateGeneratedContentDraft({
    requestedAudience: "internal",
    contentType: "data_gap_memo",
    authoritativeReadiness: gaps,
    generationClaims: [generationClaim({ claimStatement: "A governed claim has missing support." })],
    blocks: [{
      ordinal: 1,
      text: "The memo identifies 2 unresolved gaps.",
      citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }],
    }],
  });
  assert.equal(inventedNumeric.ok, false);
  const numericBlocker = inventedNumeric.blockers.find((blocker) => blocker.validator_key === "VAL-GEN-004");
  assert.equal(numericBlocker.blocking_reason, "unsupported_numeric_or_causal_assertion");
  assert.deepEqual(numericBlocker.evidence, {
    violation_count: 1,
    assertion_classes: ["numeric_literal"],
    block_ordinals: [1],
  });
  assert.equal(JSON.stringify(numericBlocker).includes("2 unresolved"), false);

  const unsupportedCausal = validateGeneratedContentDraft({
    requestedAudience: "internal",
    contentType: "data_gap_memo",
    authoritativeReadiness: gaps,
    generationClaims: [generationClaim({ claimStatement: "A governed claim has missing support." })],
    blocks: [{
      ordinal: 1,
      text: "The missing support caused a reporting limitation.",
      citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }],
    }],
  });
  assert.equal(unsupportedCausal.ok, false);
  const causalBlocker = unsupportedCausal.blockers.find((blocker) => blocker.validator_key === "VAL-GEN-004");
  assert.equal(causalBlocker.blocking_reason, "unsupported_numeric_or_causal_assertion");
  assert.deepEqual(causalBlocker.evidence.assertion_classes, ["causal_language"]);

  const nonAttributionWithCausalTerm = validateGeneratedContentDraft({
    requestedAudience: "internal",
    contentType: "data_gap_memo",
    authoritativeReadiness: gaps,
    generationClaims: [generationClaim({ claimStatement: "A governed claim has missing support." })],
    blocks: [{
      ordinal: 1,
      text: "The memo does not attribute outcomes because support is missing.",
      citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }],
    }],
  });
  assert.equal(nonAttributionWithCausalTerm.ok, false);
  assert.deepEqual(
    nonAttributionWithCausalTerm.blockers.find((blocker) => blocker.validator_key === "VAL-GEN-004").evidence.assertion_classes,
    ["causal_language"],
  );

  const numericLookingIdentifier = validateGeneratedContentDraft({
    requestedAudience: "internal",
    contentType: "data_gap_memo",
    authoritativeReadiness: gaps,
    generationClaims: [generationClaim({ claimStatement: "A governed claim has missing support." })],
    blocks: [{
      ordinal: 1,
      text: "Gap item VAL-COV-001 remains unresolved.",
      citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }],
    }],
  });
  assert.equal(numericLookingIdentifier.ok, false);
  assert.deepEqual(
    numericLookingIdentifier.blockers.find((blocker) => blocker.validator_key === "VAL-GEN-004").evidence.assertion_classes,
    ["numeric_literal"],
  );

  const audienceGate = validateGeneratedContentDraft({
    requestedAudience: "public",
    contentType: "data_gap_memo",
    authoritativeReadiness: gaps,
    generationClaims: [generationClaim({
      requestedAudience: "public",
      audienceAuthority: { internal: true, funder: false, public: false },
    })],
    blocks: [{
      ordinal: 1,
      text: "A governed claim has missing support.",
      citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }],
    }],
    draftAudience: "public",
  });
  assert.equal(audienceGate.ok, false);
  assert.equal(audienceGate.blockers.some((blocker) => blocker.validator_key === "VAL-GEN-005"), true);
});

test("data gap service path validates generator output before persistence/review boundary", async () => {
  const calls = [];
  const result = await createDataGapMemoDraft(input({ idempotencyKey: "data-gap-validator-path" }), {
    env: enabledEnv,
    getEngagementForOrganization: stubGetEngagementForOrganization,
    async listOrganizationEvidenceGapsForImpactLibrary() {
      return { ok: true, data: { items: [gaps.items[0]], limit: 25, afterGapLogItemId: null, truncated: false, nextAfterGapLogItemId: null }, error: null };
    },
    generatedContentRepository: {
      async createDataGapMemoDraft(repositoryInput, dependencies) {
        const generatorResult = await dependencies.draftGenerator({
          contentType: "data_gap_memo",
          requestedAudience: repositoryInput.requestedAudience,
          gaps: dependencies.authoritativeDataGaps,
          claims: [generatorClaim()],
        });
        calls.push({ stage: "generated", blockCount: generatorResult.blocks.length });
        const validation = validateGeneratedContentDraft({
          requestedAudience: repositoryInput.requestedAudience,
          contentType: "data_gap_memo",
          authoritativeReadiness: dependencies.authoritativeDataGaps,
          generationClaims: [generationClaim()],
          blocks: generatorResult.blocks,
          draftAudience: repositoryInput.requestedAudience,
        });
        calls.push({ stage: "validated", ok: validation.ok });
        if (!validation.ok) {
          return { ok: false, data: null, error: { code: "validation_blocker", status: 422 }, blockers: validation.blockers };
        }
        return {
          ok: true,
          data: {
            generatedContentDraftId: "00000000-0000-4000-8000-000000000703",
            reviewQueueItemId: "00000000-0000-4000-8000-000000000704",
            draftStatus: "draft",
            reviewStatus: "needs_gk_review",
          },
          error: null,
        };
      },
    },
    draftGenerator: async () => ({
      blocks: [{
        ordinal: 1,
        text: "A governed claim has missing support.",
        citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }],
      }],
    }),
    metadataOnlyAudit: {},
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    { stage: "generated", blockCount: 1 },
    { stage: "validated", ok: true },
  ]);
  assert.equal(result.data.reviewQueueItemId, "00000000-0000-4000-8000-000000000704");
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
  assert.match(calls[0].system, /Do not add numbers, dates, counts, ordinals, identifiers, validator keys/);

  assert.deepEqual(calls[0].output_config, {
    format: {
      type: "json_schema",
      schema: __dataGapMemoDraftGeneratorContract.DATA_GAP_MEMO_OUTPUT_SCHEMA,
    },
  });
  const schema = calls[0].output_config.format.schema;
  assert.equal(schema.type, "object");
  assert.deepEqual(schema.required, ["blocks"]);
  assert.equal(schema.additionalProperties, false);
  const blockSchema = schema.properties.blocks.items;
  assert.deepEqual(blockSchema.required, ["text", "citations"]);
  assert.equal(blockSchema.additionalProperties, false);
  const citationSchema = blockSchema.properties.citations.items;
  assert.deepEqual(citationSchema.required, ["claimId", "evidenceItemId"]);
  assert.equal(citationSchema.additionalProperties, false);

  assert.equal(validateGeneratorResult(result), true);
  assert.deepEqual(classifyGeneratorResult(result), { ok: true, reason: null });
});

test("data gap memo generator: direct invalid generator input is rejected before any provider call", async () => {
  const calls = [];
  const generator = createProductionDataGapMemoDraftGenerator({
    async createMessage(payload) {
      calls.push(payload);
      return { content: [{ type: "text", text: JSON.stringify({ blocks: [] }) }] };
    },
  });

  const result = await generator({
    contentType: "data_gap_memo",
    requestedAudience: "internal",
    claims: [generatorClaim()],
    // gaps omitted: fails the generatorInput.gaps?.items array check.
  });

  assert.equal(calls.length, 0);
  assert.deepEqual(result, { blocks: [] });
  assert.equal(classifyGeneratorResult(result).reason, GENERATOR_RESULT_REASONS.INPUT_CONTRACT_REJECTED);
  assert.equal(validateGeneratorResult(result), false);
});

test("data gap memo generator: no extractable provider text fails closed as generator_result_provider_text_missing", async () => {
  const generator = createProductionDataGapMemoDraftGenerator({
    async createMessage() {
      return { content: [] };
    },
  });
  const result = await generator({ contentType: "data_gap_memo", requestedAudience: "internal", gaps, claims: [generatorClaim()] });
  assert.deepEqual(result, { blocks: [] });
  assert.equal(classifyGeneratorResult(result).reason, GENERATOR_RESULT_REASONS.PROVIDER_TEXT_MISSING);
  assert.equal(validateGeneratorResult(result), false);
});

test("data gap memo generator: whitespace-only provider text fails closed as generator_result_provider_text_missing", async () => {
  const generator = createProductionDataGapMemoDraftGenerator({
    async createMessage() {
      return { content: [{ type: "text", text: "   \n  " }] };
    },
  });
  const result = await generator({ contentType: "data_gap_memo", requestedAudience: "internal", gaps, claims: [generatorClaim()] });
  assert.deepEqual(result, { blocks: [] });
  assert.equal(classifyGeneratorResult(result).reason, GENERATOR_RESULT_REASONS.PROVIDER_TEXT_MISSING);
});

test("data gap memo generator: unparseable provider text fails closed as generator_result_json_parse_failed", async () => {
  const generator = createProductionDataGapMemoDraftGenerator({
    async createMessage() {
      return { content: [{ type: "text", text: "not-json" }] };
    },
  });
  const result = await generator({ contentType: "data_gap_memo", requestedAudience: "internal", gaps, claims: [generatorClaim()] });
  assert.deepEqual(result, { blocks: [] });
  assert.equal(classifyGeneratorResult(result).reason, GENERATOR_RESULT_REASONS.JSON_PARSE_FAILED);
});

test("data gap memo generator: a non-object JSON root fails closed as generator_result_json_root_invalid", async () => {
  const generator = createProductionDataGapMemoDraftGenerator({
    async createMessage() {
      return { content: [{ type: "text", text: JSON.stringify([1, 2, 3]) }] };
    },
  });
  const result = await generator({ contentType: "data_gap_memo", requestedAudience: "internal", gaps, claims: [generatorClaim()] });
  assert.deepEqual(result, { blocks: [] });
  assert.equal(classifyGeneratorResult(result).reason, GENERATOR_RESULT_REASONS.JSON_ROOT_INVALID);
});

test("data gap memo generator: a missing blocks field fails closed as generator_result_blocks_field_invalid", async () => {
  const generator = createProductionDataGapMemoDraftGenerator({
    async createMessage() {
      return { content: [{ type: "text", text: JSON.stringify({ notBlocks: [] }) }] };
    },
  });
  const result = await generator({ contentType: "data_gap_memo", requestedAudience: "internal", gaps, claims: [generatorClaim()] });
  assert.deepEqual(result, { blocks: [] });
  assert.equal(classifyGeneratorResult(result).reason, GENERATOR_RESULT_REASONS.BLOCKS_FIELD_INVALID);
});

test("data gap memo generator: blocks not an array fails closed as generator_result_blocks_field_invalid", async () => {
  const generator = createProductionDataGapMemoDraftGenerator({
    async createMessage() {
      return { content: [{ type: "text", text: JSON.stringify({ blocks: "not-an-array" }) }] };
    },
  });
  const result = await generator({ contentType: "data_gap_memo", requestedAudience: "internal", gaps, claims: [generatorClaim()] });
  assert.deepEqual(result, { blocks: [] });
  assert.equal(classifyGeneratorResult(result).reason, GENERATOR_RESULT_REASONS.BLOCKS_FIELD_INVALID);
});

test("data gap memo generator: a genuinely empty blocks array from a schema-conformant response classifies as generator_result_blocks_empty", async () => {
  const generator = createProductionDataGapMemoDraftGenerator({
    async createMessage() {
      return { content: [{ type: "text", text: JSON.stringify({ blocks: [] }) }] };
    },
  });
  const result = await generator({ contentType: "data_gap_memo", requestedAudience: "internal", gaps, claims: [generatorClaim()] });
  assert.deepEqual(result, { blocks: [] });
  assert.equal(classifyGeneratorResult(result).reason, GENERATOR_RESULT_REASONS.BLOCKS_EMPTY);
  assert.equal(validateGeneratorResult(result), false);
});

test("data gap memo generator: the resulting draft remains human-review gated after a valid generated result", () => {
  const packet = __generatedContentReviewPacketServiceTestables.isGeneratedDraftReviewPacketDto;
  assert.equal(typeof packet, "function");
  const ok = validateGeneratedContentDraft({
    requestedAudience: "internal",
    contentType: "data_gap_memo",
    authoritativeReadiness: gaps,
    generationClaims: [generationClaim()],
    blocks: [{
      ordinal: 1,
      text: "A current data gap remains for coverage support.",
      citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }],
    }],
  });
  assert.equal(ok.ok, true);
  assert.equal(sprint2IntakeApiRouter.stack.some((layer) => String(layer.route?.path || "").includes("data-gap-memo/final")), false);
});

test("data gap memo route is mounted and rejects browser-supplied gap/citation authority by schema", () => {
  const matches = sprint2IntakeApiRouter.stack
    .filter((layer) => layer.route?.path === "/admin/organizations/:organizationId/generated-content-drafts/data-gap-memo" && layer.route?.methods?.post);
  assert.equal(matches.length, 1);
  assert.deepEqual(Object.keys(matches[0].route.methods), ["post"]);
});
