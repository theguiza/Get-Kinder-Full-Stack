import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  completeGeneratedDraftExportReview,
  __exportReviewServiceTestables,
} from "../Backend/kai/services/kaiExportReviewService.js";
import {
  createPostgresGeneratedContentRepository,
  evaluateGeneratedDraftExportReviewPacketInTransaction,
  __generatedContentRepositoryTestables,
  __generatedContentRepositoryContract,
} from "../Backend/kai/dictionary/postgresGeneratedContentRepository.js";
import { EXPORT_REVIEW_LIFECYCLE_PROFILES } from "../Backend/kai/dictionary/exportReviewQueueContract.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const DRAFT = "00000000-0000-4000-8000-000000000802";
const OTHER_DRAFT = "00000000-0000-4000-8000-000000000899";
const EXPORT_REVIEW_QUEUE = "00000000-0000-4000-8000-000000000901";
const NOW = "2026-08-06T10:10:00.000Z";
const LATER = "2026-08-06T10:15:00.000Z";
const EXPECTED_UPDATED_AT = "2026-08-06T10:05:00.000Z";

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
    priority: "normal",
    queue_status: "in_progress",
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
          newQueueStatus, newReviewStatus, now, organizationId, reviewQueueItemId, queueType,
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
        row.review_status = newReviewStatus;
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

test("P3-13 service requires KAI_SPRINT2_ENABLED, then KAI_GENERATION_ENABLED, then KAI_PUBLIC_EXPORT_ENABLED before any database-capable module loads", async () => {
  let repositoryCalls = 0;
  const repository = { async completeGeneratedDraftExportReview() { repositoryCalls += 1; throw new Error("must not call"); } };
  const deps = { generatedContentRepository: repository, metadataOnlyAudit: auditRecorder() };
  assert.equal((await completeGeneratedDraftExportReview(input(), { ...deps, env: {} })).error.code, "feature_disabled");
  assert.equal((await completeGeneratedDraftExportReview(input(), { ...deps, env: { KAI_SPRINT2_ENABLED: "true" } })).error.code, "feature_disabled");
  assert.equal((await completeGeneratedDraftExportReview(input(), { ...deps, env: { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" } })).error.code, "feature_disabled");
  assert.equal(repositoryCalls, 0);
});

test("P3-13 service gates: exact input, mapped human, active tenant membership, and gk_admin authorization precede any repository call", async () => {
  let repositoryCalls = 0;
  const repository = {
    async completeGeneratedDraftExportReview() {
      repositoryCalls += 1;
      return { ok: true, data: { generatedContentDraftId: DRAFT, exportReviewQueueItemId: EXPORT_REVIEW_QUEUE, queueStatus: "resolved", reviewStatus: "resolved", replayed: false }, error: null };
    },
  };
  const deps = { generatedContentRepository: repository, metadataOnlyAudit: auditRecorder(), env: enabledEnv };
  assert.equal((await completeGeneratedDraftExportReview({ ...input(), extra: true }, deps)).error.code, "validation_blocker");
  assert.equal((await completeGeneratedDraftExportReview(input({ now: "2026-08-06 10:10:00" }), deps)).error.code, "validation_blocker");
  assert.equal((await completeGeneratedDraftExportReview(input({ expectedUpdatedAt: "2026-08-06T10:05:00Z" }), deps)).error.code, "validation_blocker");
  assert.equal((await completeGeneratedDraftExportReview(input({ organizationId: "not-a-uuid" }), deps)).error.code, "validation_blocker");
  assert.equal((await completeGeneratedDraftExportReview(input({ exportReviewQueueItemId: "not-a-uuid" }), deps)).error.code, "validation_blocker");
  assert.equal((await completeGeneratedDraftExportReview(input({ actorContext: { actorType: "system", actorUserId: actorContext.actorUserId } }), deps)).error.code, "authorization_denied");
  assert.equal((await completeGeneratedDraftExportReview(input({ organizationId: OTHER_ORG }), deps)).error.code, "authorization_denied");
  assert.equal(
    (await completeGeneratedDraftExportReview(input({
      actorContext: { ...actorContext, organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" }] },
    }), deps)).error.code,
    "authorization_denied",
  );
  assert.equal(repositoryCalls, 0);
  const ok = await completeGeneratedDraftExportReview(input(), deps);
  assert.equal(ok.ok, true);
  assert.equal(repositoryCalls, 1);
});

test("P3-13 service lazy-loads the database-capable repository only after all gates, per its own source", () => {
  const source = readFileSync(new URL("../Backend/kai/services/kaiExportReviewService.js", import.meta.url), "utf8");
  const topLevelImports = source.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(topLevelImports.every((line) => !/postgresGeneratedContentRepository|kaiDb\.js|"pg"/.test(line)));
  assert.match(source, /await import\(\s*"\.\.\/dictionary\/postgresGeneratedContentRepository\.js"/);
});

// --- input contract ---

test("P3-13 repository input validator rejects unknown/missing keys and non-canonical timestamps", () => {
  const { validateCompleteExportReviewInput } = __generatedContentRepositoryTestables;
  assert.equal(validateCompleteExportReviewInput(input()), true);
  assert.equal(validateCompleteExportReviewInput({ ...input(), extra: true }), false);
  const { organizationId, ...missingOrg } = input();
  assert.equal(validateCompleteExportReviewInput(missingOrg), false);
  assert.equal(validateCompleteExportReviewInput(input({ now: "2026-08-06T10:10:00Z" })), false);
  assert.equal(validateCompleteExportReviewInput(input({ expectedUpdatedAt: "2026-08-06T10:05:00Z" })), false);
  assert.equal(validateCompleteExportReviewInput(input({ organizationId: "not-a-uuid" })), false);
  assert.equal(validateCompleteExportReviewInput(input({ exportReviewQueueItemId: "not-a-uuid" })), false);
  assert.equal(validateCompleteExportReviewInput(input({ actorContext: [] })), false);
});

// --- repository behavior against a fake authoritative transaction ---

test("P3-13 fresh completion transitions in_progress/needs_gk_review to resolved/resolved with exactly one audit", async () => {
  const state = makeState();
  const repository = makeRepository(state);
  const result = await repository.completeGeneratedDraftExportReview(input(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.ok, true);
  assert.equal(result.data.replayed, false);
  assert.equal(result.data.queueStatus, "resolved");
  assert.equal(result.data.reviewStatus, "resolved");
  assert.equal(state.queueRow.queue_status, "resolved");
  assert.equal(state.queueRow.review_status, "resolved");
  assert.equal(state.auditRows.length, 1);
});

test("P3-13 an audit-backed identical replay (same actor, expectedUpdatedAt, and requested timestamp) converges with zero additional mutation or audit", async () => {
  const state = makeState();
  const repository = makeRepository(state);
  const first = await repository.completeGeneratedDraftExportReview(input(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(first.data.replayed, false);
  assert.equal(state.auditRows.length, 1);

  const replay = await repository.completeGeneratedDraftExportReview(input(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(replay.ok, true);
  assert.equal(replay.data.replayed, true);
  assert.equal(replay.data.queueStatus, "resolved");
  assert.equal(replay.data.reviewStatus, "resolved");
  assert.equal(state.auditRows.length, 1);
});

test("P3-13 a different actor is not an identical replay and conflicts without repair", async () => {
  const state = makeState();
  const repository = makeRepository(state);
  await repository.completeGeneratedDraftExportReview(input(), { metadataOnlyAudit: auditRecorder() });
  const differentActor = { ...actorContext, actorUserId: "90000000-0000-4000-8000-000000000099" };
  const result = await repository.completeGeneratedDraftExportReview(input({ actorContext: differentActor }), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.error.code, "conflict_current_state_changed");
  assert.equal(state.auditRows.length, 1);
});

test("P3-13 a different expectedUpdatedAt on an already-completed row is not an identical replay and conflicts without repair", async () => {
  const state = makeState();
  const repository = makeRepository(state);
  await repository.completeGeneratedDraftExportReview(input(), { metadataOnlyAudit: auditRecorder() });
  const result = await repository.completeGeneratedDraftExportReview(input({ expectedUpdatedAt: LATER }), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.error.code, "conflict_current_state_changed");
  assert.equal(state.auditRows.length, 1);
});

test("P3-13 a different requested completion timestamp (now) on an already-completed row is not an identical replay and conflicts without repair", async () => {
  const state = makeState();
  const repository = makeRepository(state);
  await repository.completeGeneratedDraftExportReview(input(), { metadataOnlyAudit: auditRecorder() });
  const result = await repository.completeGeneratedDraftExportReview(input({ now: LATER }), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.error.code, "conflict_current_state_changed");
  assert.equal(state.auditRows.length, 1);
});

test("P3-13 stale CAS (expectedUpdatedAt no longer matches) conflicts with zero mutation and zero audit", async () => {
  const state = makeState();
  state.updatedAtVersion = "2026-08-06T09:00:00.000Z";
  const repository = makeRepository(state);
  const result = await repository.completeGeneratedDraftExportReview(input(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.error.code, "conflict_current_state_changed");
  assert.equal(state.queueRow.queue_status, "in_progress");
  assert.equal(state.auditRows.length, 0);
});

test("P3-13 a still-open (never started) row does not satisfy the CAS and conflicts with zero mutation and zero audit", async () => {
  const state = makeState({ queueRow: makeExportReviewRow({ queue_status: "open" }) });
  const repository = makeRepository(state);
  const result = await repository.completeGeneratedDraftExportReview(input(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.error.code, "conflict_current_state_changed");
  assert.equal(state.queueRow.queue_status, "open");
  assert.equal(state.auditRows.length, 0);
});

test("P3-13 a missing tenant-scoped exportReviewQueueItemId returns not_found", async () => {
  const state = makeState();
  const repository = makeRepository(state);
  const result = await repository.completeGeneratedDraftExportReview(
    input({ exportReviewQueueItemId: "00000000-0000-4000-8000-000000000999" }),
    { metadataOnlyAudit: auditRecorder() },
  );
  assert.equal(result.error.code, "not_found");
});

test("P3-13 a queue item that exists only in another organization returns not_found (no unscoped lookup leak)", async () => {
  const state = makeState({ queueRow: makeExportReviewRow({ organization_id: OTHER_ORG }) });
  const repository = makeRepository(state);
  const result = await repository.completeGeneratedDraftExportReview(input(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.error.code, "not_found");
});

test("P3-13 a queue item that targets another draft conflicts rather than succeeding", async () => {
  const state = makeState({ queueRow: makeExportReviewRow({ target_object_id: OTHER_DRAFT }) });
  const repository = makeRepository(state);
  const result = await repository.completeGeneratedDraftExportReview(input(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.error.code, "conflict_current_state_changed");
  assert.equal(state.auditRows.length, 0);
});

test("P3-13 duplicate matching audits fail closed without repair", async () => {
  const state = makeState();
  const repository = makeRepository(state);
  const first = await repository.completeGeneratedDraftExportReview(input(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(first.ok, true);
  state.auditRows.push({ ...state.auditRows[0] });
  const result = await repository.completeGeneratedDraftExportReview(input(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.error.code, "conflict_current_state_changed");
});

test("P3-13 malformed audit metadata on a resolved row conflicts without repair", async () => {
  const state = makeState();
  const repository = makeRepository(state);
  await repository.completeGeneratedDraftExportReview(input(), { metadataOnlyAudit: auditRecorder() });
  state.auditRows[0].metadata.previous_queue_status = "corrupted";
  const result = await repository.completeGeneratedDraftExportReview(input(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.error.code, "conflict_current_state_changed");
});

test("P3-13 requires an injected metadataOnlyAudit dependency before attempting any transaction", async () => {
  const state = makeState();
  const repository = makeRepository(state);
  const result = await repository.completeGeneratedDraftExportReview(input(), {});
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(state.queueRow.queue_status, "in_progress");
  assert.equal(state.auditRows.length, 0);
});

test("P3-13 fails closed with system_error (not a thrown exception) when audit publication fails", async () => {
  const state = makeState();
  const repository = makeRepository(state);
  const failingAudit = { prepareMetadataOnlyAudit() { return { ok: true, async publish() { throw new Error("publish failed"); } }; } };
  const result = await repository.completeGeneratedDraftExportReview(input(), { metadataOnlyAudit: failingAudit });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "system_error");
});

test("P3-13 rolls back when the audit prepare contract is rejected", async () => {
  const state = makeState();
  const repository = makeRepository(state);
  const invalidAudit = { prepareMetadataOnlyAudit() { return { ok: false }; } };
  const result = await repository.completeGeneratedDraftExportReview(input(), { metadataOnlyAudit: invalidAudit });
  assert.equal(result.error.code, "system_error");
  assert.equal(state.auditRows.length, 0);
});

test("P3-13 audit metadata binds organization, draft, queue item, actor, expectedUpdatedAt, requested completion timestamp, previous/resulting statuses, and validator keys", async () => {
  const state = makeState();
  const repository = makeRepository(state);
  await repository.completeGeneratedDraftExportReview(input(), { metadataOnlyAudit: auditRecorder() });
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
    "requested_completion_timestamp",
    "previous_queue_status",
    "resulting_queue_status",
    "previous_review_status",
    "resulting_review_status",
    "validator_keys",
  ]));
  assert.equal(metadata.contract, __generatedContentRepositoryContract.EXPORT_REVIEW_COMPLETE_AUDIT_CONTRACT);
  assert.equal(metadata.organization_id, ORG);
  assert.equal(metadata.generated_content_draft_id, DRAFT);
  assert.equal(metadata.review_queue_item_id, EXPORT_REVIEW_QUEUE);
  assert.equal(metadata.actor_id, actorContext.actorUserId);
  assert.equal(metadata.actor_type, "human");
  assert.equal(metadata.expected_updated_at, EXPECTED_UPDATED_AT);
  assert.equal(metadata.requested_completion_timestamp, NOW);
  assert.equal(metadata.previous_queue_status, "in_progress");
  assert.equal(metadata.resulting_queue_status, "resolved");
  assert.equal(metadata.previous_review_status, "needs_gk_review");
  assert.equal(metadata.resulting_review_status, "resolved");
  assert.deepEqual(metadata.validator_keys, [...__generatedContentRepositoryContract.EXPORT_REVIEW_COMPLETE_VALIDATOR_KEYS]);
  assert.ok(!("requested_export_audience" in metadata));
  assert.ok(!("approval" in metadata));
  assert.ok(!("export_authority" in metadata));
  assert.ok(!("final_gate" in metadata));
  assert.ok(!("export_eligible" in metadata));
});

// --- service-level allowlisted DTO ---

test("P3-13 service DTO validator enforces the exact allowlist and pins the resulting resolved/resolved state", () => {
  const { isCompleteExportReviewResultDto } = __exportReviewServiceTestables;
  assert.equal(isCompleteExportReviewResultDto({
    generatedContentDraftId: DRAFT,
    exportReviewQueueItemId: EXPORT_REVIEW_QUEUE,
    queueStatus: "resolved",
    reviewStatus: "resolved",
    replayed: false,
  }), true);
  assert.equal(isCompleteExportReviewResultDto({
    generatedContentDraftId: DRAFT,
    exportReviewQueueItemId: EXPORT_REVIEW_QUEUE,
    queueStatus: "in_progress",
    reviewStatus: "needs_gk_review",
    replayed: false,
  }), false);
  assert.equal(isCompleteExportReviewResultDto({
    generatedContentDraftId: DRAFT,
    exportReviewQueueItemId: EXPORT_REVIEW_QUEUE,
    queueStatus: "resolved",
    reviewStatus: "resolved",
    replayed: false,
    extra: true,
  }), false);
});

// --- P3-06 read path widening ---

test("P3-06 reads all three export_review lifecycle profiles including the P3-13 resolved/resolved completion state", async () => {
  const { evaluateExportReviewRequestStateInTransaction } = await import("../Backend/kai/dictionary/postgresGeneratedContentRepository.js");
  for (const profile of EXPORT_REVIEW_LIFECYCLE_PROFILES) {
    const row = makeExportReviewRow({ queue_status: profile.queueStatus, review_status: profile.reviewStatus });
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
    assert.equal(result.ok, true, `expected ok for queue_status=${profile.queueStatus}/review_status=${profile.reviewStatus}`);
    assert.equal(result.data.exportReviewQueueStatus, profile.queueStatus);
    assert.equal(result.data.exportReviewStatus, profile.reviewStatus);
  }
});

test("P3-06 real packet reports resolved/resolved, exportEligible=false, draftStatus=draft after authentic P3-13 completion, and still carries a VAL-EXP-001 blocker", async () => {
  const row = makeExportReviewRow({ queue_status: "resolved", review_status: "resolved" });
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
  const baseTx = makeFakeTx(state);
  const tx = {
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, " ").trim();
      if (s.includes("FROM kai.generated_content_drafts")) {
        return {
          rows: [{
            generated_content_draft_id: DRAFT,
            generation_run_id: "00000000-0000-4000-8000-000000000801",
            organization_id: ORG,
            content_type: "evidence_summary",
            requested_audience: "internal",
            draft_status: "draft",
            review_status: "needs_gk_review",
          }],
        };
      }
      if (s.includes("FROM kai.generation_runs")) {
        return { rows: [{ generation_run_id: "00000000-0000-4000-8000-000000000801", organization_id: ORG, request_fingerprint: "c".repeat(64), content_type: "evidence_summary", requested_audience: "internal" }] };
      }
      if (s.includes("FROM kai.generated_content_blocks")) {
        return { rows: [{ generated_content_block_id: "00000000-0000-4000-8000-000000000803", generated_content_draft_id: DRAFT, organization_id: ORG, ordinal: 1, text: "Enrollment increased by 12% in 2025." }] };
      }
      if (s.includes("FROM kai.generated_content_citations")) {
        return { rows: [{ generated_content_citation_id: "00000000-0000-4000-8000-000000000804", generated_content_block_id: "00000000-0000-4000-8000-000000000803", organization_id: ORG, claim_id: "00000000-0000-4000-8000-000000000805", evidence_item_id: "00000000-0000-4000-8000-000000000806", block_ordinal: 1 }] };
      }
      if (s.includes("FROM kai.review_queue_items") && s.includes("target_object_type = $2") && s.includes("queue_type = $4")) {
        return { rows: [{ review_queue_item_id: "00000000-0000-4000-8000-000000000809", organization_id: ORG, queue_type: "generated_content_review", target_object_type: "generated_content_draft", target_object_id: DRAFT, priority: "normal", queue_status: "resolved", review_status: "resolved", assigned_to: null, due_at: null, summary: "Generated draft requires human review.", required_action: "Review citations, audience eligibility, limitations, unsupported claims, and numeric or causal assertions before any use." }] };
      }
      return baseTx.query(sql, params);
    },
  };
  const evaluator = async (_tx2, evalInput) => ({
    ok: true,
    data: {
      claim: { claim_id: evalInput.claimId, claim_type: "finding", claim_status: "proposed", claim_review_status: "approved", claim_strength: "unassessed", audience_gates: {} },
      evidence: { evidence_item_id: "00000000-0000-4000-8000-000000000806", evidence_review_status: "approved", support_strength: "unassessed", review_queue_item_id: "00000000-0000-4000-8000-000000000045", review_queue_status: "open", review_status: "approved" },
      locator: { source_locator_id: "00000000-0000-4000-8000-000000000042" },
      source: { source_id: "00000000-0000-4000-8000-000000000043", source_code: null },
      source_version: { source_version_id: "00000000-0000-4000-8000-000000000044", is_current: true },
      claim_review: { review_queue_item_id: "00000000-0000-4000-8000-000000000045", queue_status: "open", review_status: "approved" },
      candidate: { intake_source_candidate_id: "00000000-0000-4000-8000-000000000003" },
      promotion_decision: { intake_promotion_decision_id: "00000000-0000-4000-8000-000000000046" },
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
  const result = await evaluateGeneratedDraftExportReviewPacketInTransaction(tx, {
    organizationId: ORG,
    generatedContentDraftId: DRAFT,
    exportReviewQueueItemId: EXPORT_REVIEW_QUEUE,
  }, evaluator);
  assert.equal(result.ok, true);
  assert.equal(result.data.exportReviewQueueStatus, "resolved");
  assert.equal(result.data.exportReviewStatus, "resolved");
  assert.equal(result.data.draftStatus, "draft");
  assert.equal(result.data.exportEligible, false);
  assert.equal(result.data.validatorResult.severity, "blocker");
  assert.ok(result.data.validatorResult.evidence.failed_gates.includes("affirmative_human_export_authority_absent"));
  assert.ok(result.data.validatorResult.evidence.failed_gates.includes("final_export_gate_absent"));
});

// --- no forbidden state is admitted ---

test("P3-13 completion admits no approval, export-authority, final-gate, funder/public-ready, or manifest/finalization state", () => {
  const repositorySource = readFileSync(
    new URL("../Backend/kai/dictionary/postgresGeneratedContentRepository.js", import.meta.url),
    "utf8",
  );
  const completeSectionStart = repositorySource.indexOf("function validateCompleteExportReviewInput");
  const completeSectionEnd = repositorySource.indexOf("export const __generatedContentRepositoryContract");
  const completeSection = repositorySource.slice(completeSectionStart, completeSectionEnd);
  assert.ok(completeSectionStart > -1 && completeSectionEnd > completeSectionStart);
  for (const forbidden of [
    "export_authority",
    "final_export_gate",
    "finalGate",
    "affirmativeHumanExportAuthority",
    "manifest",
    "approval",
    "exportEligible",
    "funder-ready",
    "public-ready",
  ]) {
    assert.ok(!completeSection.includes(forbidden), `P3-13 completion section must not reference ${forbidden}`);
  }
});

test("P3-13 service completion section references no approval/export-authority/finalGate/manifest tokens", () => {
  const serviceSource = readFileSync(new URL("../Backend/kai/services/kaiExportReviewService.js", import.meta.url), "utf8");
  const inputSectionStart = serviceSource.indexOf("function isCompleteExportReviewInput");
  const inputSectionEnd = serviceSource.indexOf("function isMappedHumanActor");
  const resultDtoSectionStart = serviceSource.indexOf("const COMPLETE_EXPORT_REVIEW_RESULT_KEYS");
  const resultDtoSectionEnd = serviceSource.indexOf("const EXPORT_REVIEW_PACKET_KEYS");
  const fnSectionStart = serviceSource.indexOf("export async function completeGeneratedDraftExportReview");
  const fnSectionEnd = serviceSource.indexOf("export async function getGeneratedDraftExportReviewPacket");
  assert.ok(inputSectionStart > -1 && inputSectionEnd > inputSectionStart);
  assert.ok(resultDtoSectionStart > -1 && resultDtoSectionEnd > resultDtoSectionStart);
  assert.ok(fnSectionStart > -1 && fnSectionEnd > fnSectionStart);
  const completeSection = serviceSource.slice(inputSectionStart, inputSectionEnd)
    + serviceSource.slice(resultDtoSectionStart, resultDtoSectionEnd)
    + serviceSource.slice(fnSectionStart, fnSectionEnd);
  for (const forbidden of ["export_authority", "finalGate", "affirmativeHumanExportAuthority", "manifest", "approval"]) {
    assert.ok(!completeSection.includes(forbidden), `P3-13 service completion section must not reference ${forbidden}`);
  }
});

test("P3-13 exposes exactly three lifecycle profiles: open/needs_gk_review, in_progress/needs_gk_review, and resolved/resolved", () => {
  assert.deepEqual(
    EXPORT_REVIEW_LIFECYCLE_PROFILES.map((profile) => ({ ...profile })),
    [
      { queueStatus: "open", reviewStatus: "needs_gk_review" },
      { queueStatus: "in_progress", reviewStatus: "needs_gk_review" },
      { queueStatus: "resolved", reviewStatus: "resolved" },
    ],
  );
});
