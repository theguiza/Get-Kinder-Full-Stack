import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  getGeneratedDraftExportReviewPacket,
  __exportReviewServiceTestables,
} from "../Backend/kai/services/kaiExportReviewService.js";
import {
  evaluateGeneratedDraftExportReviewPacketInTransaction,
  evaluateExportReviewRequestStateInTransaction,
  __generatedContentRepositoryContract,
} from "../Backend/kai/dictionary/postgresGeneratedContentRepository.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const RUN = "00000000-0000-4000-8000-000000000701";
const DRAFT = "00000000-0000-4000-8000-000000000702";
const BLOCK = "00000000-0000-4000-8000-000000000703";
const CITATION = "00000000-0000-4000-8000-000000000704";
const CLAIM = "00000000-0000-4000-8000-000000000705";
const EVIDENCE = "00000000-0000-4000-8000-000000000706";
const SOURCE = "00000000-0000-4000-8000-000000000707";
const SOURCE_VERSION = "00000000-0000-4000-8000-000000000708";
const GENERATED_CONTENT_QUEUE = "00000000-0000-4000-8000-000000000709";
const EXPORT_REVIEW_QUEUE = "00000000-0000-4000-8000-000000000710";
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
    actorContext,
    ...overrides,
  };
}

function txInput(overrides = {}) {
  return {
    organizationId: ORG,
    generatedContentDraftId: DRAFT,
    exportReviewQueueItemId: EXPORT_REVIEW_QUEUE,
    ...overrides,
  };
}

function makeState({ currentUseEligible = true } = {}) {
  return {
    run: {
      generation_run_id: RUN,
      organization_id: ORG,
      request_fingerprint: "d".repeat(64),
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
      text: "Visible export-review packet text.",
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
      queue_type: "generated_content_review",
      target_object_type: "generated_content_draft",
      target_object_id: DRAFT,
      priority: "normal",
      queue_status: "resolved",
      review_status: "resolved",
      assigned_to: null,
      due_at: null,
      summary: "Generated draft requires human review.",
      required_action: "Review citations, audience eligibility, limitations, unsupported claims, and numeric or causal assertions before any use.",
    }],
    exportReviewQueues: [{
      review_queue_item_id: EXPORT_REVIEW_QUEUE,
      organization_id: ORG,
      queue_type: "export_review",
      target_object_type: "generated_content_draft",
      target_object_id: DRAFT,
      priority: "normal",
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
      updated_at: new Date("2026-08-06T09:00:00.000Z"),
    }],
    auditRows: [{
      organization_id: ORG,
      operation: "export_review_requested",
      outcome: "success",
      metadata: {
        contract: "p3_05_export_review_request_v1",
        organization_id: ORG,
        generated_content_draft_id: DRAFT,
        review_queue_item_id: EXPORT_REVIEW_QUEUE,
        requested_export_audience: "internal",
        actor_id: "90000000-0000-4000-8000-000000000001",
        actor_type: "human",
        requested_timestamp: "2026-08-06T10:00:00.000Z",
        validator_key: "VAL-EXP-001",
        failed_gates: [...__generatedContentRepositoryContract.EXPORT_REVIEW_READINESS_FAILED_GATES],
      },
    }],
    currentUseEligible,
    writes: [],
  };
}

function evaluator(state) {
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
      eligible: state.currentUseEligible,
      blockerCodes: state.currentUseEligible ? [] : ["claim_review_unresolved"],
      affectedDimensionKeys: state.currentUseEligible ? [] : ["missingness"],
      affectedObjectIds: state.currentUseEligible ? [] : ["10000000-0000-4000-8000-000000000025"],
      truncated: false,
    },
    error: null,
  });
}

function makeTx(state) {
  return {
    state,
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, " ").trim();
      if (/^(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b/i.test(s)) {
        state.writes.push(s);
        throw new Error(`P3-06 fake transaction rejected mutation: ${s}`);
      }
      if (s.startsWith("SET TRANSACTION ISOLATION LEVEL")) return { rows: [] };
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
      if (s.includes("FROM kai.review_queue_items") && s.includes("review_queue_item_id = $2::uuid")) {
        const [organizationId, queueId] = params;
        return { rows: state.exportReviewQueues.filter((q) => q.organization_id === organizationId && q.review_queue_item_id === queueId) };
      }
      if (s.includes("FROM kai.review_queue_items") && s.includes("target_object_type = $2") && s.includes("queue_type = $4")) {
        const [organizationId, targetType, targetId, queueType] = params;
        return { rows: state.genContentReviewQueues.filter((q) => q.organization_id === organizationId && q.target_object_type === targetType && q.target_object_id === targetId && q.queue_type === queueType) };
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

function packetDto(overrides = {}) {
  const state = makeState();
  return {
    generationRunId: RUN,
    generatedContentDraftId: DRAFT,
    contentType: "evidence_summary",
    draftStatus: "draft",
    requestedExportAudience: "internal",
    generatedContentReviewQueueStatus: "resolved",
    generatedContentReviewStatus: "resolved",
    exportReviewQueueItemId: EXPORT_REVIEW_QUEUE,
    exportReviewQueueStatus: "open",
    exportReviewStatus: "needs_gk_review",
    currentUseEligible: true,
    exportEligible: false,
    validatorResult: {
      validator_key: "VAL-EXP-001",
      severity: "blocker",
      object_type: "generated_content_draft",
      object_code: "export_manifest_eligibility",
      object_id: DRAFT,
      message: "Export manifest eligibility gates failed.",
      blocking_reason: "export_manifest_not_eligible",
      required_fix: null,
      evidence: { failed_gates: [...__generatedContentRepositoryContract.EXPORT_REVIEW_READINESS_FAILED_GATES] },
    },
    blocks: [{
      ordinal: 1,
      text: state.blocks[0].text,
      citations: [{
        claimId: CLAIM,
        evidenceItemId: EVIDENCE,
        sourceId: SOURCE,
        sourceVersionId: SOURCE_VERSION,
        supportStrength: "unassessed",
        claimReviewStatus: "approved",
        evidenceReviewStatus: "approved",
        currentEligible: true,
        blockerCodes: [],
        affectedDimensionKeys: [],
        affectedObjectIds: [],
      }],
    }],
    exportReviewUpdatedAt: "2026-08-06T09:00:00.000Z",
    ...overrides,
  };
}

test("P3-06 service gates precede database-capable loading and require exact input, mapped human, active tenant membership, and gk_admin", async () => {
  let transactionCalls = 0;
  const deps = {
    env: enabledEnv,
    runInTransaction: async () => { transactionCalls += 1; throw new Error("must not call"); },
    evaluatePacket: async () => { throw new Error("must not call"); },
    evaluator: async () => { throw new Error("must not call"); },
  };
  assert.equal((await getGeneratedDraftExportReviewPacket(input(), { ...deps, env: {} })).error.code, "feature_disabled");
  assert.equal((await getGeneratedDraftExportReviewPacket(input(), { ...deps, env: { KAI_SPRINT2_ENABLED: "true" } })).error.code, "feature_disabled");
  assert.equal((await getGeneratedDraftExportReviewPacket(input(), { ...deps, env: { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" } })).error.code, "feature_disabled");
  assert.equal((await getGeneratedDraftExportReviewPacket({ ...input(), extra: true }, deps)).error.code, "validation_blocker");
  assert.equal((await getGeneratedDraftExportReviewPacket(input({ generatedContentDraftId: "not-a-uuid" }), deps)).error.code, "validation_blocker");
  assert.equal((await getGeneratedDraftExportReviewPacket(input({ actorContext: { actorType: "system", actorUserId: actorContext.actorUserId } }), deps)).error.code, "authorization_denied");
  assert.equal((await getGeneratedDraftExportReviewPacket(input({ organizationId: OTHER_ORG }), deps)).error.code, "authorization_denied");
  assert.equal((await getGeneratedDraftExportReviewPacket(input({ actorContext: { ...actorContext, organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" }] } }), deps)).error.code, "authorization_denied");
  assert.equal(transactionCalls, 0);
});

test("P3-06 service lazy-loads database-capable modules only after gates, per source order", () => {
  const source = readFileSync(new URL("../Backend/kai/services/kaiExportReviewService.js", import.meta.url), "utf8");
  const topLevelImports = source.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(topLevelImports.every((line) => !/postgresGeneratedContentRepository|postgresClaimTraceabilityRepository|kaiDb\.js|"pg"/.test(line)));
  assert.ok(source.indexOf("isKaiSprint2Enabled") < source.indexOf("createDefaultExportReviewPacketDependencies"));
});

test("P3-06 service runs both shared evaluators in the same repeatable-read read-only snapshot", async () => {
  const calls = [];
  const tx = { async query(sql) { calls.push(sql); return { rows: [] }; } };
  const result = await getGeneratedDraftExportReviewPacket(input(), {
    env: enabledEnv,
    runInTransaction: async (callback) => callback(tx),
    evaluatePacket: async (seenTx, seenInput, seenEvaluator) => {
      calls.push("evaluatePacket");
      assert.equal(seenTx, tx);
      assert.equal(seenEvaluator, evaluator);
      assert.deepEqual(seenInput, {
        organizationId: ORG,
        generatedContentDraftId: DRAFT,
        exportReviewQueueItemId: EXPORT_REVIEW_QUEUE,
      });
      return { ok: true, data: packetDto(), error: null };
    },
    evaluator,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY", "evaluatePacket"]);
});

test("P3-06 authoritative evaluator accepts authentic P3-05 state and returns draft, citations, and canonical validator output", async () => {
  const state = makeState();
  const result = await evaluateGeneratedDraftExportReviewPacketInTransaction(makeTx(state), {
    organizationId: ORG,
    generatedContentDraftId: DRAFT,
    exportReviewQueueItemId: EXPORT_REVIEW_QUEUE,
  }, evaluator(state));
  assert.equal(result.ok, true);
  assert.equal(result.data.generatedContentReviewQueueStatus, "resolved");
  assert.equal(result.data.exportReviewQueueStatus, "open");
  assert.equal(result.data.exportEligible, false);
  assert.deepEqual(result.data.validatorResult.evidence.failed_gates, [
    "generated_content_still_draft",
    "affirmative_human_export_authority_absent",
    "final_export_gate_absent",
  ]);
  assert.equal(result.data.blocks[0].citations[0].sourceId, SOURCE);
  assert.equal(result.data.exportReviewUpdatedAt, "2026-08-06T09:00:00.000Z");
  assert.deepEqual(state.writes, []);
});

test("P3-06 current eligibility deterioration remains visible but export-ineligible", async () => {
  const state = makeState({ currentUseEligible: false });
  const result = await evaluateGeneratedDraftExportReviewPacketInTransaction(makeTx(state), txInput(), evaluator(state));
  assert.equal(result.ok, true);
  assert.equal(result.data.currentUseEligible, false);
  assert.equal(result.data.exportEligible, false);
  assert.ok(result.data.validatorResult.evidence.failed_gates.includes("current_use_ineligible"));
});

test("P3-06 accepts only resolved/resolved generated-content review state", async () => {
  for (const [queueStatus, reviewStatus] of [["open", "needs_gk_review"], ["resolved", "needs_gk_review"], ["open", "resolved"]]) {
    const state = makeState();
    state.genContentReviewQueues[0].queue_status = queueStatus;
    state.genContentReviewQueues[0].review_status = reviewStatus;
    const result = await evaluateGeneratedDraftExportReviewPacketInTransaction(makeTx(state), txInput(), evaluator(state));
    assert.equal(result.error.code, "conflict_current_state_changed");
  }
});

test("P3-06 P3-05 evaluator requires complete queue-plus-audit authority and fails closed for malformed scoped state", async () => {
  const cases = [
    (state) => { state.exportReviewQueues = []; },
    (state) => { state.auditRows = []; },
    (state) => { state.auditRows.push({ ...state.auditRows[0], metadata: { ...state.auditRows[0].metadata } }); },
    (state) => { state.exportReviewQueues[0].target_object_id = "00000000-0000-4000-8000-000000000799"; },
    (state) => { state.auditRows[0].metadata.requested_export_audience = "public"; },
    (state) => { state.auditRows[0].metadata.failed_gates = [...state.auditRows[0].metadata.failed_gates].reverse(); },
    (state) => { state.exportReviewQueues[0].queue_metadata = { raw: true }; },
  ];
  for (const mutate of cases) {
    const state = makeState();
    mutate(state);
    const result = await evaluateGeneratedDraftExportReviewPacketInTransaction(makeTx(state), txInput(), evaluator(state));
    assert.equal(result.ok, false);
    assert.ok(["not_found", "conflict_current_state_changed"].includes(result.error.code));
  }
});

test("P3-06 absent tenant-scoped draft or queue returns not_found without unscoped probing", async () => {
  const missingDraft = makeState();
  missingDraft.draft = null;
  assert.equal((await evaluateGeneratedDraftExportReviewPacketInTransaction(makeTx(missingDraft), txInput(), evaluator(missingDraft))).error.code, "not_found");

  const missingQueue = makeState();
  assert.equal((await evaluateExportReviewRequestStateInTransaction(makeTx(missingQueue), txInput({ exportReviewQueueItemId: "00000000-0000-4000-8000-000000000999" }))).error.code, "not_found");

  const crossTenantQueue = makeState();
  crossTenantQueue.exportReviewQueues[0].organization_id = OTHER_ORG;
  assert.equal((await evaluateExportReviewRequestStateInTransaction(makeTx(crossTenantQueue), txInput())).error.code, "not_found");
});

test("P3-06 service top-level, block, citation, and validator allowlists reject DTO drift with data:null", async () => {
  const injections = [
    (dto) => ({ ...dto, raw: {} }),
    (dto) => ({ ...dto, auditMetadata: {} }),
    (dto) => ({ ...dto, actor: {} }),
    (dto) => ({ ...dto, intakeFileContext: {} }),
    (dto) => ({ ...dto, storagePath: "blocked" }),
    (dto) => ({ ...dto, filename: "blocked.pdf" }),
    (dto) => ({ ...dto, prompt: "blocked" }),
    (dto) => ({ ...dto, credential: "blocked" }),
    (dto) => ({ ...dto, internalNote: "blocked" }),
    (dto) => ({ ...dto, blocks: [{ ...dto.blocks[0], rawRow: {} }] }),
    (dto) => ({ ...dto, blocks: [{ ...dto.blocks[0], citations: [{ ...dto.blocks[0].citations[0], filename: "blocked.pdf" }] }] }),
    (dto) => ({ ...dto, validatorResult: { ...dto.validatorResult, raw: true } }),
  ];
  for (const inject of injections) {
    const result = await getGeneratedDraftExportReviewPacket(input(), {
      env: enabledEnv,
      runInTransaction: async (callback) => callback({ async query() { return { rows: [] }; } }),
      evaluatePacket: async () => ({ ok: true, data: inject(packetDto()), error: null }),
      evaluator: async () => {},
    });
    assert.equal(result.error.code, "system_error");
    assert.equal(result.data, null);
  }
  assert.equal(__exportReviewServiceTestables.isGeneratedDraftExportReviewPacketDto(packetDto()), true);
});

test("P3-06 service maps scoped conflicts and not_found without returning internal data", async () => {
  const notFound = await getGeneratedDraftExportReviewPacket(input(), {
    env: enabledEnv,
    runInTransaction: async (callback) => callback({ async query() { return { rows: [] }; } }),
    evaluatePacket: async () => ({ ok: false, data: null, error: { code: "not_found" } }),
    evaluator: async () => {},
  });
  assert.equal(notFound.error.code, "not_found");
  assert.equal(notFound.data, null);

  const conflict = await getGeneratedDraftExportReviewPacket(input(), {
    env: enabledEnv,
    runInTransaction: async (callback) => callback({ async query() { return { rows: [] }; } }),
    evaluatePacket: async () => ({ ok: false, data: null, error: { code: "conflict_current_state_changed" } }),
    evaluator: async () => {},
  });
  assert.equal(conflict.error.code, "conflict_current_state_changed");
  assert.equal(conflict.data, null);
});

test("P3-11 packet exposes the authoritative exportReviewUpdatedAt for an open/needs_gk_review queue row sourced from the single loaded queue row", async () => {
  const state = makeState();
  state.exportReviewQueues[0].queue_status = "open";
  state.exportReviewQueues[0].review_status = "needs_gk_review";
  state.exportReviewQueues[0].updated_at = new Date("2026-08-06T09:00:00.000Z");
  const result = await evaluateGeneratedDraftExportReviewPacketInTransaction(makeTx(state), txInput(), evaluator(state));
  assert.equal(result.ok, true);
  assert.equal(result.data.exportReviewQueueStatus, "open");
  assert.equal(result.data.exportReviewStatus, "needs_gk_review");
  assert.equal(result.data.exportReviewUpdatedAt, "2026-08-06T09:00:00.000Z");
});

test("P3-11 packet exposes the authoritative exportReviewUpdatedAt for an in_progress/needs_gk_review queue row", async () => {
  const state = makeState();
  state.exportReviewQueues[0].queue_status = "in_progress";
  state.exportReviewQueues[0].review_status = "needs_gk_review";
  state.exportReviewQueues[0].updated_at = new Date("2026-08-06T10:05:00.000Z");
  const result = await evaluateGeneratedDraftExportReviewPacketInTransaction(makeTx(state), txInput(), evaluator(state));
  assert.equal(result.ok, true);
  assert.equal(result.data.exportReviewQueueStatus, "in_progress");
  assert.equal(result.data.exportReviewStatus, "needs_gk_review");
  assert.equal(result.data.exportReviewUpdatedAt, "2026-08-06T10:05:00.000Z");
});

test("P3-11 the P3-06 DTO allowlist contains exactly one new field beyond the accepted P3-06 shape", () => {
  const state = makeState();
  return evaluateGeneratedDraftExportReviewPacketInTransaction(makeTx(state), txInput(), evaluator(state)).then((result) => {
    assert.equal(result.ok, true);
    assert.deepEqual([...Object.keys(result.data)].sort(), [
      "blocks",
      "contentType",
      "currentUseEligible",
      "draftStatus",
      "exportEligible",
      "exportReviewQueueItemId",
      "exportReviewQueueStatus",
      "exportReviewStatus",
      "exportReviewUpdatedAt",
      "generatedContentDraftId",
      "generatedContentReviewQueueStatus",
      "generatedContentReviewStatus",
      "generationRunId",
      "requestedExportAudience",
      "validatorResult",
    ]);
  });
});

test("P3-11 missing or malformed internal updated_at fails closed with system_error and data:null", async () => {
  for (const malformedUpdatedAt of [null, undefined, "not-a-timestamp", new Date("not-a-date")]) {
    const state = makeState();
    state.exportReviewQueues[0].updated_at = malformedUpdatedAt;
    const result = await getGeneratedDraftExportReviewPacket(input(), {
      env: enabledEnv,
      runInTransaction: async (callback) => callback(makeTx(state)),
      evaluatePacket: evaluateGeneratedDraftExportReviewPacketInTransaction,
      evaluator: evaluator(state),
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "system_error");
    assert.equal(result.data, null);
  }
});

test("P3-11 an authentic exportReviewUpdatedAt still passes the full service DTO allowlist", async () => {
  const state = makeState();
  const result = await getGeneratedDraftExportReviewPacket(input(), {
    env: enabledEnv,
    runInTransaction: async (callback) => callback(makeTx(state)),
    evaluatePacket: evaluateGeneratedDraftExportReviewPacketInTransaction,
    evaluator: evaluator(state),
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.exportReviewUpdatedAt, "2026-08-06T09:00:00.000Z");
});

test("P3-06 read path has no write, audit publication, queue transition, authority, final gate, manifest, file, route, UI, or listener wiring", () => {
  const serviceSource = readFileSync(new URL("../Backend/kai/services/kaiExportReviewService.js", import.meta.url), "utf8");
  const repoSource = readFileSync(new URL("../Backend/kai/dictionary/postgresGeneratedContentRepository.js", import.meta.url), "utf8");
  const serviceSlice = serviceSource.slice(serviceSource.indexOf("export async function getGeneratedDraftExportReviewPacket"));
  const repoSlice = repoSource.slice(repoSource.indexOf("export async function evaluateExportReviewRequestStateInTransaction"), repoSource.indexOf("export function createPostgresGeneratedContentRepository"));
  assert.doesNotMatch(`${serviceSlice}\n${repoSlice}`, /\bINSERT\b|\bUPDATE\b|\bDELETE\b|prepareMetadataOnlyAudit|publish\(|create.*manifest|write.*file|final_export_gate|export_authority|storage_path|signed_url|router\.|listener|assistant/i);
});
