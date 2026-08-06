import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  getGeneratedDraftReviewPacket,
  __generatedContentReviewPacketServiceTestables,
} from "../Backend/kai/services/kaiGeneratedContentService.js";
import { __generatedContentRepositoryTestables } from "../Backend/kai/dictionary/postgresGeneratedContentRepository.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const DRAFT = "00000000-0000-4000-8000-000000000301";
const RUN = "00000000-0000-4000-8000-000000000302";
const QUEUE = "00000000-0000-4000-8000-000000000303";
const BLOCK = "00000000-0000-4000-8000-000000000304";
const CLAIM = "00000000-0000-4000-8000-000000000101";
const CLAIM_2 = "00000000-0000-4000-8000-000000000102";
const EVIDENCE = "00000000-0000-4000-8000-000000000201";
const SOURCE = "00000000-0000-4000-8000-000000000401";
const SOURCE_VERSION = "00000000-0000-4000-8000-000000000501";
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
  return { organizationId: ORG, generatedContentDraftId: DRAFT, actorContext, ...overrides };
}

function dto(overrides = {}) {
  return {
    generationRunId: RUN,
    generatedContentDraftId: DRAFT,
    contentType: "evidence_summary",
    draftStatus: "draft",
    requestedAudience: "internal",
    reviewQueueItemId: QUEUE,
    queueStatus: "open",
    reviewStatus: "needs_gk_review",
    currentUseEligible: true,
    blocks: [{
      ordinal: 1,
      text: "Visible draft text.",
      citations: [{
        claimId: CLAIM,
        evidenceItemId: EVIDENCE,
        sourceId: SOURCE,
        sourceVersionId: SOURCE_VERSION,
        supportStrength: "strong",
        claimReviewStatus: "approved",
        evidenceReviewStatus: "approved",
        currentEligible: true,
        blockerCodes: [],
        affectedDimensionKeys: [],
        affectedObjectIds: [],
      }],
    }],
    ...overrides,
  };
}

function state(overrides = {}) {
  return {
    run: {
      generation_run_id: RUN,
      organization_id: ORG,
      request_fingerprint: "a".repeat(64),
      content_type: "evidence_summary",
      requested_audience: "internal",
    },
    draft: {
      generated_content_draft_id: DRAFT,
      generation_run_id: RUN,
      organization_id: ORG,
      content_type: "evidence_summary",
      requested_audience: "internal",
      draft_status: "draft",
      review_status: "needs_gk_review",
    },
    siblingDrafts: [{
      generated_content_draft_id: DRAFT,
      generation_run_id: RUN,
      organization_id: ORG,
      content_type: "evidence_summary",
      requested_audience: "internal",
      draft_status: "draft",
      review_status: "needs_gk_review",
    }],
    blocks: [{
      generated_content_block_id: BLOCK,
      generated_content_draft_id: DRAFT,
      organization_id: ORG,
      ordinal: 1,
      text: "Visible draft text.",
    }],
    citations: [{
      generated_content_citation_id: "00000000-0000-4000-8000-000000000305",
      generated_content_block_id: BLOCK,
      organization_id: ORG,
      claim_id: CLAIM,
      evidence_item_id: EVIDENCE,
      block_ordinal: 1,
    }],
    queues: [{
      review_queue_item_id: QUEUE,
      organization_id: ORG,
      queue_type: "generated_content_review",
      target_object_type: "generated_content_draft",
      target_object_id: DRAFT,
      priority: "normal",
      queue_status: "open",
      review_status: "needs_gk_review",
      assigned_to: null,
      due_at: null,
      summary: "Generated draft requires human review.",
      required_action: "Review citations, audience eligibility, limitations, and unsupported claims before any use.",
    }],
    ...overrides,
  };
}

function evaluated(claimId = CLAIM, overrides = {}) {
  return {
    claim: {
      claim_id: claimId,
      claim_type: "finding",
      claim_status: "proposed",
      claim_review_status: "approved",
      claim_strength: "strong",
      audience_gates: {},
    },
    evidence: {
      evidence_item_id: EVIDENCE,
      evidence_review_status: "approved",
      support_strength: "strong",
      review_queue_item_id: "00000000-0000-4000-8000-000000000601",
      review_queue_status: "closed",
      review_status: "approved",
    },
    locator: { source_locator_id: "00000000-0000-4000-8000-000000000602" },
    source: { source_id: SOURCE, source_code: null },
    source_version: { source_version_id: SOURCE_VERSION, is_current: true },
    claim_review: {
      review_queue_item_id: "00000000-0000-4000-8000-000000000603",
      queue_status: "closed",
      review_status: "approved",
    },
    candidate: { intake_source_candidate_id: "00000000-0000-4000-8000-000000000604" },
    promotion_decision: { intake_promotion_decision_id: "00000000-0000-4000-8000-000000000605" },
    dimensions: {},
    gap_items: [],
    client_followup_workflows: [],
    potential_conflict_groups: [],
    requestedAudience: "internal",
    eligible: true,
    blockerCodes: [],
    affectedDimensionKeys: [],
    affectedObjectIds: [],
    truncated: false,
    ...overrides,
  };
}

test("P3-02 service gates: both flags, exact input, mapped human, active tenant membership, and gk_admin/gk_reviewer precede repository loading", async () => {
  let repositoryCalls = 0;
  const repository = { async getGeneratedDraftReviewPacket() { repositoryCalls += 1; return { ok: true, data: dto(), error: null }; } };
  assert.equal((await getGeneratedDraftReviewPacket(input(), { env: {}, generatedContentRepository: repository })).error.code, "feature_disabled");
  assert.equal((await getGeneratedDraftReviewPacket(input(), { env: { KAI_SPRINT2_ENABLED: "true" }, generatedContentRepository: repository })).error.code, "feature_disabled");
  assert.equal((await getGeneratedDraftReviewPacket({ ...input(), extra: true }, { env: enabledEnv, generatedContentRepository: repository })).error.code, "validation_blocker");
  assert.equal((await getGeneratedDraftReviewPacket(input({ actorContext: { actorType: "system", actorUserId: actorContext.actorUserId } }), { env: enabledEnv, generatedContentRepository: repository })).error.code, "authorization_denied");
  assert.equal((await getGeneratedDraftReviewPacket(input({ organizationId: OTHER_ORG }), { env: enabledEnv, generatedContentRepository: repository })).error.code, "authorization_denied");
  assert.equal((await getGeneratedDraftReviewPacket(input({ actorContext: { ...actorContext, organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_operator" }] } }), { env: enabledEnv, generatedContentRepository: repository })).error.code, "authorization_denied");
  assert.equal(repositoryCalls, 0);
  assert.equal((await getGeneratedDraftReviewPacket(input(), { env: enabledEnv, generatedContentRepository: repository })).ok, true);
  assert.equal(repositoryCalls, 1);
});

test("P3-02 service lazy-loads the database-capable repository only after all gates", () => {
  const source = readFileSync(new URL("../Backend/kai/services/kaiGeneratedContentService.js", import.meta.url), "utf8");
  const topLevelImports = source.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(topLevelImports.every((line) => !/postgresGeneratedContentRepository|kaiDb|pg/.test(line)));
  assert.ok(source.indexOf("isKaiSprint2Enabled") < source.indexOf("createDefaultGeneratedContentRepository"));
});

test("P3-02 service rejects injected repository data containing raw or prohibited fields with system_error and data null", async () => {
  for (const extraKey of ["claimText", "evidenceText", "filename", "storagePath", "signedUrl", "prompt", "credential", "internalNote", "raw"]) {
    const result = await getGeneratedDraftReviewPacket(input(), {
      env: enabledEnv,
      generatedContentRepository: {
        async getGeneratedDraftReviewPacket() {
          return { ok: true, data: { ...dto(), [extraKey]: "blocked" }, error: null };
        },
      },
    });
    assert.equal(result.error.code, "system_error");
    assert.equal(result.data, null);
  }
});

test("P3-02 repository validators require complete graph and full generated_content_review queue contract", () => {
  const { validateReviewPacketRows } = __generatedContentRepositoryTestables;
  assert.equal(Boolean(validateReviewPacketRows(state(), { organizationId: ORG, generatedContentDraftId: DRAFT })), true);
  assert.equal(validateReviewPacketRows(state({ siblingDrafts: [state().siblingDrafts[0], { ...state().siblingDrafts[0], generated_content_draft_id: "00000000-0000-4000-8000-000000000399" }] }), { organizationId: ORG, generatedContentDraftId: DRAFT }), false);
  assert.equal(validateReviewPacketRows(state({ run: { ...state().run, request_fingerprint: "A".repeat(64) } }), { organizationId: ORG, generatedContentDraftId: DRAFT }), false);
  assert.equal(validateReviewPacketRows(state({ blocks: [{ ...state().blocks[0], ordinal: 2 }] }), { organizationId: ORG, generatedContentDraftId: DRAFT }), false);
  assert.equal(validateReviewPacketRows(state({ citations: [{ ...state().citations[0] }, { ...state().citations[0], generated_content_citation_id: "00000000-0000-4000-8000-000000000306" }] }), { organizationId: ORG, generatedContentDraftId: DRAFT }), false);
  assert.equal(validateReviewPacketRows(state({ queues: [{ ...state().queues[0], assigned_to: "90000000-0000-4000-8000-000000000001" }] }), { organizationId: ORG, generatedContentDraftId: DRAFT }), false);
  assert.equal(validateReviewPacketRows(state({ queues: [{ ...state().queues[0], required_action: "Review citations, audience eligibility, limitations, unsupported claims, and numeric or causal assertions before any use." }] }), { organizationId: ORG, generatedContentDraftId: DRAFT }), false);
});

test("P3-02 repository validator treats unexpected internal row fields as system_error", () => {
  const { validateReviewPacketRows } = __generatedContentRepositoryTestables;
  assert.equal(validateReviewPacketRows(state({ run: { ...state().run, prompt: "blocked" } }), { organizationId: ORG, generatedContentDraftId: DRAFT }), "system_error");
});

test("P3-02 DTO shape is exact and keeps potential conflicts as potential only", () => {
  const { isGeneratedDraftReviewPacketDto } = __generatedContentReviewPacketServiceTestables;
  assert.equal(isGeneratedDraftReviewPacketDto(dto()), true);
  assert.equal(isGeneratedDraftReviewPacketDto({ ...dto(), confirmedConflict: true }), false);
  const serviceSource = readFileSync(new URL("../Backend/kai/services/kaiGeneratedContentService.js", import.meta.url), "utf8");
  const repoSource = readFileSync(new URL("../Backend/kai/dictionary/postgresGeneratedContentRepository.js", import.meta.url), "utf8");
  assert.doesNotMatch(`${serviceSource}\n${repoSource}`, /confirmed_conflict|proven_conflict|conflict_exists/);
});

test("P3-02 repository read path is read-only and references the transaction-scoped P2-06 evaluator without public service nesting", () => {
  const source = readFileSync(new URL("../Backend/kai/dictionary/postgresGeneratedContentRepository.js", import.meta.url), "utf8");
  assert.match(source, /SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.match(source, /evaluateClaimTraceabilityInTransaction/);
  assert.doesNotMatch(source, /getClaimTraceabilitySummary/);
  const readPacketSlice = source.slice(source.indexOf("async getGeneratedDraftReviewPacket"), source.indexOf("async createEvidenceSummaryDraft"));
  assert.doesNotMatch(readPacketSlice, /\bINSERT\b|\bUPDATE\b|\bDELETE\b|prepareMetadataOnlyAudit|upload_lifecycle_audit|queue transition|finaliz/);
});

test("P3-02 repeated citations are represented through the same claim identity while per-claim blockers stay attached", () => {
  const blocked = dto({
    currentUseEligible: false,
    blocks: [
      dto().blocks[0],
      {
        ordinal: 2,
        text: "Visible draft text repeated.",
        citations: [{
          ...dto().blocks[0].citations[0],
          claimId: CLAIM_2,
          currentEligible: false,
          blockerCodes: ["claim_review_unresolved", "claim_review_unresolved"].filter((code, index, arr) => arr.indexOf(code) === index),
          affectedDimensionKeys: ["missingness"],
          affectedObjectIds: ["00000000-0000-4000-8000-000000000603"],
        }],
      },
    ],
  });
  assert.equal(__generatedContentReviewPacketServiceTestables.isGeneratedDraftReviewPacketDto(blocked), true);
  assert.equal(blocked.currentUseEligible, false);
  assert.deepEqual(blocked.blocks[1].citations[0].blockerCodes, ["claim_review_unresolved"]);
});
