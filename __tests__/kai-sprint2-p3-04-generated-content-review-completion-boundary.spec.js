import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  completeGeneratedContentReview,
  startGeneratedContentReview,
} from "../Backend/kai/services/kaiGeneratedContentService.js";
import {
  createPostgresGeneratedContentRepository,
  __generatedContentRepositoryTestables,
  __generatedContentRepositoryContract,
} from "../Backend/kai/dictionary/postgresGeneratedContentRepository.js";
import {
  GENERATED_CONTENT_REVIEW_LIFECYCLE_PROFILES,
  GENERATED_CONTENT_REVIEW_QUEUE_STATIC_CONTRACT,
} from "../Backend/kai/dictionary/generatedContentReviewQueueContract.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const RUN = "00000000-0000-4000-8000-000000000501";
const DRAFT = "00000000-0000-4000-8000-000000000502";
const BLOCK = "00000000-0000-4000-8000-000000000503";
const CITATION = "00000000-0000-4000-8000-000000000504";
const CLAIM = "00000000-0000-4000-8000-000000000505";
const EVIDENCE = "00000000-0000-4000-8000-000000000506";
const SOURCE = "00000000-0000-4000-8000-000000000507";
const SOURCE_VERSION = "00000000-0000-4000-8000-000000000508";
const QUEUE = "00000000-0000-4000-8000-000000000509";
const OTHER_QUEUE = "00000000-0000-4000-8000-000000000519";

const NOW = "2026-08-06T10:00:00.000Z";
const LATER = "2026-08-06T10:05:00.000Z";
const FRESH_UPDATED_AT = "2026-08-06T09:00:00.000Z";

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
    generatedContentDraftId: DRAFT,
    reviewQueueItemId: QUEUE,
    expectedUpdatedAt: FRESH_UPDATED_AT,
    actorContext,
    now: NOW,
    ...overrides,
  };
}

function makeFixtureState({ queueStatus = "in_progress", reviewStatus = "needs_gk_review", updatedAt = FRESH_UPDATED_AT } = {}) {
  return {
    draft: {
      generated_content_draft_id: DRAFT,
      generation_run_id: RUN,
      organization_id: ORG,
      content_type: "evidence_summary",
      requested_audience: "internal",
      draft_status: "draft",
      review_status: "needs_gk_review",
    },
    run: {
      generation_run_id: RUN,
      organization_id: ORG,
      request_fingerprint: "c".repeat(64),
      content_type: "evidence_summary",
      requested_audience: "internal",
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
      text: "Enrollment increased by 12% in 2025.",
    }],
    citations: [{
      generated_content_citation_id: CITATION,
      generated_content_block_id: BLOCK,
      organization_id: ORG,
      claim_id: CLAIM,
      evidence_item_id: EVIDENCE,
      block_ordinal: 1,
    }],
    queues: [{
      review_queue_item_id: QUEUE,
      organization_id: ORG,
      queue_type: GENERATED_CONTENT_REVIEW_QUEUE_STATIC_CONTRACT.queueType,
      target_object_type: GENERATED_CONTENT_REVIEW_QUEUE_STATIC_CONTRACT.targetObjectType,
      target_object_id: DRAFT,
      priority: GENERATED_CONTENT_REVIEW_QUEUE_STATIC_CONTRACT.priority,
      queue_status: queueStatus,
      review_status: reviewStatus,
      assigned_to: null,
      due_at: null,
      summary: GENERATED_CONTENT_REVIEW_QUEUE_STATIC_CONTRACT.summary,
      required_action: GENERATED_CONTENT_REVIEW_QUEUE_STATIC_CONTRACT.requiredAction,
      updated_at: updatedAt,
    }],
    auditRows: [],
    auditFileContext: { intake_file_id: "00000000-0000-4000-8000-000000000601", upload_state: "confirmed" },
  };
}

function fakeEvaluator() {
  return async (tx, evalInput) => ({
    ok: true,
    data: {
      claim: {
        claim_id: evalInput.claimId,
        claim_type: "finding",
        claim_status: "approved",
        claim_review_status: "approved",
        claim_strength: "unassessed",
        audience_gates: {},
      },
      evidence: {
        evidence_item_id: EVIDENCE,
        evidence_review_status: "approved",
        support_strength: "unassessed",
        review_queue_item_id: "10000000-0000-4000-8000-000000000021",
        review_queue_status: "resolved",
        review_status: "approved",
      },
      locator: { source_locator_id: "10000000-0000-4000-8000-000000000022" },
      source: { source_id: SOURCE, source_code: null },
      source_version: { source_version_id: SOURCE_VERSION, is_current: true },
      claim_review: { review_queue_item_id: "10000000-0000-4000-8000-000000000025", queue_status: "resolved", review_status: "approved" },
      candidate: { intake_source_candidate_id: "90000000-0000-4000-8000-000000000003" },
      promotion_decision: { intake_promotion_decision_id: "10000000-0000-4000-8000-000000000026" },
      dimensions: {},
      gap_items: [],
      client_followup_workflows: [],
      potential_conflict_groups: [],
      requestedAudience: evalInput.requestedAudience,
      eligible: true,
      blockerCodes: [],
      affectedDimensionKeys: [],
      affectedObjectIds: [],
      truncated: false,
    },
    error: null,
  });
}

function makeFakeTx(state) {
  const stats = { updates: 0, audits: 0 };
  const tx = {
    stats,
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, " ").trim();

      if (s.includes("intake_file_id::text AS intake_file_id")) {
        return { rows: [{ intake_file_id: state.auditFileContext.intake_file_id, upload_state: state.auditFileContext.upload_state }] };
      }
      if (s.includes("FROM kai.generated_content_drafts") && s.includes("FOR UPDATE")) {
        const [organizationId, draftId] = params;
        const match = state.draft && state.draft.organization_id === organizationId && state.draft.generated_content_draft_id === draftId;
        return { rows: match ? [{ generated_content_draft_id: draftId }] : [] };
      }
      if (s.includes("FROM kai.generated_content_drafts") && s.includes("ORDER BY generated_content_draft_id ASC")) {
        const [runId] = params;
        return { rows: state.siblingDrafts.filter((d) => d.generation_run_id === runId) };
      }
      if (s.includes("FROM kai.generated_content_drafts")) {
        const [organizationId, draftId] = params;
        const match = state.draft && state.draft.organization_id === organizationId && state.draft.generated_content_draft_id === draftId;
        return { rows: match ? [state.draft] : [] };
      }
      if (s.includes("FROM kai.generation_runs")) {
        const [runId] = params;
        return { rows: state.run && state.run.generation_run_id === runId ? [state.run] : [] };
      }
      if (s.includes("FROM kai.generated_content_blocks")) {
        const [draftId] = params;
        return { rows: state.blocks.filter((b) => b.generated_content_draft_id === draftId) };
      }
      if (s.includes("FROM kai.generated_content_citations")) {
        const [blockIds] = params;
        return { rows: state.citations.filter((c) => blockIds.includes(c.generated_content_block_id)) };
      }
      if (s.includes("FROM kai.review_queue_items") && s.includes("target_object_type = $2")) {
        const [organizationId, targetType, targetId] = params;
        return {
          rows: state.queues
            .filter((q) => q.organization_id === organizationId && q.target_object_type === targetType && q.target_object_id === targetId)
            .map((projected) => projected),
        };
      }
      if (s.startsWith("UPDATE kai.review_queue_items")) {
        const isStartTransition = params.length === 9;
        const newQueueStatus = params[0];
        const newReviewStatus = isStartTransition ? state.queues[0]?.review_status : params[1];
        const now = isStartTransition ? params[1] : params[2];
        const organizationId = isStartTransition ? params[2] : params[3];
        const reviewQueueItemId = isStartTransition ? params[3] : params[4];
        const targetType = isStartTransition ? params[4] : params[5];
        const targetId = isStartTransition ? params[5] : params[6];
        const expectedQueueStatus = isStartTransition ? params[6] : params[7];
        const expectedReviewStatus = isStartTransition ? params[7] : params[8];
        const expectedUpdatedAt = isStartTransition ? params[8] : params[9];
        const row = state.queues.find((q) => q.review_queue_item_id === reviewQueueItemId);
        const matches = row
          && row.organization_id === organizationId
          && row.target_object_type === targetType
          && row.target_object_id === targetId
          && row.queue_status === expectedQueueStatus
          && row.review_status === expectedReviewStatus
          && row.updated_at === expectedUpdatedAt;
        if (!matches) return { rowCount: 0, rows: [] };
        row.queue_status = newQueueStatus;
        row.review_status = newReviewStatus;
        row.updated_at = now;
        stats.updates += 1;
        return { rowCount: 1, rows: [{ review_queue_item_id: reviewQueueItemId }] };
      }
      if (s.includes("FROM kai.review_queue_items")) {
        const [reviewQueueItemId] = params;
        return { rows: state.queues.filter((q) => q.review_queue_item_id === reviewQueueItemId) };
      }
      if (s.startsWith("INSERT INTO kai.upload_lifecycle_audit")) {
        const [organizationId, , operation, , metadataJson] = params;
        const metadata = JSON.parse(metadataJson);
        state.auditRows.push({ organization_id: organizationId, operation, outcome: "success", metadata });
        stats.audits += 1;
        return { rows: [] };
      }
      if (s.includes("FROM kai.upload_lifecycle_audit")) {
        const [organizationId, operation, draftId, queueId] = params;
        return {
          rows: state.auditRows
            .filter((a) => a.organization_id === organizationId
              && a.operation === operation
              && a.outcome === "success"
              && a.metadata.generated_content_draft_id === draftId
              && a.metadata.review_queue_item_id === queueId)
            .map((a) => ({ metadata: a.metadata })),
        };
      }
      throw new Error(`unhandled fake query: ${s}`);
    },
  };
  return tx;
}

function makeRepository(state, overrides = {}) {
  return createPostgresGeneratedContentRepository({
    runInTransaction: async (callback) => callback(makeFakeTx(state)),
    evaluator: fakeEvaluator(),
    ...overrides,
  });
}

function auditRecorder() {
  return { prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } };
}

// --- service gates ---

test("P3-04 service requires KAI_SPRINT2_ENABLED then KAI_GENERATION_ENABLED before any database-capable module loads", async () => {
  let repositoryCalls = 0;
  const repository = { async completeGeneratedContentReview() { repositoryCalls += 1; throw new Error("must not call"); } };
  const deps = { generatedContentRepository: repository, metadataOnlyAudit: auditRecorder() };
  assert.equal((await completeGeneratedContentReview(input(), { ...deps, env: {} })).error.code, "feature_disabled");
  assert.equal((await completeGeneratedContentReview(input(), { ...deps, env: { KAI_SPRINT2_ENABLED: "true" } })).error.code, "feature_disabled");
  assert.equal(repositoryCalls, 0);
});

test("P3-04 service gates: exact input, mapped human, active tenant membership, and gk_reviewer/gk_admin authorization precede any repository call", async () => {
  let repositoryCalls = 0;
  const repository = {
    async completeGeneratedContentReview() {
      repositoryCalls += 1;
      return { ok: true, data: { replayed: false }, error: null };
    },
  };
  const deps = { generatedContentRepository: repository, metadataOnlyAudit: auditRecorder(), env: enabledEnv };
  assert.equal((await completeGeneratedContentReview({ ...input(), extra: true }, deps)).error.code, "validation_blocker");
  assert.equal((await completeGeneratedContentReview(input({ expectedUpdatedAt: "not-a-date" }), deps)).error.code, "validation_blocker");
  assert.equal((await completeGeneratedContentReview(input({ now: "2026-08-06 10:00:00" }), deps)).error.code, "validation_blocker");
  assert.equal((await completeGeneratedContentReview(input({ actorContext: { actorType: "system", actorUserId: actorContext.actorUserId } }), deps)).error.code, "authorization_denied");
  assert.equal((await completeGeneratedContentReview(input({ organizationId: OTHER_ORG }), deps)).error.code, "authorization_denied");
  assert.equal(
    (await completeGeneratedContentReview(input({
      actorContext: { ...actorContext, organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_operator" }] },
    }), deps)).error.code,
    "authorization_denied",
  );
  assert.equal(repositoryCalls, 0);
  const ok = await completeGeneratedContentReview(input(), deps);
  assert.equal(ok.ok, true);
  assert.equal(repositoryCalls, 1);
});

test("P3-04 service lazy-loads the database-capable repository only after all gates, per its own source", () => {
  const source = readFileSync(new URL("../Backend/kai/services/kaiGeneratedContentService.js", import.meta.url), "utf8");
  const topLevelImports = source.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(topLevelImports.every((line) => !/postgresGeneratedContentRepository|kaiDb\.js|"pg"/.test(line)));
  assert.match(source, /await import\(\s*"\.\.\/dictionary\/postgresGeneratedContentRepository\.js"/);
});

test("P3-04 accepts either gk_reviewer or gk_admin", async () => {
  const repository = { async completeGeneratedContentReview() { return { ok: true, data: {}, error: null }; } };
  const deps = { generatedContentRepository: repository, metadataOnlyAudit: auditRecorder(), env: enabledEnv };
  for (const role of ["gk_reviewer", "gk_admin"]) {
    const result = await completeGeneratedContentReview(input({
      actorContext: { ...actorContext, organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: role }] },
    }), deps);
    assert.equal(result.ok, true);
  }
});

// --- input contract ---

test("P3-04 repository input validator rejects unknown/missing keys and non-canonical timestamps", () => {
  const { validateCompleteReviewInput } = __generatedContentRepositoryTestables;
  assert.equal(validateCompleteReviewInput(input()), true);
  assert.equal(validateCompleteReviewInput({ ...input(), extra: true }), false);
  const { organizationId, ...missingOrg } = input();
  assert.equal(validateCompleteReviewInput(missingOrg), false);
  assert.equal(validateCompleteReviewInput(input({ expectedUpdatedAt: "2026-08-06T10:00:00Z" })), false);
  assert.equal(validateCompleteReviewInput(input({ now: 12345 })), false);
  assert.equal(validateCompleteReviewInput(input({ organizationId: "not-a-uuid" })), false);
  assert.equal(validateCompleteReviewInput(input({ actorContext: [] })), false);
});

// --- lifecycle matrix contract ---

test("P3-04 lifecycle profile constants match the specification exactly", () => {
  assert.deepEqual(GENERATED_CONTENT_REVIEW_LIFECYCLE_PROFILES.map((p) => `${p.queueStatus}/${p.reviewStatus}`), [
    "open/needs_gk_review",
    "in_progress/needs_gk_review",
    "resolved/resolved",
  ]);
  assert.deepEqual(__generatedContentRepositoryContract.COMPLETE_REVIEW_FRESH_PROFILE, { queueStatus: "in_progress", reviewStatus: "needs_gk_review" });
  assert.deepEqual(__generatedContentRepositoryContract.COMPLETE_REVIEW_RESOLVED_PROFILE, { queueStatus: "resolved", reviewStatus: "resolved" });
  assert.deepEqual(__generatedContentRepositoryContract.START_REVIEW_FRESH_PROFILE, { queueStatus: "open", reviewStatus: "needs_gk_review" });
  assert.deepEqual(__generatedContentRepositoryContract.START_REVIEW_IN_PROGRESS_PROFILE, { queueStatus: "in_progress", reviewStatus: "needs_gk_review" });
});

// --- repository behavior against a fake authoritative transaction ---

test("Stage-B generated-content review start moves open/needs_gk_review to in_progress/needs_gk_review with one audit and no draft mutation", async () => {
  const state = makeFixtureState({ queueStatus: "open", reviewStatus: "needs_gk_review" });
  const before = JSON.stringify({ draft: state.draft, blocks: state.blocks, citations: state.citations });
  const repository = makeRepository(state);
  const result = await repository.startGeneratedContentReview(input(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.ok, true);
  assert.equal(result.data.queueStatus, "in_progress");
  assert.equal(result.data.reviewStatus, "needs_gk_review");
  assert.equal(state.queues[0].queue_status, "in_progress");
  assert.equal(state.queues[0].review_status, "needs_gk_review");
  assert.equal(state.auditRows.length, 1);
  assert.equal(JSON.stringify({ draft: state.draft, blocks: state.blocks, citations: state.citations }), before);
});

test("Stage-B generated-content review start rejects stale, cross-tenant, and wrong-state attempts without mutation", async () => {
  for (const state of [
    makeFixtureState({ queueStatus: "open", reviewStatus: "needs_gk_review", updatedAt: LATER }),
    (() => {
      const s = makeFixtureState({ queueStatus: "open", reviewStatus: "needs_gk_review" });
      s.queues[0].organization_id = OTHER_ORG;
      return s;
    })(),
    makeFixtureState({ queueStatus: "resolved", reviewStatus: "resolved" }),
  ]) {
    const before = JSON.stringify(state.queues);
    const result = await makeRepository(state).startGeneratedContentReview(input(), { metadataOnlyAudit: auditRecorder() });
    assert.equal(result.error.code, "conflict_current_state_changed");
    assert.equal(JSON.stringify(state.queues), before);
    assert.equal(state.auditRows.length, 0);
  }
});

test("Stage-B generated-content review start service gates match completion role and tenant authority", async () => {
  let repositoryCalls = 0;
  const repository = {
    async startGeneratedContentReview() {
      repositoryCalls += 1;
      return { ok: true, data: { queueStatus: "in_progress", reviewStatus: "needs_gk_review" }, error: null };
    },
  };
  const deps = { generatedContentRepository: repository, metadataOnlyAudit: auditRecorder(), env: enabledEnv };
  assert.equal((await startGeneratedContentReview(input({ actorContext: { actorType: "system", actorUserId: actorContext.actorUserId } }), deps)).error.code, "authorization_denied");
  assert.equal((await startGeneratedContentReview(input({ organizationId: OTHER_ORG }), deps)).error.code, "authorization_denied");
  assert.equal((await startGeneratedContentReview(input({
    actorContext: {
      ...actorContext,
      organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "client_reviewer" }],
    },
  }), deps)).error.code, "authorization_denied");
  assert.equal(repositoryCalls, 0);
  const ok = await startGeneratedContentReview(input(), deps);
  assert.equal(ok.ok, true);
  assert.equal(repositoryCalls, 1);
});

test("P3-04 fresh completion from the exact precondition writes one queue transition and one audit", async () => {
  const state = makeFixtureState({ queueStatus: "in_progress", reviewStatus: "needs_gk_review" });
  const repository = makeRepository(state);
  const result = await repository.completeGeneratedContentReview(input(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.ok, true);
  assert.equal(result.data.replayed, false);
  assert.equal(result.data.queueStatus, "resolved");
  assert.equal(result.data.reviewStatus, "resolved");
  assert.equal(state.queues[0].queue_status, "resolved");
  assert.equal(state.queues[0].review_status, "resolved");
  assert.equal(state.auditRows.length, 1);
});

test("P3-04 identical completed replay with matching audit returns replayed:true with zero writes and zero audit", async () => {
  const state = makeFixtureState({ queueStatus: "in_progress", reviewStatus: "needs_gk_review" });
  const repository = makeRepository(state);
  const first = await repository.completeGeneratedContentReview(input(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(first.ok, true);
  assert.equal(state.auditRows.length, 1);

  const second = await repository.completeGeneratedContentReview(input(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(second.ok, true);
  assert.equal(second.data.replayed, true);
  assert.equal(state.auditRows.length, 1);
});

test("P3-04 rejects every queue_status/review_status combination other than the three profiles with conflict_current_state_changed and zero mutation", async () => {
  for (const [queueStatus, reviewStatus] of [["open", "needs_gk_review"], ["closed", "approved"], ["resolved", "needs_gk_review"], ["in_progress", "resolved"]]) {
    const state = makeFixtureState({ queueStatus, reviewStatus });
    const repository = makeRepository(state);
    const result = await repository.completeGeneratedContentReview(input(), { metadataOnlyAudit: auditRecorder() });
    assert.equal(result.error.code, "conflict_current_state_changed");
    assert.equal(state.auditRows.length, 0);
  }
});

test("P3-04 a resolved row without a matching completion audit conflicts rather than replaying", async () => {
  const state = makeFixtureState({ queueStatus: "resolved", reviewStatus: "resolved" });
  const repository = makeRepository(state);
  const result = await repository.completeGeneratedContentReview(input(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.error.code, "conflict_current_state_changed");
});

test("P3-04 a resolved row with an audit whose actor or timestamps differ still conflicts", async () => {
  const state = makeFixtureState({ queueStatus: "resolved", reviewStatus: "resolved" });
  state.auditRows.push({
    organization_id: ORG,
    operation: __generatedContentRepositoryContract.COMPLETE_REVIEW_AUDIT_OPERATION,
    outcome: "success",
    metadata: {
      contract: __generatedContentRepositoryContract.COMPLETE_REVIEW_AUDIT_CONTRACT,
      organization_id: ORG,
      generation_run_id: RUN,
      generated_content_draft_id: DRAFT,
      review_queue_item_id: QUEUE,
      actor_id: "differing-actor",
      actor_type: "human",
      expected_updated_at: FRESH_UPDATED_AT,
      requested_completion_timestamp: NOW,
      previous_queue_status: "in_progress",
      resulting_queue_status: "resolved",
      previous_review_status: "needs_gk_review",
      resulting_review_status: "resolved",
      validator_keys: ["VAL-REV-001"],
    },
  });
  const repository = makeRepository(state);
  const result = await repository.completeGeneratedContentReview(input(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.error.code, "conflict_current_state_changed");
});

test("P3-04 stale expectedUpdatedAt against an in-progress row conflicts without mutation or audit", async () => {
  const state = makeFixtureState({ queueStatus: "in_progress", reviewStatus: "needs_gk_review", updatedAt: LATER });
  const repository = makeRepository(state);
  const result = await repository.completeGeneratedContentReview(input({ expectedUpdatedAt: FRESH_UPDATED_AT }), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.error.code, "conflict_current_state_changed");
  assert.equal(state.auditRows.length, 0);
  assert.equal(state.queues[0].queue_status, "in_progress");
});

test("P3-04 a missing tenant-scoped draft returns not_found", async () => {
  const state = makeFixtureState();
  const repository = makeRepository(state);
  const result = await repository.completeGeneratedContentReview(input({ generatedContentDraftId: "00000000-0000-4000-8000-000000000999" }), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.error.code, "not_found");
});

test("P3-04 a missing review queue item returns not_found", async () => {
  const state = makeFixtureState();
  const repository = makeRepository(state);
  const result = await repository.completeGeneratedContentReview(input({ reviewQueueItemId: "00000000-0000-4000-8000-000000000998" }), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.error.code, "not_found");
});

test("P3-04 a cross-tenant queue item (same id, different organization) conflicts rather than succeeding", async () => {
  const state = makeFixtureState();
  state.queues[0].organization_id = OTHER_ORG;
  const repository = makeRepository(state);
  const result = await repository.completeGeneratedContentReview(input(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.error.code, "conflict_current_state_changed");
});

test("P3-04 a queue item pointed at a different draft conflicts", async () => {
  const state = makeFixtureState();
  state.queues.push({
    ...state.queues[0],
    review_queue_item_id: OTHER_QUEUE,
    target_object_id: "00000000-0000-4000-8000-000000000777",
  });
  const repository = makeRepository(state);
  const result = await repository.completeGeneratedContentReview(input({ reviewQueueItemId: OTHER_QUEUE }), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.error.code, "conflict_current_state_changed");
});

test("P3-04 requires an injected metadataOnlyAudit dependency before attempting any transaction", async () => {
  const state = makeFixtureState();
  const repository = makeRepository(state);
  const result = await repository.completeGeneratedContentReview(input(), {});
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(state.auditRows.length, 0);
  assert.equal(state.queues[0].queue_status, "in_progress");
});

test("P3-04 semantics: the draft remains draft, and draft_status/requested_audience/blocks/citations are untouched by completion", async () => {
  const state = makeFixtureState({ queueStatus: "in_progress", reviewStatus: "needs_gk_review" });
  const before = JSON.stringify({ draft: state.draft, blocks: state.blocks, citations: state.citations });
  const repository = makeRepository(state);
  const result = await repository.completeGeneratedContentReview(input(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.ok, true);
  assert.equal(state.draft.draft_status, "draft");
  assert.equal(JSON.stringify({ draft: state.draft, blocks: state.blocks, citations: state.citations }), before);
});

test("P3-04 audit metadata excludes draft/claim/evidence text and contains only the specified identifiers, timestamps, and lifecycle statuses", async () => {
  const state = makeFixtureState({ queueStatus: "in_progress", reviewStatus: "needs_gk_review" });
  const repository = makeRepository(state);
  await repository.completeGeneratedContentReview(input(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(state.auditRows.length, 1);
  const metadata = state.auditRows[0].metadata;
  assert.deepEqual(new Set(Object.keys(metadata)), new Set([
    "contract",
    "organization_id",
    "generation_run_id",
    "generated_content_draft_id",
    "review_queue_item_id",
    "actor_id",
    "actor_type",
    "expected_updated_at",
    "requested_completion_timestamp",
    "previous_queue_status",
    "resulting_queue_status",
    "previous_review_status",
    "resulting_review_status",
    "validator_keys",
  ]));
  assert.equal(metadata.organization_id, ORG);
  assert.equal(metadata.generation_run_id, RUN);
  assert.equal(metadata.generated_content_draft_id, DRAFT);
  assert.equal(metadata.review_queue_item_id, QUEUE);
  assert.equal(metadata.actor_id, actorContext.actorUserId);
  assert.equal(metadata.actor_type, "human");
  assert.equal(metadata.expected_updated_at, FRESH_UPDATED_AT);
  assert.equal(metadata.requested_completion_timestamp, NOW);
  assert.equal(metadata.previous_queue_status, "in_progress");
  assert.equal(metadata.resulting_queue_status, "resolved");
  assert.equal(metadata.previous_review_status, "needs_gk_review");
  assert.equal(metadata.resulting_review_status, "resolved");
});
