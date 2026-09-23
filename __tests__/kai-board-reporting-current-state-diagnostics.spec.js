import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateBoardReportingPacketMembershipInTransaction,
  evaluateGrantResponsePacketMembershipInTransaction,
  evaluateGeneratedDraftReviewPacketInTransaction,
  createPostgresGeneratedContentRepository,
  RollbackResultError,
} from "../Backend/kai/dictionary/postgresGeneratedContentRepository.js";

// evaluateBoardReportingPacketMembershipInTransaction/toReviewPacket signal a
// mid-map citation mismatch (F4) via a synchronous throw, exactly like the
// existing createPostgresGeneratedContentRepository wrapper's own
// `if (error instanceof RollbackResultError) return error.result;` catch -
// tests that call the in-transaction function directly (not through that
// wrapper) must unwrap the same way to observe the structured result.
async function runInTransactionFunction(fn) {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof RollbackResultError) return error.result;
    throw error;
  }
}

// P0-BOARD-CURRENT-001 diagnostic discrimination: five distinct
// conflict_current_state_changed predicates on the Board Reporting
// getBoardReportingPacket read path collapse into the same public 409
// today. These tests prove each predicate now attaches its own bounded,
// safe blocking_reason while the HTTP status (409), public error code
// (conflict_current_state_changed), and fail-closed behavior are all
// unchanged - and that Grant Response Packet / the single-draft review
// packet read (which share the same underlying functions) are unaffected.

const ORG = "00000000-0000-4000-8000-000000000001";
const ENGAGEMENT = "00000000-0000-4000-8000-000000000701";
const DRAFT = "00000000-0000-4000-8000-000000000911";
const RUN = "00000000-0000-4000-8000-000000000912";
const BLOCK = "00000000-0000-4000-8000-000000000913";
const CITATION = "00000000-0000-4000-8000-000000000914";
const QUEUE = "00000000-0000-4000-8000-000000000915";
const CLAIM = "00000000-0000-4000-8000-000000000916";
const EVIDENCE = "00000000-0000-4000-8000-000000000917";
const OTHER_EVIDENCE = "00000000-0000-4000-8000-000000000920";
const SOURCE = "00000000-0000-4000-8000-000000000918";
const SOURCE_VERSION = "00000000-0000-4000-8000-000000000919";

function baseDraftRow() {
  return {
    generated_content_draft_id: DRAFT,
    generation_run_id: RUN,
    organization_id: ORG,
    content_type: "evidence_summary",
    requested_audience: "internal",
    draft_status: "draft",
    review_status: "needs_gk_review",
  };
}

function baseRunRow() {
  return {
    generation_run_id: RUN,
    organization_id: ORG,
    engagement_id: ENGAGEMENT,
    request_fingerprint: "a".repeat(64),
    content_type: "evidence_summary",
    requested_audience: "internal",
  };
}

function baseBlockRow() {
  return {
    generated_content_block_id: BLOCK,
    generated_content_draft_id: DRAFT,
    organization_id: ORG,
    ordinal: 1,
    text: "Board Reporting diagnostic fixture block.",
  };
}

function baseCitationRow() {
  return {
    generated_content_citation_id: CITATION,
    generated_content_block_id: BLOCK,
    organization_id: ORG,
    claim_id: CLAIM,
    evidence_item_id: EVIDENCE,
    block_ordinal: 1,
  };
}

function baseQueueRow() {
  return {
    review_queue_item_id: QUEUE,
    organization_id: ORG,
    queue_type: "generated_content_review",
    target_object_type: "generated_content_draft",
    target_object_id: DRAFT,
    priority: "medium",
    queue_status: "resolved",
    review_status: "resolved",
    assigned_to: null,
    due_at: null,
    summary: "Generated draft requires human review.",
    required_action: "Review citations, audience eligibility, limitations, unsupported claims, and numeric or causal assertions before any use.",
    updated_at: "2026-08-06T09:00:00.000Z",
  };
}

function firstArrayParam(params) {
  return params.find((param) => Array.isArray(param));
}

// siblingDraftRows lets F1 (REVIEW_GRAPH_INVALID) simulate a corrupted
// sibling-draft graph (validateImmutableGraphRows requires exactly one
// sibling row per generation run) without touching any other predicate.
function makeTx({ siblingDraftRows = [baseDraftRow()] } = {}) {
  return {
    async query(sql, params = []) {
      if (/FROM kai\.engagements\b/.test(sql)) {
        return { rows: [{ engagement_id: ENGAGEMENT, organization_id: ORG }] };
      }
      if (/JOIN kai\.generation_runs r\b/.test(sql)) {
        return { rows: [{ generated_content_draft_id: DRAFT }] };
      }
      if (/FROM kai\.generated_content_drafts\b/.test(sql) && /WHERE organization_id/.test(sql) && /ANY/.test(sql)) {
        const draftIds = firstArrayParam(params);
        return { rows: draftIds.includes(DRAFT) ? [baseDraftRow()] : [] };
      }
      if (/FROM kai\.generation_runs\b/.test(sql) && !/JOIN/.test(sql)) {
        return { rows: [baseRunRow()] };
      }
      if (/FROM kai\.generated_content_drafts\b/.test(sql) && /WHERE generation_run_id = ANY/.test(sql)) {
        return { rows: siblingDraftRows };
      }
      if (/FROM kai\.generated_content_blocks\b/.test(sql)) {
        return { rows: [baseBlockRow()] };
      }
      if (/FROM kai\.generated_content_citations\b/.test(sql)) {
        return { rows: [baseCitationRow()] };
      }
      if (/FROM kai\.review_queue_items\b/.test(sql) && /blocked_reason/.test(sql)) {
        return { rows: [] };
      }
      if (/FROM kai\.review_queue_items\b/.test(sql)) {
        return { rows: [baseQueueRow()] };
      }
      throw new Error(`unexpected query in board-reporting current-state diagnostics test: ${sql}`);
    },
  };
}

function traceabilityData(overrides = {}) {
  return {
    claim: { claim_id: CLAIM, claim_type: "finding", claim_status: "proposed", claim_review_status: "approved", claim_strength: "strong", audience_gates: {} },
    evidence: { evidence_item_id: EVIDENCE, evidence_review_status: "approved", support_strength: "strong", review_queue_item_id: "00000000-0000-4000-8000-000000000601", review_queue_status: "closed", review_status: "approved", updated_at: "2026-08-06T09:00:00.000Z", sensitivity_level: "unknown" },
    locator: { source_locator_id: "00000000-0000-4000-8000-000000000602" },
    source: { source_id: SOURCE, source_code: null },
    source_version: { source_version_id: SOURCE_VERSION, is_current: true },
    claim_review: { review_queue_item_id: "00000000-0000-4000-8000-000000000603", queue_status: "closed", review_status: "approved" },
    evidence_review_decision: { decision_id: "00000000-0000-4000-8000-000000000606", decision_outcome: "accepted" },
    claim_review_decision: { decision_id: "00000000-0000-4000-8000-000000000607", decision_outcome: "accepted", approved_audiences: ["internal", "funder"] },
    candidate: { intake_source_candidate_id: "00000000-0000-4000-8000-000000000604" },
    promotion_decision: { intake_promotion_decision_id: "00000000-0000-4000-8000-000000000605" },
    dimensions: {},
    gap_items: [],
    client_followup_workflows: [],
    potential_conflict_groups: [],
    graph_relationships: [
      { relationship_type: "claim_supported_by_evidence", from_object_type: "claim", from_object_id: CLAIM, to_object_type: "evidence_item", to_object_id: EVIDENCE },
    ],
    graph_trace_completeness: { complete: true, missing_relationship_types: [], invalid_relationship_count: 0 },
    requestedAudience: "internal",
    eligible: true,
    blockerCodes: [],
    affectedDimensionKeys: [],
    affectedObjectIds: [],
    truncated: false,
    ...overrides,
  };
}

const okEvaluator = async () => ({ ok: true, data: traceabilityData(), error: null });

function assertBoardReportingBlocker(result, validatorKey, blockingReason) {
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict_current_state_changed");
  assert.equal(result.error.status, 409);
  assert.equal(Array.isArray(result.blockers), true);
  assert.equal(result.blockers.length, 1);
  assert.deepEqual(result.blockers[0], {
    validator_key: validatorKey,
    severity: "blocker",
    blocking_reason: blockingReason,
  });
  const serialized = JSON.stringify(result);
  for (const forbidden of [ORG, ENGAGEMENT, DRAFT, CLAIM, EVIDENCE, "SELECT", "kai.claims"]) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} must not leak into the diagnostic response`);
  }
}

test("Board Reporting current-state diagnostics: successful read is unaffected by the instrumentation", async () => {
  const result = await evaluateBoardReportingPacketMembershipInTransaction(makeTx(), { organizationId: ORG, engagementId: ENGAGEMENT }, okEvaluator);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.drafts.length, 1);
  assert.equal(result.data.drafts[0].generatedContentDraftId, DRAFT);
});

test("F1 REVIEW_GRAPH_INVALID: validateReviewPacketRows === false attaches VAL-BOARD-CURRENT-001 / board_reporting_review_graph_invalid", async () => {
  // Two sibling-draft rows for the same generation run violates
  // validateImmutableGraphRows' exactly-one-sibling invariant, so
  // validateReviewPacketRows returns false (not "system_error").
  const tx = makeTx({ siblingDraftRows: [baseDraftRow(), { ...baseDraftRow(), generated_content_draft_id: "00000000-0000-4000-8000-000000000999" }] });
  const result = await evaluateBoardReportingPacketMembershipInTransaction(tx, { organizationId: ORG, engagementId: ENGAGEMENT }, okEvaluator);
  assertBoardReportingBlocker(result, "VAL-BOARD-CURRENT-001", "board_reporting_review_graph_invalid");
});

test("F2 TRACEABILITY_READ_FAILED: evaluator ok:false attaches VAL-BOARD-CURRENT-002 / board_reporting_traceability_read_failed", async () => {
  const failingEvaluator = async () => ({ ok: false, data: null, error: { code: "conflict_current_state_changed" } });
  const result = await evaluateBoardReportingPacketMembershipInTransaction(makeTx(), { organizationId: ORG, engagementId: ENGAGEMENT }, failingEvaluator);
  assertBoardReportingBlocker(result, "VAL-BOARD-CURRENT-002", "board_reporting_traceability_read_failed");
});

test("F3 TRACEABILITY_CONTRACT_INVALID: evaluator ok:true with a DTO that fails validateTraceabilityData attaches VAL-BOARD-CURRENT-003 / board_reporting_traceability_contract_invalid", async () => {
  const malformedEvaluator = async () => ({ ok: true, data: traceabilityData({ eligible: "not-a-boolean" }), error: null });
  const result = await evaluateBoardReportingPacketMembershipInTransaction(makeTx(), { organizationId: ORG, engagementId: ENGAGEMENT }, malformedEvaluator);
  assertBoardReportingBlocker(result, "VAL-BOARD-CURRENT-003", "board_reporting_traceability_contract_invalid");
});

test("F4 CITATION_EVIDENCE_MISMATCH: stored citation evidence_item_id differing from the evaluated authoritative evidence attaches VAL-BOARD-CURRENT-004 / board_reporting_citation_evidence_mismatch", async () => {
  const mismatchedEvaluator = async () => ({ ok: true, data: traceabilityData({ evidence: { ...traceabilityData().evidence, evidence_item_id: OTHER_EVIDENCE } }), error: null });
  const result = await runInTransactionFunction(() => evaluateBoardReportingPacketMembershipInTransaction(makeTx(), { organizationId: ORG, engagementId: ENGAGEMENT }, mismatchedEvaluator));
  assertBoardReportingBlocker(result, "VAL-BOARD-CURRENT-004", "board_reporting_citation_evidence_mismatch");
});

test("F5 POSTGRES_TRANSACTION_STATE_ERROR: a { code: \"25001\" } transaction failure attaches VAL-BOARD-CURRENT-005 / board_reporting_pg_transaction_state_error", async () => {
  const repository = createPostgresGeneratedContentRepository({
    runInTransaction: async () => {
      const error = new Error("could not serialize access due to read/write dependencies");
      error.code = "25001";
      throw error;
    },
  });
  const result = await repository.getBoardReportingPacket({ organizationId: ORG, engagementId: ENGAGEMENT });
  assertBoardReportingBlocker(result, "VAL-BOARD-CURRENT-005", "board_reporting_pg_transaction_state_error");
});

test("Grant Response Packet membership (shared toReviewPacket/validateReviewPacketRows path) is not instrumented by the Board Reporting diagnostic", async () => {
  const tx = makeTx({ siblingDraftRows: [baseDraftRow(), { ...baseDraftRow(), generated_content_draft_id: "00000000-0000-4000-8000-000000000999" }] });
  const result = await evaluateGrantResponsePacketMembershipInTransaction(tx, { organizationId: ORG, engagementId: ENGAGEMENT }, okEvaluator);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict_current_state_changed");
  assert.equal(result.error.status, 409);
  assert.equal(result.blockers, undefined);
});

test("Single-draft review-packet read (evaluateGeneratedDraftReviewPacketInTransaction) is not instrumented by the Board Reporting diagnostic", async () => {
  const tx = {
    async query(sql, params = []) {
      if (/FROM kai\.generated_content_drafts\b/.test(sql) && /WHERE organization_id/.test(sql) && /generated_content_draft_id = \$2/.test(sql)) {
        return { rows: [baseDraftRow()] };
      }
      if (/FROM kai\.generation_runs\b/.test(sql)) {
        return { rows: [baseRunRow()] };
      }
      if (/FROM kai\.generated_content_drafts\b/.test(sql) && /generation_run_id = \$1/.test(sql)) {
        // Two sibling rows for the same run - same F1 predicate, false.
        return { rows: [baseDraftRow(), { ...baseDraftRow(), generated_content_draft_id: "00000000-0000-4000-8000-000000000999" }] };
      }
      if (/FROM kai\.generated_content_blocks\b/.test(sql)) {
        return { rows: [baseBlockRow()] };
      }
      if (/FROM kai\.generated_content_citations\b/.test(sql)) {
        return { rows: [baseCitationRow()] };
      }
      if (/FROM kai\.review_queue_items\b/.test(sql) && /blocked_reason/.test(sql)) {
        return { rows: [] };
      }
      if (/FROM kai\.review_queue_items\b/.test(sql)) {
        return { rows: [baseQueueRow()] };
      }
      throw new Error(`unexpected query in single-draft review-packet fallback test: ${sql}`);
    },
  };
  const result = await evaluateGeneratedDraftReviewPacketInTransaction(tx, { organizationId: ORG, generatedContentDraftId: DRAFT }, okEvaluator);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict_current_state_changed");
  assert.equal(result.error.status, 409);
  assert.equal(result.blockers, undefined);
});
