import test from "node:test";
import assert from "node:assert/strict";

import sprint2IntakeApiRouter from "../Backend/kai/routes/sprint2IntakeApi.js";
import {
  createReadinessAssessmentDraft,
  __generatedContentReviewPacketServiceTestables,
} from "../Backend/kai/services/kaiGeneratedContentService.js";
import { validateGeneratedContentDraft } from "../Backend/kai/validators/kaiGeneratedContentValidators.js";
import {
  __generatedContentRepositoryContract,
  __generatedContentRepositoryTestables,
  fingerprintImpactNarrativeRequest,
  fingerprintReadinessAssessmentRequest,
} from "../Backend/kai/dictionary/postgresGeneratedContentRepository.js";
import {
  __readinessAssessmentDraftGeneratorContract,
  createProductionReadinessAssessmentDraftGenerator,
} from "../Backend/kai/services/kaiReadinessAssessmentDraftGenerator.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const ENGAGEMENT = "00000000-0000-4000-8000-000000000601";
const CLAIM = "00000000-0000-4000-8000-000000000101";
const EVIDENCE = "00000000-0000-4000-8000-000000000201";
const SOURCE = "00000000-0000-4000-8000-000000000301";
const SOURCE_VERSION = "00000000-0000-4000-8000-000000000401";
const NOW = "2026-09-13T12:00:00.000Z";
const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" });
const actorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  organizationMemberships: [
    { organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" },
  ],
});

const readiness = Object.freeze({
  requirements: [{
    requirement_id: "00000000-0000-4000-8000-000000000501",
    requirement_key: "ir_data_003",
    requirement_label: "Claims are traceable to evidence",
    assessed: true,
    assessment: {
      assessment_state: "partially_satisfied",
      assessment_explanation: "Some governed claims have no traceable evidence link.",
    },
  }],
});

function input(overrides = {}) {
  return {
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    requestedAudience: "internal",
    claimIds: [CLAIM],
    idempotencyKey: "readiness-assessment-key",
    actorContext,
    now: NOW,
    ...overrides,
  };
}

function baseClaim(overrides = {}) {
  return {
    claimId: CLAIM,
    claimStatement: "One governed claim is traceable to a source.",
    claimType: "finding",
    evidenceItemId: EVIDENCE,
    sourceId: SOURCE,
    sourceVersionId: SOURCE_VERSION,
    limitationCodes: [],
    requestedAudience: "internal",
    audienceAuthority: { internal: true, funder: false, public: false },
    revalidatedForGeneration: true,
    ...overrides,
  };
}

function generatorClaim(overrides = {}) {
  const { requestedAudience, audienceAuthority, revalidatedForGeneration, currentEligible, ...claim } = baseClaim(overrides);
  return claim;
}

async function stubGetEngagementForOrganization({ organizationId, engagementId }) {
  if (organizationId === ORG && engagementId === ENGAGEMENT) {
    return { engagement_id: ENGAGEMENT, organization_id: ORG };
  }
  return null;
}

test("readiness_assessment is accepted by the shared generation contract without changing Impact Narrative identity or packet membership", () => {
  const { validateGeneratorInput } = __generatedContentRepositoryTestables;
  assert.equal(__generatedContentRepositoryContract.ALLOWED_GENERATED_CONTENT_TYPES.has("readiness_assessment"), true);
  assert.equal(__generatedContentRepositoryContract.PACKET_MEMBER_CONTENT_TYPES.has("readiness_assessment"), false);
  assert.equal(validateGeneratorInput({
    contentType: "readiness_assessment",
    requestedAudience: "internal",
    readiness,
    claims: [generatorClaim()],
  }), true);
  assert.equal(validateGeneratorInput({
    contentType: "readiness_assessment",
    requestedAudience: "internal",
    claims: [generatorClaim()],
  }), false);
  assert.notEqual(
    fingerprintReadinessAssessmentRequest({ requestedAudience: "internal", claimIds: [CLAIM], engagementId: ENGAGEMENT }),
    fingerprintImpactNarrativeRequest({ requestedAudience: "internal", claimIds: [CLAIM], engagementId: ENGAGEMENT }),
  );
});

test("createReadinessAssessmentDraft consumes authoritative requirements-readiness state and delegates to generated-content persistence", async () => {
  const calls = [];
  const result = await createReadinessAssessmentDraft(input(), {
    env: enabledEnv,
    getEngagementForOrganization: stubGetEngagementForOrganization,
    async listOrganizationRequirementsReadiness(readinessInput) {
      calls.push({ type: "readiness", readinessInput });
      return { ok: true, data: readiness, error: null };
    },
    generatedContentRepository: {
      async createReadinessAssessmentDraft(repositoryInput, dependencies) {
        calls.push({ type: "repository", repositoryInput, authoritativeReadiness: dependencies.authoritativeReadiness });
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
  assert.deepEqual(calls.map((call) => call.type), ["readiness", "repository"]);
  assert.deepEqual(calls[0].readinessInput, { organizationId: ORG, actorContext });
  assert.deepEqual(calls[1].repositoryInput, input());
  assert.equal(calls[1].authoritativeReadiness, readiness);
});

test("readiness service gates prevent recalculation/persistence on bad audience, tenant, or unreadable readiness", async () => {
  let repositoryCalls = 0;
  const deps = {
    env: enabledEnv,
    getEngagementForOrganization: stubGetEngagementForOrganization,
    async listOrganizationRequirementsReadiness() {
      return { ok: false, data: null, error: { code: "authorization_denied", status: 403 } };
    },
    generatedContentRepository: {
      async createReadinessAssessmentDraft() {
        repositoryCalls += 1;
        throw new Error("must not persist");
      },
    },
    draftGenerator: async () => ({ blocks: [] }),
    metadataOnlyAudit: {},
  };

  assert.equal((await createReadinessAssessmentDraft(input({ requestedAudience: "funder" }), deps)).error.code, "validation_blocker");
  assert.equal((await createReadinessAssessmentDraft(input({ organizationId: OTHER_ORG }), deps)).error.code, "authorization_denied");
  assert.equal((await createReadinessAssessmentDraft(input(), deps)).error.code, "authorization_denied");
  assert.equal(repositoryCalls, 0);
});

test("readiness validator retains blockers/gaps and blocks unsupported positive readiness or causal assertions before persistence", () => {
  const blockedPositive = validateGeneratedContentDraft({
    requestedAudience: "internal",
    contentType: "readiness_assessment",
    authoritativeReadiness: readiness,
    generationClaims: [baseClaim({ limitationCodes: ["claim_review_missing"], currentEligible: false })],
    blocks: [{
      ordinal: 1,
      text: "The organization is fully ready and all requirements are met.",
      citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }],
    }],
  });
  assert.equal(blockedPositive.ok, false);
  assert.equal(
    blockedPositive.blockers.some((blocker) => blocker.blocking_reason === "readiness_gap_or_blocker_stated_as_positive_assertion"),
    true,
  );

  const gapDescription = validateGeneratedContentDraft({
    requestedAudience: "internal",
    contentType: "readiness_assessment",
    authoritativeReadiness: readiness,
    generationClaims: [baseClaim({ limitationCodes: ["claim_review_missing"], currentEligible: false })],
    blocks: [{
      ordinal: 1,
      text: "The readiness draft identifies a gap: some claims need review before a positive readiness assertion can be made.",
      citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }],
    }],
  });
  assert.equal(gapDescription.ok, true);

  const causal = validateGeneratedContentDraft({
    requestedAudience: "internal",
    contentType: "readiness_assessment",
    authoritativeReadiness: { requirements: [{ ...readiness.requirements[0], assessment: { assessment_state: "satisfied" }, assessed: true }] },
    generationClaims: [baseClaim({ claimStatement: "A claim is documented." })],
    blocks: [{
      ordinal: 1,
      text: "The documented claim improves readiness.",
      citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }],
    }],
  });
  assert.equal(causal.ok, false);
  assert.equal(causal.blockers.some((blocker) => blocker.blocking_reason === "unsupported_numeric_or_causal_assertion"), true);
});

test("readiness review-packet DTO uses existing generated-content citation/review shape and KAI cannot approve/finalize it", () => {
  const { isGeneratedDraftReviewPacketDto } = __generatedContentReviewPacketServiceTestables;
  assert.equal(isGeneratedDraftReviewPacketDto({
    generationRunId: "00000000-0000-4000-8000-000000000501",
    generatedContentDraftId: "00000000-0000-4000-8000-000000000502",
    contentType: "readiness_assessment",
    draftStatus: "draft",
    requestedAudience: "internal",
    reviewQueueItemId: "00000000-0000-4000-8000-000000000503",
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
        generatedContentCitationId: "00000000-0000-4000-8000-000000000504",
        claimId: CLAIM,
        evidenceItemId: EVIDENCE,
        sourceId: SOURCE,
        sourceVersionId: SOURCE_VERSION,
        supportStrength: "unassessed",
        claimReviewStatus: "needs_gk_review",
        evidenceReviewStatus: "needs_gk_review",
        currentEligible: false,
        blockerCodes: ["claim_review_missing"],
        affectedDimensionKeys: [],
        affectedObjectIds: [],
      }],
    }],
  }), true);
  assert.equal(sprint2IntakeApiRouter.stack.some((layer) => String(layer.route?.path || "").includes("readiness-assessment/final")), false);
});

test("production readiness generator sends only authoritative readiness state and governed claims", async () => {
  const calls = [];
  const generator = createProductionReadinessAssessmentDraftGenerator({
    async createMessage(payload) {
      calls.push(payload);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            blocks: [{
              text: "A readiness gap remains for claim traceability.",
              citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE, ignored: "drop" }],
            }],
          }),
        }],
      };
    },
  });

  const result = await generator({
    contentType: "readiness_assessment",
    requestedAudience: "internal",
    readiness,
    claims: [baseClaim()],
  });

  assert.deepEqual(result, {
    blocks: [{
      ordinal: 1,
      text: "A readiness gap remains for claim traceability.",
      citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }],
    }],
  });
  assert.equal(calls[0].model, __readinessAssessmentDraftGeneratorContract.MODEL);
  assert.equal(JSON.stringify(calls[0]).includes("readiness"), true);
  assert.equal(JSON.stringify(calls[0]).includes("raw_content"), false);
  assert.equal(JSON.stringify(calls[0]).includes("signed_url"), false);
});

test("readiness assessment route is mounted as an authenticated draft-generation POST", () => {
  const matches = sprint2IntakeApiRouter.stack
    .filter((layer) => layer.route?.path === "/admin/organizations/:organizationId/generated-content-drafts/readiness-assessment" && layer.route?.methods?.post);
  assert.equal(matches.length, 1);
  assert.deepEqual(Object.keys(matches[0].route.methods), ["post"]);
});
