import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  requestGeneratedDraftExportReview,
  __exportReviewServiceTestables,
} from "../Backend/kai/services/kaiExportReviewService.js";
import {
  createPostgresGeneratedContentRepository,
  __generatedContentRepositoryTestables,
  __generatedContentRepositoryContract,
} from "../Backend/kai/dictionary/postgresGeneratedContentRepository.js";
import { GENERATED_CONTENT_REVIEW_QUEUE_STATIC_CONTRACT } from "../Backend/kai/dictionary/generatedContentReviewQueueContract.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const RUN = "00000000-0000-4000-8000-000000000601";
const DRAFT = "00000000-0000-4000-8000-000000000602";
const BLOCK = "00000000-0000-4000-8000-000000000603";
const CITATION = "00000000-0000-4000-8000-000000000604";
const CLAIM = "00000000-0000-4000-8000-000000000605";
const EVIDENCE = "00000000-0000-4000-8000-000000000606";
const SOURCE = "00000000-0000-4000-8000-000000000607";
const SOURCE_VERSION = "00000000-0000-4000-8000-000000000608";
const GENERATED_CONTENT_QUEUE = "00000000-0000-4000-8000-000000000609";
const NOW = "2026-08-06T10:00:00.000Z";
const LATER = "2026-08-06T10:05:00.000Z";

const enabledEnv = Object.freeze({
  KAI_SPRINT2_ENABLED: "true",
  KAI_GENERATION_ENABLED: "true",
  KAI_PUBLIC_EXPORT_ENABLED: "true",
});
const actorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  source: "public.userdata",
  organizationMemberships: [
    { organization_id: ORG, membership_status: "active", role_name: "gk_admin" },
  ],
});

function input(overrides = {}) {
  return {
    organizationId: ORG,
    generatedContentDraftId: DRAFT,
    requestedExportAudience: "internal",
    actorContext,
    now: NOW,
    ...overrides,
  };
}

function makeFixtureState({ currentUseEligible = true } = {}) {
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
    genContentReviewQueues: [{
      review_queue_item_id: GENERATED_CONTENT_QUEUE,
      organization_id: ORG,
      queue_type: GENERATED_CONTENT_REVIEW_QUEUE_STATIC_CONTRACT.queueType,
      target_object_type: GENERATED_CONTENT_REVIEW_QUEUE_STATIC_CONTRACT.targetObjectType,
      target_object_id: DRAFT,
      priority: GENERATED_CONTENT_REVIEW_QUEUE_STATIC_CONTRACT.priority,
      queue_status: "resolved",
      review_status: "resolved",
      assigned_to: null,
      due_at: null,
      summary: GENERATED_CONTENT_REVIEW_QUEUE_STATIC_CONTRACT.summary,
      required_action: GENERATED_CONTENT_REVIEW_QUEUE_STATIC_CONTRACT.requiredAction,
    }],
    exportReviewQueues: [],
    auditRows: [],
    auditFileContext: { intake_file_id: "00000000-0000-4000-8000-000000000701", upload_state: "confirmed" },
    currentUseEligible,
    nextQueueItemId: 1,
  };
}

function fakeEvaluator(state) {
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
        updated_at: "2026-08-06T09:00:00.000Z",
        sensitivity_level: "unknown",
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
      eligible: state.currentUseEligible,
      blockerCodes: state.currentUseEligible ? [] : ["claim_review_unresolved"],
      affectedDimensionKeys: state.currentUseEligible ? [] : ["missingness"],
      affectedObjectIds: state.currentUseEligible ? [] : ["10000000-0000-4000-8000-000000000025"],
      truncated: false,
    },
    error: null,
  });
}

function makeFakeTx(state) {
  const stats = { inserts: 0, audits: 0 };
  const tx = {
    stats,
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, " ").trim();

      if (s.includes("intake_file_id::text AS intake_file_id") && s.includes("FROM kai.generated_content_blocks")) {
        return { rows: [{ intake_file_id: state.auditFileContext.intake_file_id, upload_state: state.auditFileContext.upload_state }] };
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
      if (s.startsWith("SELECT review_queue_item_id::text AS review_queue_item_id") && s.includes("target_object_type = $3") && s.includes("queue_metadata")) {
        const [organizationId, queueType, targetType, targetId] = params;
        return {
          rows: state.exportReviewQueues.filter((q) =>
            q.organization_id === organizationId
            && q.queue_type === queueType
            && q.target_object_type === targetType
            && q.target_object_id === targetId),
        };
      }
      if (s.includes("FROM kai.review_queue_items") && s.includes("target_object_type = $2") && s.includes("queue_type = $4")) {
        const [organizationId, targetType, targetId, queueType] = params;
        return {
          rows: state.genContentReviewQueues.filter((q) =>
            q.organization_id === organizationId && q.target_object_type === targetType
            && q.target_object_id === targetId && q.queue_type === queueType),
        };
      }
      if (s.startsWith("INSERT INTO kai.review_queue_items")) {
        const [organizationId, queueType, targetType, targetId, priority, queueStatus, reviewStatus, summary, requiredAction, now] = params;
        const conflict = state.exportReviewQueues.find((q) =>
          q.organization_id === organizationId && q.queue_type === queueType
          && q.target_object_type === targetType && q.target_object_id === targetId);
        if (conflict) return { rows: [] };
        const reviewQueueItemId = `00000000-0000-4000-8000-0000000009${String(state.nextQueueItemId++).padStart(2, "0")}`;
        state.exportReviewQueues.push({
          review_queue_item_id: reviewQueueItemId,
          organization_id: organizationId,
          queue_type: queueType,
          target_object_type: targetType,
          target_object_id: targetId,
          priority,
          queue_status: queueStatus,
          review_status: reviewStatus,
          blocked_reason: null,
          assigned_to: null,
          due_at: null,
          summary,
          required_action: requiredAction,
          queue_metadata: {},
          created_by: null,
          created_by_type: "system",
        });
        stats.inserts += 1;
        return { rows: [{ review_queue_item_id: reviewQueueItemId }] };
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
    evaluator: fakeEvaluator(state),
    ...overrides,
  });
}

function auditRecorder() {
  return { prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } };
}

// --- service gates ---

test("P3-05 service requires KAI_SPRINT2_ENABLED, then KAI_GENERATION_ENABLED, then KAI_PUBLIC_EXPORT_ENABLED before any database-capable module loads", async () => {
  let repositoryCalls = 0;
  const repository = { async requestGeneratedDraftExportReview() { repositoryCalls += 1; throw new Error("must not call"); } };
  const deps = { generatedContentRepository: repository, metadataOnlyAudit: auditRecorder() };
  assert.equal((await requestGeneratedDraftExportReview(input(), { ...deps, env: {} })).error.code, "feature_disabled");
  assert.equal((await requestGeneratedDraftExportReview(input(), { ...deps, env: { KAI_SPRINT2_ENABLED: "true" } })).error.code, "feature_disabled");
  assert.equal((await requestGeneratedDraftExportReview(input(), { ...deps, env: { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" } })).error.code, "feature_disabled");
  assert.equal(repositoryCalls, 0);
});

test("P3-05 service gates: exact input, mapped human, active tenant membership, and gk_admin authorization precede any repository call", async () => {
  let repositoryCalls = 0;
  const repository = {
    async requestGeneratedDraftExportReview() {
      repositoryCalls += 1;
      return { ok: true, data: { generatedContentDraftId: DRAFT, requestedExportAudience: "internal", exportReviewRequestAccepted: false, replayed: false, reviewQueueItemId: null, queueStatus: null, reviewStatus: null, validatorResult: { validator_key: "VAL-EXP-001", severity: "blocker", object_type: "generated_content_draft", object_code: "export_manifest_eligibility", object_id: DRAFT, message: "x", blocking_reason: "export_manifest_not_eligible", required_fix: null, evidence: { failed_gates: [] } } }, error: null };
    },
  };
  const deps = { generatedContentRepository: repository, metadataOnlyAudit: auditRecorder(), env: enabledEnv };
  assert.equal((await requestGeneratedDraftExportReview({ ...input(), extra: true }, deps)).error.code, "validation_blocker");
  assert.equal((await requestGeneratedDraftExportReview(input({ now: "2026-08-06 10:00:00" }), deps)).error.code, "validation_blocker");
  assert.equal((await requestGeneratedDraftExportReview(input({ requestedExportAudience: "unknown" }), deps)).error.code, "validation_blocker");
  assert.equal((await requestGeneratedDraftExportReview(input({ organizationId: "not-a-uuid" }), deps)).error.code, "validation_blocker");
  assert.equal((await requestGeneratedDraftExportReview(input({ actorContext: { actorType: "system", actorUserId: actorContext.actorUserId } }), deps)).error.code, "authorization_denied");
  assert.equal((await requestGeneratedDraftExportReview(input({ organizationId: OTHER_ORG }), deps)).error.code, "authorization_denied");
  assert.equal(
    (await requestGeneratedDraftExportReview(input({
      actorContext: { ...actorContext, organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" }] },
    }), deps)).error.code,
    "authorization_denied",
  );
  assert.equal(repositoryCalls, 0);
  const ok = await requestGeneratedDraftExportReview(input(), deps);
  assert.equal(ok.ok, true);
  assert.equal(repositoryCalls, 1);
});

test("P3-05 service lazy-loads the database-capable repository only after all gates, per its own source", () => {
  const source = readFileSync(new URL("../Backend/kai/services/kaiExportReviewService.js", import.meta.url), "utf8");
  const topLevelImports = source.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(topLevelImports.every((line) => !/postgresGeneratedContentRepository|kaiDb\.js|"pg"/.test(line)));
  assert.match(source, /await import\(\s*"\.\.\/dictionary\/postgresGeneratedContentRepository\.js"/);
});

test("P3-05 rejects a non-gk_admin actor even with active membership", async () => {
  const repository = { async requestGeneratedDraftExportReview() { throw new Error("must not call"); } };
  const deps = { generatedContentRepository: repository, metadataOnlyAudit: auditRecorder(), env: enabledEnv };
  for (const role of ["gk_reviewer", "gk_operator"]) {
    const result = await requestGeneratedDraftExportReview(input({
      actorContext: { ...actorContext, organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: role }] },
    }), deps);
    assert.equal(result.error.code, "authorization_denied");
  }
});

// --- input contract ---

test("P3-05 repository input validator rejects unknown/missing keys and non-canonical timestamps", () => {
  const { validateRequestExportReviewInput } = __generatedContentRepositoryTestables;
  assert.equal(validateRequestExportReviewInput(input()), true);
  assert.equal(validateRequestExportReviewInput({ ...input(), extra: true }), false);
  const { organizationId, ...missingOrg } = input();
  assert.equal(validateRequestExportReviewInput(missingOrg), false);
  assert.equal(validateRequestExportReviewInput(input({ now: "2026-08-06T10:00:00Z" })), false);
  assert.equal(validateRequestExportReviewInput(input({ now: 12345 })), false);
  assert.equal(validateRequestExportReviewInput(input({ organizationId: "not-a-uuid" })), false);
  assert.equal(validateRequestExportReviewInput(input({ requestedExportAudience: "unknown" })), false);
  assert.equal(validateRequestExportReviewInput(input({ actorContext: [] })), false);
});

// --- repository behavior against a fake authoritative transaction ---

test("P3-05 fresh creation writes exactly one export_review queue row and one audit when the canonical three gates are the only blockers", async () => {
  const state = makeFixtureState({ currentUseEligible: true });
  const repository = makeRepository(state);
  const result = await repository.requestGeneratedDraftExportReview(input(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.ok, true);
  assert.equal(result.data.exportReviewRequestAccepted, true);
  assert.equal(result.data.replayed, false);
  assert.equal(result.data.queueStatus, "open");
  assert.equal(result.data.reviewStatus, "needs_gk_review");
  assert.equal(state.exportReviewQueues.length, 1);
  assert.equal(state.auditRows.length, 1);
  assert.deepEqual(new Set(result.data.validatorResult.evidence.failed_gates), new Set(__generatedContentRepositoryContract.EXPORT_REVIEW_READINESS_FAILED_GATES));
});

test("P3-05 a later replay of the same request converges with zero additional mutation or audit", async () => {
  const state = makeFixtureState({ currentUseEligible: true });
  const repository = makeRepository(state);
  const first = await repository.requestGeneratedDraftExportReview(input(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(first.data.replayed, false);
  assert.equal(state.auditRows.length, 1);

  const replay = await repository.requestGeneratedDraftExportReview(input({ now: LATER, actorContext: { ...actorContext, actorUserId: "90000000-0000-4000-8000-000000000099" } }), { metadataOnlyAudit: auditRecorder() });
  assert.equal(replay.ok, true);
  assert.equal(replay.data.exportReviewRequestAccepted, true);
  assert.equal(replay.data.replayed, true);
  assert.equal(replay.data.reviewQueueItemId, first.data.reviewQueueItemId);
  assert.equal(state.exportReviewQueues.length, 1);
  assert.equal(state.auditRows.length, 1);
});

test("P3-05 currentUseEligible:false blocks creation with a successful blocked DTO and zero mutation or audit", async () => {
  const state = makeFixtureState({ currentUseEligible: false });
  const repository = makeRepository(state);
  const result = await repository.requestGeneratedDraftExportReview(input(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.ok, true);
  assert.equal(result.data.exportReviewRequestAccepted, false);
  assert.equal(result.data.replayed, false);
  assert.equal(result.data.reviewQueueItemId, null);
  assert.equal(result.data.queueStatus, null);
  assert.equal(result.data.reviewStatus, null);
  assert.ok(result.data.validatorResult.evidence.failed_gates.includes("current_use_ineligible"));
  assert.equal(state.exportReviewQueues.length, 0);
  assert.equal(state.auditRows.length, 0);
});

test("P3-05 an audience mismatch blocks creation with a successful blocked DTO and zero mutation or audit", async () => {
  const state = makeFixtureState({ currentUseEligible: true });
  const repository = makeRepository(state);
  const result = await repository.requestGeneratedDraftExportReview(input({ requestedExportAudience: "public" }), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.ok, true);
  assert.equal(result.data.exportReviewRequestAccepted, false);
  assert.ok(result.data.validatorResult.evidence.failed_gates.includes("export_audience_mismatch"));
  assert.equal(state.exportReviewQueues.length, 0);
  assert.equal(state.auditRows.length, 0);
});

test("P3-05 requires the generated-content review to be resolved/resolved: an unresolved review conflicts without mutation", async () => {
  const state = makeFixtureState({ currentUseEligible: true });
  state.genContentReviewQueues[0].queue_status = "open";
  state.genContentReviewQueues[0].review_status = "needs_gk_review";
  const repository = makeRepository(state);
  const result = await repository.requestGeneratedDraftExportReview(input(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.error.code, "conflict_current_state_changed");
  assert.equal(state.exportReviewQueues.length, 0);
  assert.equal(state.auditRows.length, 0);
});

test("P3-05 a missing tenant-scoped draft returns not_found", async () => {
  const state = makeFixtureState();
  const repository = makeRepository(state);
  const result = await repository.requestGeneratedDraftExportReview(input({ generatedContentDraftId: "00000000-0000-4000-8000-000000000999" }), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.error.code, "not_found");
});

test("P3-05 a cross-tenant generated-content-review queue row (same target, different organization) conflicts rather than succeeding", async () => {
  const state = makeFixtureState();
  state.genContentReviewQueues[0].organization_id = OTHER_ORG;
  const repository = makeRepository(state);
  const result = await repository.requestGeneratedDraftExportReview(input(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.error.code, "conflict_current_state_changed");
});

test("P3-05 an existing export_review row without a matching audit conflicts rather than replaying", async () => {
  const state = makeFixtureState({ currentUseEligible: true });
  state.exportReviewQueues.push({
    review_queue_item_id: "00000000-0000-4000-8000-000000000901",
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
  });
  const repository = makeRepository(state);
  const result = await repository.requestGeneratedDraftExportReview(input(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.error.code, "conflict_current_state_changed");
});

test("P3-05 duplicate matching audits fail closed", async () => {
  const state = makeFixtureState({ currentUseEligible: true });
  const repository = makeRepository(state);
  const first = await repository.requestGeneratedDraftExportReview(input(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(first.ok, true);
  state.auditRows.push({ ...state.auditRows[0] });
  const replay = await repository.requestGeneratedDraftExportReview(input({ now: LATER }), { metadataOnlyAudit: auditRecorder() });
  assert.equal(replay.error.code, "conflict_current_state_changed");
});

test("P3-05 requires an injected metadataOnlyAudit dependency before attempting any transaction", async () => {
  const state = makeFixtureState({ currentUseEligible: true });
  const repository = makeRepository(state);
  const result = await repository.requestGeneratedDraftExportReview(input(), {});
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(state.exportReviewQueues.length, 0);
  assert.equal(state.auditRows.length, 0);
});

test("P3-05 fails closed with system_error (not a thrown exception) when audit publication fails", async () => {
  const state = makeFixtureState({ currentUseEligible: true });
  const repository = makeRepository(state);
  const failingAudit = { prepareMetadataOnlyAudit() { return { ok: true, async publish() { throw new Error("publish failed"); } }; } };
  const result = await repository.requestGeneratedDraftExportReview(input(), { metadataOnlyAudit: failingAudit });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "system_error");
});

test("P3-05 rolls back when the audit prepare contract is rejected", async () => {
  const state = makeFixtureState({ currentUseEligible: true });
  const repository = makeRepository(state);
  const invalidAudit = { prepareMetadataOnlyAudit() { return { ok: false }; } };
  const result = await repository.requestGeneratedDraftExportReview(input(), { metadataOnlyAudit: invalidAudit });
  assert.equal(result.error.code, "system_error");
  assert.equal(state.exportReviewQueues.length, 1);
  assert.equal(state.auditRows.length, 0);
});

test("P3-05 never mutates draft_status, blocks, or citations", async () => {
  const state = makeFixtureState({ currentUseEligible: true });
  const before = JSON.stringify({ draft: state.draft, blocks: state.blocks, citations: state.citations });
  const repository = makeRepository(state);
  await repository.requestGeneratedDraftExportReview(input(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(JSON.stringify({ draft: state.draft, blocks: state.blocks, citations: state.citations }), before);
});

test("P3-05 never mutates the generated-content review queue row", async () => {
  const state = makeFixtureState({ currentUseEligible: true });
  const before = JSON.stringify(state.genContentReviewQueues);
  const repository = makeRepository(state);
  await repository.requestGeneratedDraftExportReview(input(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(JSON.stringify(state.genContentReviewQueues), before);
});

test("P3-05 audit metadata excludes draft/claim/evidence text and contains only the specified identifiers and codes", async () => {
  const state = makeFixtureState({ currentUseEligible: true });
  const repository = makeRepository(state);
  await repository.requestGeneratedDraftExportReview(input(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(state.auditRows.length, 1);
  const metadata = state.auditRows[0].metadata;
  assert.deepEqual(new Set(Object.keys(metadata)), new Set([
    "contract",
    "organization_id",
    "generated_content_draft_id",
    "review_queue_item_id",
    "requested_export_audience",
    "actor_id",
    "actor_type",
    "requested_timestamp",
    "validator_key",
    "failed_gates",
  ]));
  assert.equal(metadata.organization_id, ORG);
  assert.equal(metadata.generated_content_draft_id, DRAFT);
  assert.equal(metadata.requested_export_audience, "internal");
  assert.equal(metadata.actor_id, actorContext.actorUserId);
  assert.equal(metadata.actor_type, "human");
  assert.equal(metadata.validator_key, "VAL-EXP-001");
  assert.deepEqual(new Set(metadata.failed_gates), new Set(__generatedContentRepositoryContract.EXPORT_REVIEW_READINESS_FAILED_GATES));
});

// --- service-level allowlisted DTO ---

test("P3-05 service DTO validator enforces the exact successful and blocked allowlists", () => {
  const { isRequestExportReviewResultDto } = __exportReviewServiceTestables;
  assert.equal(isRequestExportReviewResultDto({
    generatedContentDraftId: DRAFT,
    requestedExportAudience: "internal",
    exportReviewRequestAccepted: true,
    replayed: false,
    reviewQueueItemId: "00000000-0000-4000-8000-000000000901",
    queueStatus: "open",
    reviewStatus: "needs_gk_review",
    validatorResult: { failed_gates: [] },
  }), true);
  assert.equal(isRequestExportReviewResultDto({
    generatedContentDraftId: DRAFT,
    requestedExportAudience: "internal",
    exportReviewRequestAccepted: false,
    replayed: false,
    reviewQueueItemId: null,
    queueStatus: null,
    reviewStatus: null,
    validatorResult: { failed_gates: ["current_use_ineligible"] },
  }), true);
  assert.equal(isRequestExportReviewResultDto({
    generatedContentDraftId: DRAFT,
    requestedExportAudience: "internal",
    exportReviewRequestAccepted: true,
    replayed: false,
    reviewQueueItemId: null,
    queueStatus: null,
    reviewStatus: null,
    validatorResult: {},
  }), false);
  assert.equal(isRequestExportReviewResultDto({
    generatedContentDraftId: DRAFT,
    requestedExportAudience: "internal",
    exportReviewRequestAccepted: true,
    replayed: false,
    reviewQueueItemId: "00000000-0000-4000-8000-000000000901",
    queueStatus: "open",
    reviewStatus: "needs_gk_review",
    validatorResult: {},
    extra: true,
  }), false);
});
