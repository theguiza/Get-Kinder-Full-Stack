import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  startGeneratedDraftExportReview,
  requestGeneratedDraftExportReview,
  getGeneratedDraftExportReviewPacket,
  __exportReviewServiceTestables,
} from "../Backend/kai/services/kaiExportReviewService.js";
import {
  createPostgresGeneratedContentRepository,
  evaluateGeneratedDraftExportReviewPacketInTransaction,
  evaluateExportReviewRequestStateInTransaction,
  __generatedContentRepositoryTestables,
  __generatedContentRepositoryContract,
} from "../Backend/kai/dictionary/postgresGeneratedContentRepository.js";
import { EXPORT_REVIEW_LIFECYCLE_PROFILES } from "../Backend/kai/dictionary/exportReviewQueueContract.js";
import { GENERATED_CONTENT_REVIEW_QUEUE_STATIC_CONTRACT } from "../Backend/kai/dictionary/generatedContentReviewQueueContract.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const RUN = "00000000-0000-4000-8000-000000000801";
const DRAFT = "00000000-0000-4000-8000-000000000802";
const OTHER_DRAFT = "00000000-0000-4000-8000-000000000899";
const BLOCK = "00000000-0000-4000-8000-000000000803";
const CITATION = "00000000-0000-4000-8000-000000000804";
const CLAIM = "00000000-0000-4000-8000-000000000805";
const EVIDENCE = "00000000-0000-4000-8000-000000000806";
const SOURCE = "00000000-0000-4000-8000-000000000807";
const SOURCE_VERSION = "00000000-0000-4000-8000-000000000808";
const GENERATED_CONTENT_QUEUE = "00000000-0000-4000-8000-000000000809";
const EXPORT_REVIEW_QUEUE = "00000000-0000-4000-8000-000000000901";
const NOW = "2026-08-06T10:00:00.000Z";
const LATER = "2026-08-06T10:05:00.000Z";
const EXPECTED_UPDATED_AT = "2026-08-06T09:00:00.000Z";

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
    exportReviewQueueItemId: EXPORT_REVIEW_QUEUE,
    expectedUpdatedAt: EXPECTED_UPDATED_AT,
    actorContext,
    now: NOW,
    ...overrides,
  };
}

function auditRecorder() {
  return { prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } };
}

function makeExportReviewRow(overrides = {}) {
  return {
    review_queue_item_id: EXPORT_REVIEW_QUEUE,
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
    ...overrides,
  };
}

function makeState({ queueRow = makeExportReviewRow() } = {}) {
  return {
    queueRow,
    auditRows: [],
    updatedAtVersion: EXPECTED_UPDATED_AT,
    auditFileContext: { intake_file_id: "00000000-0000-4000-8000-000000000701", upload_state: "confirmed" },
  };
}

function makeFakeTx(state) {
  return {
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, " ").trim();

      if (s.startsWith("UPDATE kai.review_queue_items")) {
        const [
          newQueueStatus, now, organizationId, reviewQueueItemId, queueType,
          targetType, targetId, expectedQueueStatus, expectedReviewStatus, expectedUpdatedAt,
        ] = params;
        const row = state.queueRow;
        const matches = row
          && row.review_queue_item_id === reviewQueueItemId
          && row.organization_id === organizationId
          && row.queue_type === queueType
          && row.target_object_type === targetType
          && row.target_object_id === targetId
          && row.queue_status === expectedQueueStatus
          && row.review_status === expectedReviewStatus
          && state.updatedAtVersion === expectedUpdatedAt;
        if (!matches) return { rowCount: 0, rows: [] };
        row.queue_status = newQueueStatus;
        state.updatedAtVersion = now;
        return { rowCount: 1, rows: [{ review_queue_item_id: reviewQueueItemId }] };
      }

      if (s.startsWith("SELECT review_queue_item_id::text AS review_queue_item_id") && s.includes("review_queue_item_id = $2::uuid")) {
        const [organizationId, reviewQueueItemId] = params;
        const row = state.queueRow;
        const match = row && row.organization_id === organizationId && row.review_queue_item_id === reviewQueueItemId;
        return { rows: match ? [row] : [] };
      }

      if (s.includes("intake_file_id::text AS intake_file_id") && s.includes("FROM kai.generated_content_blocks")) {
        return { rows: [{ intake_file_id: state.auditFileContext.intake_file_id, upload_state: state.auditFileContext.upload_state }] };
      }

      if (s.startsWith("INSERT INTO kai.upload_lifecycle_audit")) {
        const [organizationId, , operation, , metadataJson] = params;
        const metadata = JSON.parse(metadataJson);
        state.auditRows.push({ organization_id: organizationId, operation, outcome: "success", metadata });
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
}

function makeRepository(state) {
  return createPostgresGeneratedContentRepository({
    runInTransaction: async (callback) => callback(makeFakeTx(state)),
  });
}

// --- service gates ---

test("P3-09 service requires KAI_SPRINT2_ENABLED, then KAI_GENERATION_ENABLED, then KAI_PUBLIC_EXPORT_ENABLED before any database-capable module loads", async () => {
  let repositoryCalls = 0;
  const repository = { async startGeneratedDraftExportReview() { repositoryCalls += 1; throw new Error("must not call"); } };
  const deps = { generatedContentRepository: repository, metadataOnlyAudit: auditRecorder() };
  assert.equal((await startGeneratedDraftExportReview(input(), { ...deps, env: {} })).error.code, "feature_disabled");
  assert.equal((await startGeneratedDraftExportReview(input(), { ...deps, env: { KAI_SPRINT2_ENABLED: "true" } })).error.code, "feature_disabled");
  assert.equal((await startGeneratedDraftExportReview(input(), { ...deps, env: { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" } })).error.code, "feature_disabled");
  assert.equal(repositoryCalls, 0);
});

test("P3-09 service gates: exact input, mapped human, active tenant membership, and gk_admin authorization precede any repository call", async () => {
  let repositoryCalls = 0;
  const repository = {
    async startGeneratedDraftExportReview() {
      repositoryCalls += 1;
      return { ok: true, data: { generatedContentDraftId: DRAFT, exportReviewQueueItemId: EXPORT_REVIEW_QUEUE, queueStatus: "in_progress", reviewStatus: "needs_gk_review", replayed: false }, error: null };
    },
  };
  const deps = { generatedContentRepository: repository, metadataOnlyAudit: auditRecorder(), env: enabledEnv };
  assert.equal((await startGeneratedDraftExportReview({ ...input(), extra: true }, deps)).error.code, "validation_blocker");
  assert.equal((await startGeneratedDraftExportReview(input({ now: "2026-08-06 10:00:00" }), deps)).error.code, "validation_blocker");
  assert.equal((await startGeneratedDraftExportReview(input({ expectedUpdatedAt: "2026-08-06T09:00:00Z" }), deps)).error.code, "validation_blocker");
  assert.equal((await startGeneratedDraftExportReview(input({ organizationId: "not-a-uuid" }), deps)).error.code, "validation_blocker");
  assert.equal((await startGeneratedDraftExportReview(input({ exportReviewQueueItemId: "not-a-uuid" }), deps)).error.code, "validation_blocker");
  assert.equal((await startGeneratedDraftExportReview(input({ actorContext: { actorType: "system", actorUserId: actorContext.actorUserId } }), deps)).error.code, "authorization_denied");
  assert.equal((await startGeneratedDraftExportReview(input({ organizationId: OTHER_ORG }), deps)).error.code, "authorization_denied");
  assert.equal(
    (await startGeneratedDraftExportReview(input({
      actorContext: { ...actorContext, organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" }] },
    }), deps)).error.code,
    "authorization_denied",
  );
  assert.equal(repositoryCalls, 0);
  const ok = await startGeneratedDraftExportReview(input(), deps);
  assert.equal(ok.ok, true);
  assert.equal(repositoryCalls, 1);
});

test("P3-09 service lazy-loads the database-capable repository only after all gates, per its own source", () => {
  const source = readFileSync(new URL("../Backend/kai/services/kaiExportReviewService.js", import.meta.url), "utf8");
  const topLevelImports = source.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(topLevelImports.every((line) => !/postgresGeneratedContentRepository|kaiDb\.js|"pg"/.test(line)));
  assert.match(source, /await import\(\s*"\.\.\/dictionary\/postgresGeneratedContentRepository\.js"/);
});

// --- input contract ---

test("P3-09 repository input validator rejects unknown/missing keys and non-canonical timestamps", () => {
  const { validateStartExportReviewInput } = __generatedContentRepositoryTestables;
  assert.equal(validateStartExportReviewInput(input()), true);
  assert.equal(validateStartExportReviewInput({ ...input(), extra: true }), false);
  const { organizationId, ...missingOrg } = input();
  assert.equal(validateStartExportReviewInput(missingOrg), false);
  assert.equal(validateStartExportReviewInput(input({ now: "2026-08-06T10:00:00Z" })), false);
  assert.equal(validateStartExportReviewInput(input({ expectedUpdatedAt: "2026-08-06T09:00:00Z" })), false);
  assert.equal(validateStartExportReviewInput(input({ organizationId: "not-a-uuid" })), false);
  assert.equal(validateStartExportReviewInput(input({ exportReviewQueueItemId: "not-a-uuid" })), false);
  assert.equal(validateStartExportReviewInput(input({ actorContext: [] })), false);
});

// --- repository behavior against a fake authoritative transaction ---

test("P3-09 fresh start writes exactly one transition and one audit", async () => {
  const state = makeState();
  const repository = makeRepository(state);
  const result = await repository.startGeneratedDraftExportReview(input(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.ok, true);
  assert.equal(result.data.replayed, false);
  assert.equal(result.data.queueStatus, "in_progress");
  assert.equal(result.data.reviewStatus, "needs_gk_review");
  assert.equal(state.queueRow.queue_status, "in_progress");
  assert.equal(state.auditRows.length, 1);
});

test("P3-09 an audit-backed identical replay (same actor, expectedUpdatedAt, and requested timestamp) converges with zero additional mutation or audit", async () => {
  const state = makeState();
  const repository = makeRepository(state);
  const first = await repository.startGeneratedDraftExportReview(input(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(first.data.replayed, false);
  assert.equal(state.auditRows.length, 1);

  const replay = await repository.startGeneratedDraftExportReview(input(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(replay.ok, true);
  assert.equal(replay.data.replayed, true);
  assert.equal(replay.data.queueStatus, "in_progress");
  assert.equal(replay.data.reviewStatus, "needs_gk_review");
  assert.equal(state.auditRows.length, 1);
});

test("P3-09 a different actor is not an identical replay and conflicts without repair", async () => {
  const state = makeState();
  const repository = makeRepository(state);
  await repository.startGeneratedDraftExportReview(input(), { metadataOnlyAudit: auditRecorder() });
  const differentActor = { ...actorContext, actorUserId: "90000000-0000-4000-8000-000000000099" };
  const result = await repository.startGeneratedDraftExportReview(input({ actorContext: differentActor }), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.error.code, "conflict_current_state_changed");
  assert.equal(state.auditRows.length, 1);
});

test("P3-09 a different expectedUpdatedAt on an already-started row is not an identical replay and conflicts without repair", async () => {
  const state = makeState();
  const repository = makeRepository(state);
  await repository.startGeneratedDraftExportReview(input(), { metadataOnlyAudit: auditRecorder() });
  const result = await repository.startGeneratedDraftExportReview(input({ expectedUpdatedAt: LATER }), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.error.code, "conflict_current_state_changed");
  assert.equal(state.auditRows.length, 1);
});

test("P3-09 a different requested start timestamp (now) on an already-started row is not an identical replay and conflicts without repair", async () => {
  const state = makeState();
  const repository = makeRepository(state);
  await repository.startGeneratedDraftExportReview(input(), { metadataOnlyAudit: auditRecorder() });
  const result = await repository.startGeneratedDraftExportReview(input({ now: LATER }), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.error.code, "conflict_current_state_changed");
  assert.equal(state.auditRows.length, 1);
});

test("P3-09 stale CAS (expectedUpdatedAt no longer matches) conflicts with zero mutation and zero audit", async () => {
  const state = makeState();
  state.updatedAtVersion = "2026-08-06T08:00:00.000Z";
  const repository = makeRepository(state);
  const result = await repository.startGeneratedDraftExportReview(input(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.error.code, "conflict_current_state_changed");
  assert.equal(state.queueRow.queue_status, "open");
  assert.equal(state.auditRows.length, 0);
});

test("P3-09 a missing tenant-scoped exportReviewQueueItemId returns not_found", async () => {
  const state = makeState();
  const repository = makeRepository(state);
  const result = await repository.startGeneratedDraftExportReview(
    input({ exportReviewQueueItemId: "00000000-0000-4000-8000-000000000999" }),
    { metadataOnlyAudit: auditRecorder() },
  );
  assert.equal(result.error.code, "not_found");
});

test("P3-09 a queue item that exists only in another organization returns not_found (no unscoped lookup leak)", async () => {
  const state = makeState({ queueRow: makeExportReviewRow({ organization_id: OTHER_ORG }) });
  const repository = makeRepository(state);
  const result = await repository.startGeneratedDraftExportReview(input(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.error.code, "not_found");
});

test("P3-09 a queue item that targets another draft conflicts rather than succeeding", async () => {
  const state = makeState({ queueRow: makeExportReviewRow({ target_object_id: OTHER_DRAFT }) });
  const repository = makeRepository(state);
  const result = await repository.startGeneratedDraftExportReview(input(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.error.code, "conflict_current_state_changed");
  assert.equal(state.auditRows.length, 0);
});

test("P3-09 duplicate matching audits fail closed without repair", async () => {
  const state = makeState();
  const repository = makeRepository(state);
  const first = await repository.startGeneratedDraftExportReview(input(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(first.ok, true);
  state.auditRows.push({ ...state.auditRows[0] });
  const result = await repository.startGeneratedDraftExportReview(input(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.error.code, "conflict_current_state_changed");
});

test("P3-09 malformed audit metadata on an in_progress row conflicts without repair", async () => {
  const state = makeState();
  const repository = makeRepository(state);
  await repository.startGeneratedDraftExportReview(input(), { metadataOnlyAudit: auditRecorder() });
  state.auditRows[0].metadata.previous_queue_status = "corrupted";
  const result = await repository.startGeneratedDraftExportReview(input(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.error.code, "conflict_current_state_changed");
});

test("P3-09 requires an injected metadataOnlyAudit dependency before attempting any transaction", async () => {
  const state = makeState();
  const repository = makeRepository(state);
  const result = await repository.startGeneratedDraftExportReview(input(), {});
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(state.queueRow.queue_status, "open");
  assert.equal(state.auditRows.length, 0);
});

test("P3-09 fails closed with system_error (not a thrown exception) when audit publication fails", async () => {
  const state = makeState();
  const repository = makeRepository(state);
  const failingAudit = { prepareMetadataOnlyAudit() { return { ok: true, async publish() { throw new Error("publish failed"); } }; } };
  const result = await repository.startGeneratedDraftExportReview(input(), { metadataOnlyAudit: failingAudit });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "system_error");
});

test("P3-09 rolls back when the audit prepare contract is rejected", async () => {
  const state = makeState();
  const repository = makeRepository(state);
  const invalidAudit = { prepareMetadataOnlyAudit() { return { ok: false }; } };
  const result = await repository.startGeneratedDraftExportReview(input(), { metadataOnlyAudit: invalidAudit });
  assert.equal(result.error.code, "system_error");
  assert.equal(state.auditRows.length, 0);
});

test("P3-09 audit metadata binds organization, draft, queue item, actor, expectedUpdatedAt, requested start timestamp, previous/resulting statuses, and validator keys", async () => {
  const state = makeState();
  const repository = makeRepository(state);
  await repository.startGeneratedDraftExportReview(input(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(state.auditRows.length, 1);
  const metadata = state.auditRows[0].metadata;
  assert.deepEqual(new Set(Object.keys(metadata)), new Set([
    "contract",
    "organization_id",
    "generated_content_draft_id",
    "review_queue_item_id",
    "actor_id",
    "actor_type",
    "expected_updated_at",
    "requested_start_timestamp",
    "previous_queue_status",
    "resulting_queue_status",
    "previous_review_status",
    "resulting_review_status",
    "validator_keys",
  ]));
  assert.equal(metadata.contract, __generatedContentRepositoryContract.EXPORT_REVIEW_START_AUDIT_CONTRACT);
  assert.equal(metadata.organization_id, ORG);
  assert.equal(metadata.generated_content_draft_id, DRAFT);
  assert.equal(metadata.review_queue_item_id, EXPORT_REVIEW_QUEUE);
  assert.equal(metadata.actor_id, actorContext.actorUserId);
  assert.equal(metadata.actor_type, "human");
  assert.equal(metadata.expected_updated_at, EXPECTED_UPDATED_AT);
  assert.equal(metadata.requested_start_timestamp, NOW);
  assert.equal(metadata.previous_queue_status, "open");
  assert.equal(metadata.resulting_queue_status, "in_progress");
  assert.equal(metadata.previous_review_status, "needs_gk_review");
  assert.equal(metadata.resulting_review_status, "needs_gk_review");
  assert.deepEqual(metadata.validator_keys, [...__generatedContentRepositoryContract.EXPORT_REVIEW_START_VALIDATOR_KEYS]);
  assert.ok(!("requested_export_audience" in metadata));
  assert.ok(!("approval" in metadata));
  assert.ok(!("export_authority" in metadata));
  assert.ok(!("final_gate" in metadata));
});

// --- service-level allowlisted DTO ---

test("P3-09 service DTO validator enforces the exact allowlist and pins the resulting in_progress/needs_gk_review state", () => {
  const { isStartExportReviewResultDto } = __exportReviewServiceTestables;
  assert.equal(isStartExportReviewResultDto({
    generatedContentDraftId: DRAFT,
    exportReviewQueueItemId: EXPORT_REVIEW_QUEUE,
    queueStatus: "in_progress",
    reviewStatus: "needs_gk_review",
    replayed: false,
  }), true);
  assert.equal(isStartExportReviewResultDto({
    generatedContentDraftId: DRAFT,
    exportReviewQueueItemId: EXPORT_REVIEW_QUEUE,
    queueStatus: "open",
    reviewStatus: "needs_gk_review",
    replayed: false,
  }), false);
  assert.equal(isStartExportReviewResultDto({
    generatedContentDraftId: DRAFT,
    exportReviewQueueItemId: EXPORT_REVIEW_QUEUE,
    queueStatus: "resolved",
    reviewStatus: "resolved",
    replayed: false,
  }), false);
  assert.equal(isStartExportReviewResultDto({
    generatedContentDraftId: DRAFT,
    exportReviewQueueItemId: EXPORT_REVIEW_QUEUE,
    queueStatus: "in_progress",
    reviewStatus: "needs_gk_review",
    replayed: false,
    extra: true,
  }), false);
});

// --- queue-contract separation across P3-05 / P3-06 / P3-09 ---

test("P3-05 request lifecycle stays open/needs_gk_review only: an in_progress export_review row is not an eligible replay target and conflicts", async () => {
  const state = {
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
    exportReviewQueues: [makeExportReviewRow({ queue_status: "in_progress" })],
    auditRows: [],
    auditFileContext: { intake_file_id: "00000000-0000-4000-8000-000000000701", upload_state: "confirmed" },
    currentUseEligible: true,
  };
  const tx = {
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
        const match = state.draft.organization_id === organizationId && state.draft.generated_content_draft_id === draftId;
        return { rows: match ? [state.draft] : [] };
      }
      if (s.includes("FROM kai.generation_runs")) {
        const [runId] = params;
        return { rows: state.run.generation_run_id === runId ? [state.run] : [] };
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
            q.organization_id === organizationId && q.queue_type === queueType
            && q.target_object_type === targetType && q.target_object_id === targetId),
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
      if (s.includes("FROM kai.upload_lifecycle_audit")) return { rows: [] };
      throw new Error(`unhandled fake query: ${s}`);
    },
  };
  const repository = createPostgresGeneratedContentRepository({ runInTransaction: async (cb) => cb(tx) });
  const result = await repository.requestGeneratedDraftExportReview(
    { organizationId: ORG, generatedContentDraftId: DRAFT, requestedExportAudience: "internal", actorContext, now: NOW },
    { metadataOnlyAudit: auditRecorder() },
  );
  assert.equal(result.error.code, "conflict_current_state_changed");
});

test("P3-06 reads both open/needs_gk_review and in_progress/needs_gk_review export_review states", async () => {
  const openRow = makeExportReviewRow({ queue_status: "open" });
  const inProgressRow = makeExportReviewRow({ queue_status: "in_progress" });
  for (const row of [openRow, inProgressRow]) {
    const state = makeState({ queueRow: row });
    state.auditRows.push({
      organization_id: ORG,
      operation: "export_review_requested",
      outcome: "success",
      metadata: {
        contract: __generatedContentRepositoryContract.EXPORT_REVIEW_AUDIT_CONTRACT,
        organization_id: ORG,
        generated_content_draft_id: DRAFT,
        review_queue_item_id: EXPORT_REVIEW_QUEUE,
        requested_export_audience: "internal",
        actor_id: actorContext.actorUserId,
        actor_type: "human",
        requested_timestamp: NOW,
        validator_key: "VAL-EXP-001",
        failed_gates: [...__generatedContentRepositoryContract.EXPORT_REVIEW_READINESS_FAILED_GATES],
      },
    });
    const tx = makeFakeTx(state);
    const result = await evaluateExportReviewRequestStateInTransaction(tx, {
      organizationId: ORG,
      generatedContentDraftId: DRAFT,
      exportReviewQueueItemId: EXPORT_REVIEW_QUEUE,
    });
    assert.equal(result.ok, true, `expected ok for queue_status=${row.queue_status}`);
    assert.equal(result.data.exportReviewQueueStatus, row.queue_status);
    assert.equal(result.data.exportReviewStatus, "needs_gk_review");
  }
});

test("P3-06 rejects an export_review state outside the three admitted lifecycle profiles", async () => {
  const state = makeState({ queueRow: makeExportReviewRow({ queue_status: "in_progress", review_status: "resolved" }) });
  const tx = makeFakeTx(state);
  const result = await evaluateExportReviewRequestStateInTransaction(tx, {
    organizationId: ORG,
    generatedContentDraftId: DRAFT,
    exportReviewQueueItemId: EXPORT_REVIEW_QUEUE,
  });
  assert.equal(result.error.code, "conflict_current_state_changed");
});

test("P3-09 (widened by P3-13) exposes exactly three lifecycle profiles: open/needs_gk_review, in_progress/needs_gk_review, and resolved/resolved", () => {
  assert.deepEqual(
    EXPORT_REVIEW_LIFECYCLE_PROFILES.map((profile) => ({ ...profile })),
    [
      { queueStatus: "open", reviewStatus: "needs_gk_review" },
      { queueStatus: "in_progress", reviewStatus: "needs_gk_review" },
      { queueStatus: "resolved", reviewStatus: "resolved" },
    ],
  );
});

// --- no forbidden state is admitted ---

test("P3-09 admits no resolved, approval, export-authority, final-gate, or manifest/finalization state", () => {
  const repositorySource = readFileSync(
    new URL("../Backend/kai/dictionary/postgresGeneratedContentRepository.js", import.meta.url),
    "utf8",
  );
  const startSectionStart = repositorySource.indexOf("function validateStartExportReviewInput");
  const startSectionEnd = repositorySource.indexOf("export async function evaluateExportReviewRequestStateInTransaction");
  const startSection = repositorySource.slice(startSectionStart, startSectionEnd);
  for (const forbidden of [
    "export_authority",
    "final_export_gate",
    "finalGate",
    "affirmativeHumanExportAuthority",
    "manifest",
    "'resolved'",
    "\"resolved\"",
  ]) {
    assert.ok(!startSection.includes(forbidden), `P3-09 start section must not reference ${forbidden}`);
  }
});
