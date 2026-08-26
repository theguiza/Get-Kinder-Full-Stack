import test from "node:test";
import assert from "node:assert/strict";

import { createImpactNarrativeDraft } from "../Backend/kai/services/kaiGeneratedContentService.js";
import { __generatedContentReviewPacketServiceTestables } from "../Backend/kai/services/kaiGeneratedContentService.js";
import {
  __generatedContentRepositoryTestables,
  fingerprintEvidenceSummaryRequest,
  fingerprintImpactNarrativeRequest,
} from "../Backend/kai/dictionary/postgresGeneratedContentRepository.js";
import {
  __impactNarrativeDraftGeneratorContract,
  createProductionImpactNarrativeDraftGenerator,
} from "../Backend/kai/services/kaiImpactNarrativeDraftGenerator.js";
import { createProductionMetadataOnlyAuditForGeneratedContentDraft } from "../Backend/kai/services/kaiMetadataOnlyAuditComposition.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const CLAIM = "00000000-0000-4000-8000-000000000101";
const EVIDENCE = "00000000-0000-4000-8000-000000000201";
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

function input(overrides = {}) {
  return {
    organizationId: ORG,
    requestedAudience: "internal",
    claimIds: [CLAIM],
    idempotencyKey: "p13-01-key",
    actorContext,
    now: NOW,
    ...overrides,
  };
}

test("P13-01 metadata-only audit identity keeps P3-01 evidence-summary route by default and gives impact-narrative its server-owned distinct route", async () => {
  const generatedContentDraftId = "00000000-0000-4000-8000-000000000501";
  const captured = [];
  const base = {
    organizationId: ORG,
    actorContext,
    now: NOW,
    insertAuditEvent: async (metadata) => {
      captured.push(metadata);
      return { ok: true };
    },
  };

  const evidenceSummaryAudit = createProductionMetadataOnlyAuditForGeneratedContentDraft(base);
  const evidencePrepared = evidenceSummaryAudit.prepareMetadataOnlyAudit({
    payload: {
      generated_content_draft_id: generatedContentDraftId,
      attempted_operation: "generated_content_draft_created",
      validator_key: "VAL-GEN-001",
      route: "client_must_not_control_route",
      content: "client text must not enter metadata",
      prompt: "client prompt must not enter metadata",
    },
  });
  assert.equal(evidencePrepared.ok, true);
  await evidencePrepared.publish();

  const impactNarrativeAudit = createProductionMetadataOnlyAuditForGeneratedContentDraft({
    ...base,
    route: "p13_01_create_impact_narrative_draft",
  });
  const impactPrepared = impactNarrativeAudit.prepareMetadataOnlyAudit({
    payload: {
      generated_content_draft_id: generatedContentDraftId,
      attempted_operation: "generated_content_draft_created",
      validator_key: "VAL-GEN-001",
      route: "client_must_not_control_route",
      audit_route: "client_must_not_control_route",
      raw_content: "client text must not enter metadata",
      signed_url: "client url must not enter metadata",
    },
  });
  assert.equal(impactPrepared.ok, true);
  await impactPrepared.publish();

  assert.equal(captured.length, 2);
  assert.equal(captured[0].route, "p3_01_create_evidence_summary_draft");
  assert.equal(captured[1].route, "p13_01_create_impact_narrative_draft");
  for (const metadata of captured) {
    assert.equal(metadata.operation, "generated_content_draft_created");
    assert.equal(metadata.operation_type, "generated_content_draft_created");
    assert.equal(metadata.object_type, "generated_content_draft");
    assert.equal(metadata.target_object_type, "generated_content_draft");
    assert.equal(metadata.metadata_only, true);
    assert.equal(metadata.contains_raw_file_content, false);
    assert.equal(metadata.contains_raw_parsed_rows, false);
    assert.equal(metadata.contains_client_pii, false);
    assert.equal(metadata.contains_prompt_text, false);
    assert.equal(metadata.contains_unsafe_generated_text, false);
    assert.equal(metadata.contains_signed_urls, false);
    assert.equal(metadata.contains_storage_credentials, false);
    assert.deepEqual(Object.keys(metadata).sort(), [
      "actor_type",
      "actor_user_id",
      "contains_client_pii",
      "contains_prompt_text",
      "contains_raw_file_content",
      "contains_raw_parsed_rows",
      "contains_signed_urls",
      "contains_storage_credentials",
      "contains_unsafe_generated_text",
      "created_at",
      "metadata_only",
      "object_id",
      "object_type",
      "operation",
      "operation_type",
      "organization_id",
      "request_id",
      "route",
      "target_object_type",
      "validator_key",
    ].sort());
    assert.equal(JSON.stringify(metadata).includes("client_must_not_control_route"), false);
    assert.equal(JSON.stringify(metadata).includes("client text"), false);
    assert.equal(JSON.stringify(metadata).includes("client prompt"), false);
    assert.equal(JSON.stringify(metadata).includes("client url"), false);
  }
});

test("P13-01 service gates: disabled, generation-disabled, malformed, non-internal audience, and wrong-tenant calls do not call repository or generator", async () => {
  let repositoryCalls = 0;
  let generatorCalls = 0;
  const repository = {
    async createImpactNarrativeDraft() {
      repositoryCalls += 1;
      throw new Error("must not call");
    },
  };
  const deps = {
    generatedContentRepository: repository,
    draftGenerator() {
      generatorCalls += 1;
      throw new Error("must not call");
    },
    metadataOnlyAudit: {},
  };
  assert.equal((await createImpactNarrativeDraft(input(), { ...deps, env: {} })).error.code, "feature_disabled");
  assert.equal((await createImpactNarrativeDraft(input(), { ...deps, env: { KAI_SPRINT2_ENABLED: "true" } })).error.code, "feature_disabled");
  assert.equal((await createImpactNarrativeDraft({ ...input(), extra: true }, { ...deps, env: enabledEnv })).error.code, "validation_blocker");
  // This package authorizes only impact_narrative/internal -- a caller-supplied
  // funder/public audience must be rejected, not silently coerced to internal.
  assert.equal((await createImpactNarrativeDraft(input({ requestedAudience: "funder" }), { ...deps, env: enabledEnv })).error.code, "validation_blocker");
  assert.equal((await createImpactNarrativeDraft(input({ requestedAudience: "public" }), { ...deps, env: enabledEnv })).error.code, "validation_blocker");
  assert.equal((await createImpactNarrativeDraft(input({ actorContext: { actorType: "system", actorUserId: actorContext.actorUserId } }), { ...deps, env: enabledEnv })).error.code, "authorization_denied");
  assert.equal((await createImpactNarrativeDraft(input({ organizationId: OTHER_ORG }), { ...deps, env: enabledEnv })).error.code, "authorization_denied");
  assert.equal(repositoryCalls, 0);
  assert.equal(generatorCalls, 0);
});

test("P13-01 contentType participates in the request fingerprint: evidence_summary and impact_narrative never share an identity for the same org/audience/claims/idempotency key", () => {
  const evidenceSummaryFingerprint = fingerprintEvidenceSummaryRequest({
    requestedAudience: "internal",
    claimIds: [CLAIM],
  });
  const impactNarrativeFingerprint = fingerprintImpactNarrativeRequest({
    requestedAudience: "internal",
    claimIds: [CLAIM],
  });
  assert.notEqual(evidenceSummaryFingerprint, impactNarrativeFingerprint);

  // Deterministic: identical content type/audience/claims always hash the same.
  assert.equal(
    fingerprintImpactNarrativeRequest({ requestedAudience: "internal", claimIds: [CLAIM] }),
    impactNarrativeFingerprint,
  );
});

test("P13-01 repository generator-input contract allows exactly evidence_summary and impact_narrative, and rejects any other content type", () => {
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
  assert.equal(validateGeneratorInput({ contentType: "impact_narrative", requestedAudience: "internal", claims: [baseClaim] }), true);
  assert.equal(validateGeneratorInput({ contentType: "evidence_summary", requestedAudience: "internal", claims: [baseClaim] }), true);
  assert.equal(validateGeneratorInput({ contentType: "grant_response_paragraph", requestedAudience: "internal", claims: [baseClaim] }), false);
});

test("P13-01 review-packet DTO contract accepts impact_narrative alongside evidence_summary", () => {
  const { isGeneratedDraftReviewPacketDto } = __generatedContentReviewPacketServiceTestables;
  const basePacket = {
    generationRunId: "00000000-0000-4000-8000-000000000501",
    generatedContentDraftId: "00000000-0000-4000-8000-000000000502",
    contentType: "impact_narrative",
    draftStatus: "draft",
    requestedAudience: "internal",
    reviewQueueItemId: "00000000-0000-4000-8000-000000000503",
    queueStatus: "open",
    reviewStatus: "needs_gk_review",
    reviewUpdatedAt: NOW,
    currentUseEligible: true,
    blocks: [{
      ordinal: 1,
      text: "Narrative text.",
      citations: [{
        claimId: CLAIM,
        evidenceItemId: EVIDENCE,
        sourceId: "00000000-0000-4000-8000-000000000301",
        sourceVersionId: "00000000-0000-4000-8000-000000000401",
        supportStrength: "unassessed",
        claimReviewStatus: "needs_gk_review",
        evidenceReviewStatus: "needs_gk_review",
        currentEligible: true,
        blockerCodes: [],
        affectedDimensionKeys: [],
        affectedObjectIds: [],
      }],
    }],
  };
  assert.equal(isGeneratedDraftReviewPacketDto(basePacket), true);
  assert.equal(isGeneratedDraftReviewPacketDto({ ...basePacket, contentType: "evidence_summary" }), true);
  assert.equal(isGeneratedDraftReviewPacketDto({ ...basePacket, contentType: "grant_response_paragraph" }), false);
});

test("P13-01 production impact-narrative draft-generator adapter sends only the governed projection and normalizes provider JSON into the draftGenerator contract", async () => {
  const calls = [];
  const generator = createProductionImpactNarrativeDraftGenerator({
    async createMessage(payload) {
      calls.push(payload);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            blocks: [{
              text: "Enrollment increased over the reporting period.",
              citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE, ignored: "drop" }],
              ignored: "drop",
            }],
          }),
        }],
      };
    },
  });

  const result = await generator({
    contentType: "impact_narrative",
    requestedAudience: "internal",
    claims: [{
      claimId: CLAIM,
      claimStatement: "Enrollment increased over the reporting period.",
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
      text: "Enrollment increased over the reporting period.",
      citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }],
    }],
  });
  assert.equal(__generatedContentRepositoryTestables.validateGeneratorResult(result), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, __impactNarrativeDraftGeneratorContract.MODEL);
  assert.equal(calls[0].tools, undefined);
  assert.equal(JSON.stringify(calls[0]).includes("prompt"), false);
  assert.equal(JSON.stringify(calls[0]).includes("signed_url"), false);
  assert.equal(JSON.stringify(calls[0]).includes("raw_content"), false);
});
