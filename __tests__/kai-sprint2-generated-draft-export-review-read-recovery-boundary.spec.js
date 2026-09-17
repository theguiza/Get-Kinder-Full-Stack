import test from "node:test";
import assert from "node:assert/strict";

import {
  getGeneratedDraftReviewPacket,
  __generatedContentReviewPacketServiceTestables,
} from "../Backend/kai/services/kaiGeneratedContentService.js";
import { __generatedContentRepositoryTestables } from "../Backend/kai/dictionary/postgresGeneratedContentRepository.js";
import {
  projectGeneratedDraftPacket,
  generatedDraftExportReviewDisplayState,
  EXPORT_REVIEW_DISPLAY_STATES,
} from "../frontend/impactEvidenceLibraryLogic.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const DRAFT = "00000000-0000-4000-8000-000000000901";
const RUN = "00000000-0000-4000-8000-000000000902";
const QUEUE = "00000000-0000-4000-8000-000000000903";
const EXPORT_QUEUE = "00000000-0000-4000-8000-000000000904";
const BLOCK = "00000000-0000-4000-8000-000000000905";
const CLAIM = "00000000-0000-4000-8000-000000000101";
const EVIDENCE = "00000000-0000-4000-8000-000000000201";
const SOURCE = "00000000-0000-4000-8000-000000000401";
const SOURCE_VERSION = "00000000-0000-4000-8000-000000000501";
const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" });

function actorWithRole(roleName) {
  return {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000001",
    source: "public.userdata",
    organizationMemberships: [
      { organization_id: ORG, membership_status: "active", role_name: roleName },
    ],
  };
}

function input(actorContext) {
  return { organizationId: ORG, generatedContentDraftId: DRAFT, actorContext };
}

function repoDto(overrides = {}) {
  return {
    generationRunId: RUN,
    generatedContentDraftId: DRAFT,
    contentType: "evidence_summary",
    draftStatus: "draft",
    requestedAudience: "internal",
    reviewQueueItemId: QUEUE,
    queueStatus: "resolved",
    reviewStatus: "resolved",
    reviewUpdatedAt: "2026-08-06T09:00:00.000Z",
    currentUseEligible: true,
    exportReviewQueueItemId: EXPORT_QUEUE,
    exportReviewQueueStatus: "open",
    exportReviewStatus: "needs_gk_review",
    blocks: [{
      ordinal: 1,
      text: "Visible draft text.",
      citations: [{
        claimId: CLAIM,
        evidenceItemId: EVIDENCE,
        sourceId: SOURCE,
        sourceCode: "src-401",
        sourceVersionId: SOURCE_VERSION,
        supportStrength: "strong",
        claimReviewStatus: "approved",
        evidenceReviewStatus: "approved",
        currentEligible: true,
        blockerCodes: [],
        affectedDimensionKeys: [],
        affectedObjectIds: [],
        approvedAudiences: ["internal"],
      }],
    }],
    ...overrides,
  };
}

test("gk_admin recovers an already-existing export review's identity/state on a fresh read, no POST replay required", async () => {
  const repository = { async getGeneratedDraftReviewPacket() { return { ok: true, data: repoDto(), error: null }; } };
  const result = await getGeneratedDraftReviewPacket(input(actorWithRole("gk_admin")), {
    env: enabledEnv,
    generatedContentRepository: repository,
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.exportReviewVisible, true);
  assert.equal(result.data.exportReviewQueueItemId, EXPORT_QUEUE);
  assert.equal(result.data.exportReviewQueueStatus, "open");
  assert.equal(result.data.exportReviewStatus, "needs_gk_review");
});

test("gk_admin recovers a genuine zero-review state (no export review requested yet) as null, not restricted", async () => {
  const repository = {
    async getGeneratedDraftReviewPacket() {
      return {
        ok: true,
        data: repoDto({ exportReviewQueueItemId: null, exportReviewQueueStatus: null, exportReviewStatus: null }),
        error: null,
      };
    },
  };
  const result = await getGeneratedDraftReviewPacket(input(actorWithRole("gk_admin")), {
    env: enabledEnv,
    generatedContentRepository: repository,
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.exportReviewVisible, true);
  assert.equal(result.data.exportReviewQueueItemId, null);
});

test("gk_reviewer never receives export-review identity/state even when the repository row exists - forced null, distinct restricted signal", async () => {
  const repository = { async getGeneratedDraftReviewPacket() { return { ok: true, data: repoDto(), error: null }; } };
  const result = await getGeneratedDraftReviewPacket(input(actorWithRole("gk_reviewer")), {
    env: enabledEnv,
    generatedContentRepository: repository,
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.exportReviewVisible, false);
  assert.equal(result.data.exportReviewQueueItemId, null);
  assert.equal(result.data.exportReviewQueueStatus, null);
  assert.equal(result.data.exportReviewStatus, null);
});

test("service rejects a repository result that fabricates export-review state while claiming exportReviewVisible: false", async () => {
  const { isGeneratedDraftReviewPacketWithExportReviewVisibilityDto } = __generatedContentReviewPacketServiceTestables;
  assert.equal(
    isGeneratedDraftReviewPacketWithExportReviewVisibilityDto({
      ...repoDto(),
      exportReviewVisible: false,
    }),
    false,
  );
  assert.equal(
    isGeneratedDraftReviewPacketWithExportReviewVisibilityDto({
      ...repoDto(),
      exportReviewVisible: true,
    }),
    true,
  );
});

test("repository validator accepts 0 or exactly 1 export_review queue row and rejects more than 1 as system_error - the same cardinality the unique index guarantees", () => {
  const { validateExportReviewQueueRows } = __generatedContentRepositoryTestables;
  const baseState = { exportReviewQueues: [] };
  assert.equal(validateExportReviewQueueRows(baseState, { organizationId: ORG, generatedContentDraftId: DRAFT }), true);

  const row = {
    review_queue_item_id: EXPORT_QUEUE,
    organization_id: ORG,
    queue_type: "export_review",
    target_object_type: "generated_content_draft",
    target_object_id: DRAFT,
    priority: "medium",
    queue_status: "open",
    review_status: "needs_gk_review",
    blocked_reason: null,
    assigned_to: null,
    due_at: null,
    summary: "Generated draft requires export review.",
    required_action: "Review audience authority, current eligibility, citations, and the final export gate before any export.",
    queue_metadata: {},
    created_by: null,
    created_by_type: "system",
  };
  assert.equal(validateExportReviewQueueRows({ exportReviewQueues: [row] }, { organizationId: ORG, generatedContentDraftId: DRAFT }), true);
  assert.equal(
    validateExportReviewQueueRows({ exportReviewQueues: [row, { ...row }] }, { organizationId: ORG, generatedContentDraftId: DRAFT }),
    "system_error",
  );
  assert.equal(
    validateExportReviewQueueRows({ exportReviewQueues: [{ ...row, unexpected_field: "blocked" }] }, { organizationId: ORG, generatedContentDraftId: DRAFT }),
    "system_error",
  );
});

test("frontend display-state classification never conflates restricted, existing, requestable, and not-requestable", () => {
  assert.equal(generatedDraftExportReviewDisplayState(null), EXPORT_REVIEW_DISPLAY_STATES.restricted);
  assert.equal(
    generatedDraftExportReviewDisplayState({ exportReviewVisible: false, exportReviewQueueItemId: null, queueStatus: "resolved", reviewStatus: "resolved" }),
    EXPORT_REVIEW_DISPLAY_STATES.restricted,
  );
  assert.equal(
    generatedDraftExportReviewDisplayState({ exportReviewVisible: true, exportReviewQueueItemId: EXPORT_QUEUE, queueStatus: "resolved", reviewStatus: "resolved" }),
    EXPORT_REVIEW_DISPLAY_STATES.existing,
  );
  assert.equal(
    generatedDraftExportReviewDisplayState({ exportReviewVisible: true, exportReviewQueueItemId: null, queueStatus: "resolved", reviewStatus: "resolved" }),
    EXPORT_REVIEW_DISPLAY_STATES.requestable,
  );
  assert.equal(
    generatedDraftExportReviewDisplayState({ exportReviewVisible: true, exportReviewQueueItemId: null, queueStatus: "open", reviewStatus: "needs_gk_review" }),
    EXPORT_REVIEW_DISPLAY_STATES.notRequestable,
  );
});

test("projectGeneratedDraftPacket defaults export-review fields safely for a malformed/absent DTO", () => {
  assert.equal(projectGeneratedDraftPacket(null), null);
  const projected = projectGeneratedDraftPacket({ generatedContentDraftId: DRAFT, blocks: [] });
  assert.equal(projected.exportReviewVisible, false);
  assert.equal(projected.exportReviewQueueItemId, null);
  assert.equal(projected.exportReviewQueueStatus, null);
  assert.equal(projected.exportReviewStatus, null);
});
