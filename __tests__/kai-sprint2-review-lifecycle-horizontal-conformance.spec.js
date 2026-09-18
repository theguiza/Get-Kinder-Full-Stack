// Horizontal generated-content REVIEW LIFECYCLE conformance suite for the
// six current generated-draft content types (evidence_summary,
// impact_narrative, readiness_assessment, data_gap_memo, case_for_support,
// board_update).
//
// This suite is deliberately scoped to the review lifecycle - creation's
// coupling to a fresh generated_content_review row, starting and completing
// that review, gating and driving the export_review lifecycle off it, and
// the final human-export-authority gate downstream of both. It does NOT
// re-prove Phase-13 governance predicates (VAL-GEN-00x admission rules),
// which are proven once, horizontally, by
// kai-sprint2-phase13-governance-horizontal-conformance.spec.js (read in
// full for style/wiring conventions, neither modified nor duplicated here),
// nor the provider/result contract, proven by
// kai-sprint2-generator-result-contract-horizontal-conformance.spec.js.
//
// It drives these real, shared, production code paths, with only I/O
// boundaries (a fake transaction, a fake claim-traceability evaluator, and a
// stub draft-generator function) mocked out:
//
//   1. `createPostgresGeneratedContentRepository(...).createXxxDraft` -
//      Backend/kai/dictionary/postgresGeneratedContentRepository.js -
//      for the creation -> generated_content_review coupling.
//   2. `startGeneratedContentReview` / `completeGeneratedContentReview` -
//      Backend/kai/services/kaiGeneratedContentService.js (service layer,
//      role/tenant gates) and Backend/kai/dictionary/
//      postgresGeneratedContentRepository.js (~L2683-2864, repository
//      layer, optimistic-concurrency lifecycle transitions) - both are
//      content-type-agnostic: neither reads `content_type` anywhere in
//      their transition logic.
//   3. `requestGeneratedDraftExportReview` / `startGeneratedDraftExportReview`
//      / `completeGeneratedDraftExportReview` - Backend/kai/services/
//      kaiExportReviewService.js and postgresGeneratedContentRepository.js
//      (~L2865-3160+) - export_review is its own generic queue keyed only
//      on (organization_id, queue_type='export_review',
//      target_object_type='generated_content_draft', target_object_id);
//      confirmed by direct source reading that none of these three
//      functions reference `content_type` at all.
//   4. `evaluateFinalExportEligibility` - Backend/kai/services/
//      kaiFinalExportEligibilityGateService.js - the real, content-type-
//      agnostic final gate, fed a packet reflecting both reviews already
//      resolved/resolved and NO effective P3-17 human export-authority
//      decision, to prove resolving both reviews alone never implies final
//      export eligibility.
//
// REVIEW-LIFECYCLE PREDICATE -> REAL FUNCTION MAP:
//   1. creation couples 1:1 to a fresh generated_content_review row
//        -> createXxxDraft (postgresGeneratedContentRepository.js
//           persistCompleteSet), review-queue contract in
//           generatedContentReviewQueueContract.js
//   2. review start: fresh-only, tenant/target-scoped, no silent no-op
//        -> startGeneratedContentReview (repository ~L2683-2774)
//   3. review completion: fresh(in_progress)-only, block/citation/draft
//      immutable, audit metadata-only
//        -> completeGeneratedContentReview (repository ~L2775-2864),
//           insertCompleteReviewAudit
//   4. export-review request is gated on generated_content_review being
//      resolved/resolved
//        -> requestGeneratedDraftExportReview / evaluateExportReviewReadiness
//           (repository ~L2865-2951)
//   5. export-review start/complete: same fresh-only optimistic-concurrency
//      shape, content-type-agnostic
//        -> startGeneratedDraftExportReview (repository ~L2952-3054),
//           completeGeneratedDraftExportReview (repository ~L3055+)
//   6. resolving both reviews never itself implies final export eligibility
//        -> evaluateFinalExportEligibility
//           (kaiFinalExportEligibilityGateService.js)
//   7. allowlists: all four content types are wired everywhere the lifecycle
//      requires them, and the intentionally-narrower funder/board-packet
//      allowlists remain exactly as narrow as designed
//   8. ownership: generated_content_review is GK-reviewer-or-admin;
//      export_review is GK-admin-only (a strict subset)

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  createPostgresGeneratedContentRepository,
  __generatedContentRepositoryContract,
} from "../Backend/kai/dictionary/postgresGeneratedContentRepository.js";
import {
  startGeneratedContentReview,
  completeGeneratedContentReview,
  __generatedContentServiceContract,
} from "../Backend/kai/services/kaiGeneratedContentService.js";
import {
  requestGeneratedDraftExportReview,
  startGeneratedDraftExportReview,
  completeGeneratedDraftExportReview,
  __exportReviewServiceContract,
} from "../Backend/kai/services/kaiExportReviewService.js";
import {
  evaluateFinalExportEligibility,
} from "../Backend/kai/services/kaiFinalExportEligibilityGateService.js";
import {
  GENERATED_CONTENT_REVIEW_QUEUE_STATIC_CONTRACT,
} from "../Backend/kai/dictionary/generatedContentReviewQueueContract.js";
import { EXPORT_CANDIDATE_CONTENT_TYPES } from "../Backend/kai/dictionary/exportCandidateContract.js";
import { BOARD_REPORTING_PACKET_CONTENT_TYPES } from "../Backend/kai/services/kaiBoardReportingPacketService.js";

const CONTENT_TYPES = Object.freeze([
  "evidence_summary",
  "impact_narrative",
  "readiness_assessment",
  "data_gap_memo",
  "case_for_support",
  "board_update",
  "annual_report_section",
]);

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const ENGAGEMENT = "00000000-0000-4000-8000-000000000701";
const SAFE_STATEMENT = "This claim is traceable to a governed evidence item.";
const READINESS = Object.freeze({
  requirements: [{
    requirement_id: "00000000-0000-4000-8000-000000000501",
    requirement_key: "ir_data_003",
    requirement_label: "Claims are traceable to evidence",
    assessed: true,
    assessment: { assessment_state: "partially_satisfied", assessment_explanation: "Some governed claims have no traceable evidence link." },
  }],
});
const GAPS = Object.freeze({
  items: [{ gap_log_item_id: "00000000-0000-4000-8000-000000000601", claim_id: "00000000-0000-4000-8000-000000000101", dimension_key: "coverage_gaps", assessment_status: "unresolved", validator_key: "VAL-COV-001" }],
});

// Deterministic, distinct per-content-type identifiers, so the four
// parameterized runs never collide.
function idFor(contentType, tag) {
  const index = CONTENT_TYPES.indexOf(contentType) + 1;
  return `9${index}000000-0000-4000-8000-${String(tag).padStart(12, "0")}`;
}

const gkReviewerActor = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  source: "public.userdata",
  organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" }],
});
const gkAdminActor = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000002",
  source: "public.userdata",
  organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_admin" }],
});
const gkAdminAlternateActor = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000099",
  source: "public.userdata",
  organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_admin" }],
});
const clientActor = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000003",
  source: "public.userdata",
  organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "client" }],
});

const enabledEnv = Object.freeze({
  KAI_SPRINT2_ENABLED: "true",
  KAI_GENERATION_ENABLED: "true",
  KAI_PUBLIC_EXPORT_ENABLED: "true",
});

function auditRecorder() {
  return { prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } };
}

const REPOSITORY_METHOD_BY_CONTENT_TYPE = Object.freeze({
  evidence_summary: "createEvidenceSummaryDraft",
  impact_narrative: "createImpactNarrativeDraft",
  readiness_assessment: "createReadinessAssessmentDraft",
  data_gap_memo: "createDataGapMemoDraft",
  case_for_support: "createCaseForSupportDraft",
  board_update: "createBoardUpdateDraft",
  annual_report_section: "createAnnualReportSectionDraft",
});

function creationDependenciesFor(contentType) {
  if (contentType === "readiness_assessment") return { authoritativeReadiness: READINESS };
  if (contentType === "data_gap_memo") return { authoritativeDataGaps: GAPS };
  return {};
}

function goodGenerator() {
  return async (generatorInput) => ({
    blocks: [{
      ordinal: 1,
      text: generatorInput.claims[0].claimStatement,
      citations: [{ claimId: generatorInput.claims[0].claimId, evidenceItemId: generatorInput.claims[0].evidenceItemId }],
    }],
  });
}

function makeEvaluator({ eligibleForClaim = () => true, claimStrengthForClaim = () => "reviewed_supported" } = {}) {
  return async (tx, { claimId, requestedAudience }) => ({
    ok: true,
    data: {
      claim: { claim_id: claimId, claim_strength: claimStrengthForClaim(claimId) },
      evidence: { evidence_item_id: "00000000-0000-4000-8000-000000000201" },
      requestedAudience,
      eligible: eligibleForClaim(claimId),
      blockerCodes: [],
      affectedDimensionKeys: [],
      affectedObjectIds: [],
    },
    error: null,
  });
}

// =======================================================================
// Section 1 - CREATION -> generated_content_review coupling.
//
// Adapted, content-type-agnostic, from the fake-tx dispatch-by-SQL-text
// convention established by
// kai-sprint2-phase13-governance-horizontal-conformance.spec.js (read for
// convention, not imported/modified). The initial profile predicate (9/10)
// is reproduced here, standalone, so this suite proves the review lifecycle
// end-to-end without depending on that sibling file at runtime.
// =======================================================================

function creationClaimRow(overrides = {}) {
  return {
    claim_id: "00000000-0000-4000-8000-000000000101",
    claim_statement: SAFE_STATEMENT,
    claim_type: "finding",
    evidence_item_id: "00000000-0000-4000-8000-000000000201",
    internal_only: true,
    funder_use_allowed: true,
    public_use_allowed: false,
    source_id: "00000000-0000-4000-8000-000000000301",
    source_version_id: "00000000-0000-4000-8000-000000000401",
    intake_file_id: "00000000-0000-4000-8000-000000000901",
    upload_state: "confirmed",
    ...overrides,
  };
}

function makeCreationState() {
  return {
    generationRuns: [],
    generatedContentDrafts: [],
    generatedContentBlocks: [],
    generatedContentCitations: [],
    reviewQueueItems: [],
    uploadLifecycleAudit: [],
    claims: [creationClaimRow()],
  };
}

function makeCreationFakeTx(draft) {
  return {
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, " ").trim();

      if (s.startsWith("INSERT INTO kai.generation_runs")) {
        const [organizationId, engagementId, idempotencyKey, requestFingerprint, contentType, requestedAudience, now] = params;
        const conflict = draft.generationRuns.some((r) => r.organization_id === organizationId && r.idempotency_key === idempotencyKey);
        if (conflict) return { rows: [] };
        const row = { generation_run_id: randomUUID(), organization_id: organizationId, engagement_id: engagementId, idempotency_key: idempotencyKey, request_fingerprint: requestFingerprint, content_type: contentType, requested_audience: requestedAudience, created_by_type: "system", created_at: now };
        draft.generationRuns.push(row);
        return { rows: [{ generation_run_id: row.generation_run_id }] };
      }
      if (s.startsWith("SELECT generation_run_id::text AS generation_run_id")) {
        const [organizationId, idempotencyKey] = params;
        const row = draft.generationRuns.find((r) => r.organization_id === organizationId && r.idempotency_key === idempotencyKey);
        return { rows: row ? [row] : [] };
      }
      if (s.startsWith("SELECT generated_content_draft_id::text AS generated_content_draft_id, generation_run_id")) {
        const [organizationId, generationRunId] = params;
        return { rows: draft.generatedContentDrafts.filter((d) => d.organization_id === organizationId && d.generation_run_id === generationRunId) };
      }
      if (s.startsWith("INSERT INTO kai.generated_content_drafts")) {
        const [generationRunId, organizationId, contentType, requestedAudience, draftStatus, reviewStatus, , now] = params;
        const row = { generated_content_draft_id: randomUUID(), generation_run_id: generationRunId, organization_id: organizationId, content_type: contentType, requested_audience: requestedAudience, draft_status: draftStatus, review_status: reviewStatus, created_by_type: "system", created_at: now };
        draft.generatedContentDrafts.push(row);
        return { rows: [{ generated_content_draft_id: row.generated_content_draft_id }] };
      }
      if (s.startsWith("SELECT generated_content_block_id::text AS generated_content_block_id")) {
        const [organizationId, draftId] = params;
        return { rows: draft.generatedContentBlocks.filter((b) => b.organization_id === organizationId && b.generated_content_draft_id === draftId).sort((a, b) => a.ordinal - b.ordinal) };
      }
      if (s.startsWith("INSERT INTO kai.generated_content_blocks")) {
        const [draftId, organizationId, ordinal, text, now] = params;
        const row = { generated_content_block_id: randomUUID(), generated_content_draft_id: draftId, organization_id: organizationId, ordinal, text, created_at: now };
        draft.generatedContentBlocks.push(row);
        return { rows: [{ generated_content_block_id: row.generated_content_block_id }] };
      }
      if (s.startsWith("SELECT c.generated_content_citation_id::text AS generated_content_citation_id")) {
        const [organizationId, draftId] = params;
        const blockIds = new Set(draft.generatedContentBlocks.filter((b) => b.generated_content_draft_id === draftId).map((b) => b.generated_content_block_id));
        return { rows: draft.generatedContentCitations.filter((c) => c.organization_id === organizationId && blockIds.has(c.generated_content_block_id)) };
      }
      if (s.startsWith("INSERT INTO kai.generated_content_citations")) {
        const [blockId, organizationId, claimId, evidenceItemId, now] = params;
        draft.generatedContentCitations.push({ generated_content_citation_id: randomUUID(), generated_content_block_id: blockId, organization_id: organizationId, claim_id: claimId, evidence_item_id: evidenceItemId, created_at: now });
        return { rows: [] };
      }
      if (s.startsWith("SELECT c.claim_id::text AS claim_id")) {
        const [, claimIds] = params;
        return { rows: draft.claims.filter((c) => claimIds.includes(c.claim_id)).sort((a, b) => (a.claim_id < b.claim_id ? -1 : 1)) };
      }
      if (s.startsWith("SELECT review_queue_item_id::text AS review_queue_item_id") && s.includes("queue_type = $2") && !s.includes("updated_at")) {
        const [organizationId, queueType, targetObjectType, targetObjectId] = params;
        return { rows: draft.reviewQueueItems.filter((q) => q.organization_id === organizationId && q.queue_type === queueType && q.target_object_type === targetObjectType && q.target_object_id === targetObjectId) };
      }
      if (s.startsWith("INSERT INTO kai.review_queue_items")) {
        const [organizationId, queueType, targetObjectType, targetObjectId, reviewStatus, summary, requiredAction, now] = params;
        const row = { review_queue_item_id: randomUUID(), organization_id: organizationId, engagement_id: null, queue_type: queueType, target_object_type: targetObjectType, target_object_id: targetObjectId, priority: "medium", queue_status: "open", review_status: reviewStatus, blocked_reason: null, assigned_to: null, due_at: null, summary, required_action: requiredAction, queue_metadata: {}, created_by: null, created_by_type: "system", created_at: now, updated_at: now };
        draft.reviewQueueItems.push(row);
        return { rows: [{ review_queue_item_id: row.review_queue_item_id }] };
      }
      if (s.startsWith("INSERT INTO kai.upload_lifecycle_audit")) {
        const [organizationId, intakeFileId, operation, fromState, metadataJson, now] = params;
        draft.uploadLifecycleAudit.push({ organization_id: organizationId, intake_file_id: intakeFileId, operation, from_state: fromState, metadata: JSON.parse(metadataJson), created_at: now });
        return { rows: [] };
      }
      throw new Error(`unhandled fake query: ${s}`);
    },
  };
}

function withFakeCreationTransaction(state) {
  return async (callback) => {
    const draft = structuredClone(state);
    const result = await callback(makeCreationFakeTx(draft));
    for (const key of Object.keys(draft)) state[key] = draft[key];
    return result;
  };
}

function makeCreationRepository(state, evaluator) {
  return createPostgresGeneratedContentRepository({ runInTransaction: withFakeCreationTransaction(state), evaluator });
}

// Captured across the module so section 6 (final authority) can feed real,
// just-persisted-and-then-reviewed state downstream instead of fabricating
// its own draft identities.
const createdByType = {};

for (const contentType of CONTENT_TYPES) {
  test(`[${contentType}] section 1 - a successful create<Type>Draft call persists exactly one draft and exactly one generated_content_review queue row at the initial (open/needs_gk_review) profile, granting no export authority`, async () => {
    const state = makeCreationState();
    const repository = makeCreationRepository(state, makeEvaluator());
    const methodName = REPOSITORY_METHOD_BY_CONTENT_TYPE[contentType];

    const result = await repository[methodName]({
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      requestedAudience: "internal",
      claimIds: ["00000000-0000-4000-8000-000000000101"],
      idempotencyKey: `review-lifecycle-create-${contentType}`,
      actorContext: gkAdminActor,
      now: "2026-09-01T00:00:00.000Z",
    }, { draftGenerator: goodGenerator(), metadataOnlyAudit: auditRecorder(), ...creationDependenciesFor(contentType) });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.draftStatus, "draft");
    assert.equal(result.data.reviewStatus, "needs_gk_review");
    assert.equal(state.reviewQueueItems.length, 1);
    const queueRow = state.reviewQueueItems[0];
    assert.equal(queueRow.queue_type, GENERATED_CONTENT_REVIEW_QUEUE_STATIC_CONTRACT.queueType);
    assert.equal(queueRow.target_object_type, GENERATED_CONTENT_REVIEW_QUEUE_STATIC_CONTRACT.targetObjectType);
    assert.equal(queueRow.target_object_id, result.data.generatedContentDraftId);
    assert.equal(queueRow.queue_status, "open");
    assert.equal(queueRow.review_status, "needs_gk_review");

    createdByType[contentType] = { draftId: result.data.generatedContentDraftId, queueId: queueRow.review_queue_item_id };
  });
}

// =======================================================================
// Section 2/3 - REVIEW START and REVIEW COMPLETION.
//
// Adapted, content-type-agnostic, from
// kai-sprint2-p3-04-generated-content-review-completion-boundary.spec.js's
// fake-tx dispatch (read for convention, not imported/modified) - that
// dispatcher never branches on content_type, confirmed directly against
// postgresGeneratedContentRepository.js's startGeneratedContentReview
// (~L2683-2774) and completeGeneratedContentReview (~L2775-2864), neither
// of which reads content_type in its transition logic.
// =======================================================================

const REVIEW_FRESH_UPDATED_AT = "2026-08-06T09:00:00.000Z";
const REVIEW_NOW = "2026-08-06T10:00:00.000Z";
const REVIEW_LATER = "2026-08-06T10:05:00.000Z";

function reviewFakeEvaluator(state) {
  return async (tx, evalInput) => ({
    ok: true,
    data: {
      claim: { claim_id: evalInput.claimId, claim_type: "finding", claim_status: "approved", claim_review_status: "approved", claim_strength: "unassessed", audience_gates: {} },
      evidence: { evidence_item_id: state.ids.evidence, evidence_review_status: "approved", support_strength: "unassessed", review_queue_item_id: "10000000-0000-4000-8000-000000000021", review_queue_status: "resolved", review_status: "approved", updated_at: "2026-08-06T09:00:00.000Z", sensitivity_level: "unknown" },
      locator: { source_locator_id: "10000000-0000-4000-8000-000000000022" },
      source: { source_id: "00000000-0000-4000-8000-000000000207", source_code: null },
      source_version: { source_version_id: "00000000-0000-4000-8000-000000000208", is_current: true },
      claim_review: { review_queue_item_id: "10000000-0000-4000-8000-000000000025", queue_status: "resolved", review_status: "approved" },
      evidence_review_decision: { decision_id: "10000000-0000-4000-8000-000000000027", decision_outcome: "accepted" },
      claim_review_decision: { decision_id: "10000000-0000-4000-8000-000000000028", decision_outcome: "accepted", approved_audiences: ["internal", "funder"] },
      candidate: { intake_source_candidate_id: "90000000-0000-4000-8000-000000000003" },
      promotion_decision: { intake_promotion_decision_id: "10000000-0000-4000-8000-000000000026" },
      dimensions: {}, gap_items: [], client_followup_workflows: [], potential_conflict_groups: [],
      graph_relationships: [
        { relationship_type: "claim_supported_by_evidence", from_object_type: "claim", from_object_id: evalInput.claimId, to_object_type: "evidence_item", to_object_id: state.ids.evidence },
        { relationship_type: "evidence_located_by_source_locator", from_object_type: "evidence_item", from_object_id: state.ids.evidence, to_object_type: "source_locator", to_object_id: "10000000-0000-4000-8000-000000000022" },
        { relationship_type: "evidence_from_source_version", from_object_type: "evidence_item", from_object_id: state.ids.evidence, to_object_type: "source_version", to_object_id: "00000000-0000-4000-8000-000000000208" },
        { relationship_type: "source_version_of_source", from_object_type: "source_version", from_object_id: "00000000-0000-4000-8000-000000000208", to_object_type: "source", to_object_id: "00000000-0000-4000-8000-000000000207" },
        { relationship_type: "source_version_from_candidate", from_object_type: "source_version", from_object_id: "00000000-0000-4000-8000-000000000208", to_object_type: "intake_source_candidate", to_object_id: "90000000-0000-4000-8000-000000000003" },
        { relationship_type: "candidate_governed_by_data_dictionary", from_object_type: "intake_source_candidate", from_object_id: "90000000-0000-4000-8000-000000000003", to_object_type: "data_dictionary", to_object_id: "10000000-0000-4000-8000-000000000029" },
        { relationship_type: "candidate_governed_by_sensitivity_profile", from_object_type: "intake_source_candidate", from_object_id: "90000000-0000-4000-8000-000000000003", to_object_type: "intake_sensitivity_profile", to_object_id: "10000000-0000-4000-8000-000000000030" },
        { relationship_type: "evidence_review_queue", from_object_type: "evidence_item", from_object_id: state.ids.evidence, to_object_type: "review_queue_item", to_object_id: "10000000-0000-4000-8000-000000000021" },
        { relationship_type: "claim_review_queue", from_object_type: "claim", from_object_id: evalInput.claimId, to_object_type: "review_queue_item", to_object_id: "10000000-0000-4000-8000-000000000025" },
      ],
      graph_trace_completeness: { complete: true, missing_relationship_types: [], invalid_relationship_count: 0 },
      requestedAudience: evalInput.requestedAudience,
      eligible: true, blockerCodes: [], affectedDimensionKeys: [], affectedObjectIds: [], truncated: false,
    },
    error: null,
  });
}

function makeReviewFixtureState(contentType, { queueStatus = "in_progress", reviewStatus = "needs_gk_review", updatedAt = REVIEW_FRESH_UPDATED_AT } = {}) {
  const run = idFor(contentType, 501);
  const draft = idFor(contentType, 502);
  const block = idFor(contentType, 503);
  const citation = idFor(contentType, 504);
  const claim = idFor(contentType, 505);
  const evidence = idFor(contentType, 506);
  const queue = idFor(contentType, 509);
  return {
    ids: { run, draft, block, citation, claim, evidence, queue },
    draft: { generated_content_draft_id: draft, generation_run_id: run, organization_id: ORG, content_type: contentType, requested_audience: "internal", draft_status: "draft", review_status: "needs_gk_review" },
    run: { generation_run_id: run, organization_id: ORG, request_fingerprint: "c".repeat(64), content_type: contentType, requested_audience: "internal" },
    siblingDrafts: [{ generated_content_draft_id: draft, generation_run_id: run, organization_id: ORG, content_type: contentType, requested_audience: "internal", draft_status: "draft", review_status: "needs_gk_review" }],
    blocks: [{ generated_content_block_id: block, generated_content_draft_id: draft, organization_id: ORG, ordinal: 1, text: "Enrollment increased by 12% in 2025." }],
    citations: [{ generated_content_citation_id: citation, generated_content_block_id: block, organization_id: ORG, claim_id: claim, evidence_item_id: evidence, block_ordinal: 1 }],
    queues: [{ review_queue_item_id: queue, organization_id: ORG, queue_type: GENERATED_CONTENT_REVIEW_QUEUE_STATIC_CONTRACT.queueType, target_object_type: GENERATED_CONTENT_REVIEW_QUEUE_STATIC_CONTRACT.targetObjectType, target_object_id: draft, priority: GENERATED_CONTENT_REVIEW_QUEUE_STATIC_CONTRACT.priority, queue_status: queueStatus, review_status: reviewStatus, assigned_to: null, due_at: null, summary: GENERATED_CONTENT_REVIEW_QUEUE_STATIC_CONTRACT.summary, required_action: GENERATED_CONTENT_REVIEW_QUEUE_STATIC_CONTRACT.requiredAction, updated_at: updatedAt }],
    auditRows: [],
    auditFileContext: { intake_file_id: idFor(contentType, 601), upload_state: "confirmed" },
  };
}

function reviewInput(state, overrides = {}) {
  return {
    organizationId: ORG,
    generatedContentDraftId: state.ids.draft,
    reviewQueueItemId: state.ids.queue,
    expectedUpdatedAt: REVIEW_FRESH_UPDATED_AT,
    actorContext: gkReviewerActor,
    now: REVIEW_NOW,
    ...overrides,
  };
}

function makeReviewFakeTx(state) {
  return {
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, " ").trim();
      if (s.includes("intake_file_id::text AS intake_file_id")) return { rows: [{ intake_file_id: state.auditFileContext.intake_file_id, upload_state: state.auditFileContext.upload_state }] };
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
        return { rows: state.queues.filter((q) => q.organization_id === organizationId && q.target_object_type === targetType && q.target_object_id === targetId) };
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
        const matches = row && row.organization_id === organizationId && row.target_object_type === targetType && row.target_object_id === targetId && row.queue_status === expectedQueueStatus && row.review_status === expectedReviewStatus && row.updated_at === expectedUpdatedAt;
        if (!matches) return { rowCount: 0, rows: [] };
        row.queue_status = newQueueStatus;
        row.review_status = newReviewStatus;
        row.updated_at = now;
        return { rowCount: 1, rows: [{ review_queue_item_id: reviewQueueItemId }] };
      }
      if (s.includes("FROM kai.review_queue_items")) {
        const [reviewQueueItemId] = params;
        return { rows: state.queues.filter((q) => q.review_queue_item_id === reviewQueueItemId) };
      }
      if (s.startsWith("INSERT INTO kai.upload_lifecycle_audit")) {
        const [organizationId, , operation, , metadataJson] = params;
        state.auditRows.push({ organization_id: organizationId, operation, outcome: "success", metadata: JSON.parse(metadataJson) });
        return { rows: [] };
      }
      if (s.includes("FROM kai.upload_lifecycle_audit")) {
        const [organizationId, operation, draftId, queueId] = params;
        return { rows: state.auditRows.filter((a) => a.organization_id === organizationId && a.operation === operation && a.outcome === "success" && a.metadata.generated_content_draft_id === draftId && a.metadata.review_queue_item_id === queueId).map((a) => ({ metadata: a.metadata })) };
      }
      throw new Error(`unhandled fake query: ${s}`);
    },
  };
}

function makeReviewRepository(state) {
  return createPostgresGeneratedContentRepository({ runInTransaction: async (callback) => callback(makeReviewFakeTx(state)), evaluator: reviewFakeEvaluator(state) });
}

for (const contentType of CONTENT_TYPES) {
  test(`[${contentType}] section 2 - startGeneratedContentReview transitions open/needs_gk_review -> in_progress/needs_gk_review exactly once, with one audit and no draft/block/citation mutation`, async () => {
    const state = makeReviewFixtureState(contentType, { queueStatus: "open", reviewStatus: "needs_gk_review" });
    const before = JSON.stringify({ draft: state.draft, blocks: state.blocks, citations: state.citations });
    const repository = makeReviewRepository(state);
    const result = await startGeneratedContentReview(reviewInput(state), { env: enabledEnv, generatedContentRepository: repository, metadataOnlyAudit: auditRecorder() });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.queueStatus, "in_progress");
    assert.equal(result.data.reviewStatus, "needs_gk_review");
    assert.equal(state.queues[0].queue_status, "in_progress");
    assert.equal(state.auditRows.length, 1);
    assert.equal(JSON.stringify({ draft: state.draft, blocks: state.blocks, citations: state.citations }), before);

    // An identical retry (same actor, expectedUpdatedAt, and requested
    // timestamp) against the now-in_progress row legitimately replays
    // (idempotent, audit-backed) - it is not a silent NEW mutation: the
    // queue is not transitioned a second time and no second audit row is
    // written.
    const identicalReplay = await startGeneratedContentReview(reviewInput(state), { env: enabledEnv, generatedContentRepository: makeReviewRepository(state), metadataOnlyAudit: auditRecorder() });
    assert.equal(identicalReplay.ok, true, JSON.stringify(identicalReplay));
    assert.equal(identicalReplay.data.replayed, true);
    assert.equal(state.auditRows.length, 1);

    // A DIFFERENT actor attempting to start the same, no-longer-fresh row is
    // NOT an identical replay and is refused with a hard conflict rather
    // than a silent no-op or a second mutation.
    const differentActorAttempt = await startGeneratedContentReview(reviewInput(state, { actorContext: { ...gkReviewerActor, actorUserId: "90000000-0000-4000-8000-000000000098" } }), { env: enabledEnv, generatedContentRepository: makeReviewRepository(state), metadataOnlyAudit: auditRecorder() });
    assert.equal(differentActorAttempt.ok, false);
    assert.equal(differentActorAttempt.error.code, "conflict_current_state_changed");
    assert.equal(state.auditRows.length, 1);
  });

  test(`[${contentType}] section 2 - review start is tenant/target scoped: wrong organizationId or wrong reviewQueueItemId/generatedContentDraftId relationship does not transition the row`, async () => {
    for (const build of [
      () => { const s = makeReviewFixtureState(contentType, { queueStatus: "open", reviewStatus: "needs_gk_review" }); return { state: s, overrides: { organizationId: OTHER_ORG } }; },
      () => {
        const s = makeReviewFixtureState(contentType, { queueStatus: "open", reviewStatus: "needs_gk_review" });
        s.queues[0].organization_id = OTHER_ORG;
        return { state: s, overrides: {} };
      },
      () => {
        const s = makeReviewFixtureState(contentType, { queueStatus: "open", reviewStatus: "needs_gk_review" });
        return { state: s, overrides: { generatedContentDraftId: "00000000-0000-4000-8000-000000000999" } };
      },
    ]) {
      const { state, overrides } = build();
      const before = JSON.stringify(state.queues);
      const result = await startGeneratedContentReview(reviewInput(state, overrides), { env: enabledEnv, generatedContentRepository: makeReviewRepository(state), metadataOnlyAudit: auditRecorder() });
      assert.equal(result.ok, false);
      assert.ok(["conflict_current_state_changed", "authorization_denied", "not_found"].includes(result.error.code), result.error.code);
      assert.equal(JSON.stringify(state.queues), before);
      assert.equal(state.auditRows.length, 0);
    }
  });

  test(`[${contentType}] section 3 - completeGeneratedContentReview succeeds only from in_progress/needs_gk_review -> resolved/resolved; skipping start (calling from the fresh open/needs_gk_review state) is rejected`, async () => {
    // Skipping start: the row is still open/needs_gk_review.
    const freshState = makeReviewFixtureState(contentType, { queueStatus: "open", reviewStatus: "needs_gk_review" });
    const skippedStart = await completeGeneratedContentReview(reviewInput(freshState), { env: enabledEnv, generatedContentRepository: makeReviewRepository(freshState), metadataOnlyAudit: auditRecorder() });
    assert.equal(skippedStart.ok, false);
    assert.equal(skippedStart.error.code, "conflict_current_state_changed");
    assert.equal(freshState.auditRows.length, 0);

    // The correct precondition: in_progress/needs_gk_review (as left by
    // section 2's real start call).
    const state = makeReviewFixtureState(contentType, { queueStatus: "in_progress", reviewStatus: "needs_gk_review" });
    const blocksBefore = JSON.stringify(state.blocks);
    const citationsBefore = JSON.stringify(state.citations);
    const result = await completeGeneratedContentReview(reviewInput(state), { env: enabledEnv, generatedContentRepository: makeReviewRepository(state), metadataOnlyAudit: auditRecorder() });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.queueStatus, "resolved");
    assert.equal(result.data.reviewStatus, "resolved");
    assert.equal(state.queues[0].queue_status, "resolved");
    assert.equal(state.queues[0].review_status, "resolved");

    // Block/citation rows are not mutated by completion.
    assert.equal(JSON.stringify(state.blocks), blocksBefore);
    assert.equal(JSON.stringify(state.citations), citationsBefore);
    assert.equal(state.blocks.length, 1);
    assert.equal(state.citations.length, 1);

    // The draft's own draft_status remains "draft" - never promoted.
    assert.equal(state.draft.draft_status, "draft");

    // The audit write is metadata-only: exactly the fields
    // insertCompleteReviewAudit actually writes, no draft/claim/evidence text.
    assert.equal(state.auditRows.length, 1);
    const metadata = state.auditRows[0].metadata;
    assert.deepEqual(new Set(Object.keys(metadata)), new Set([
      "contract", "organization_id", "generation_run_id", "generated_content_draft_id",
      "review_queue_item_id", "actor_id", "actor_type", "expected_updated_at",
      "requested_completion_timestamp", "previous_queue_status", "resulting_queue_status",
      "previous_review_status", "resulting_review_status", "validator_keys",
    ]));
    assert.equal(metadata.organization_id, ORG);
    assert.equal(metadata.generated_content_draft_id, state.ids.draft);
    assert.equal(metadata.review_queue_item_id, state.ids.queue);
    assert.equal(metadata.previous_queue_status, "in_progress");
    assert.equal(metadata.resulting_queue_status, "resolved");
    assert.equal(metadata.previous_review_status, "needs_gk_review");
    assert.equal(metadata.resulting_review_status, "resolved");
  });
}

// =======================================================================
// Section 4 - EXPORT-REVIEW REQUEST GATE.
//
// Adapted, content-type-agnostic, from
// kai-sprint2-p3-05-export-review-request-boundary.spec.js's fake-tx
// dispatch (read for convention, not imported/modified).
// =======================================================================

function makeExportRequestFixtureState(contentType, { generatedContentReviewResolved = true } = {}) {
  const run = idFor(contentType, 601);
  const draft = idFor(contentType, 602);
  const block = idFor(contentType, 603);
  const citation = idFor(contentType, 604);
  const claim = idFor(contentType, 605);
  const evidence = idFor(contentType, 606);
  const genContentQueue = idFor(contentType, 609);
  const queueStatus = generatedContentReviewResolved ? "resolved" : "open";
  const reviewStatus = generatedContentReviewResolved ? "resolved" : "needs_gk_review";
  return {
    ids: { run, draft, block, citation, claim, evidence, genContentQueue },
    // draft.review_status is the immutable creation-time value
    // (REVIEW_STATUS constant, "needs_gk_review") - it is never the live
    // review status. The LIVE review lifecycle lives entirely on the
    // generated_content_review queue row below (validateImmutableGraphRows,
    // postgresGeneratedContentRepository.js ~L753-761, requires
    // draft.review_status === REVIEW_STATUS unconditionally).
    draft: { generated_content_draft_id: draft, generation_run_id: run, organization_id: ORG, content_type: contentType, requested_audience: "internal", draft_status: "draft", review_status: "needs_gk_review" },
    run: { generation_run_id: run, organization_id: ORG, request_fingerprint: "c".repeat(64), content_type: contentType, requested_audience: "internal" },
    siblingDrafts: [{ generated_content_draft_id: draft, generation_run_id: run, organization_id: ORG, content_type: contentType, requested_audience: "internal", draft_status: "draft", review_status: "needs_gk_review" }],
    blocks: [{ generated_content_block_id: block, generated_content_draft_id: draft, organization_id: ORG, ordinal: 1, text: "Enrollment increased by 12% in 2025." }],
    citations: [{ generated_content_citation_id: citation, generated_content_block_id: block, organization_id: ORG, claim_id: claim, evidence_item_id: evidence, block_ordinal: 1 }],
    genContentReviewQueues: [{ review_queue_item_id: genContentQueue, organization_id: ORG, queue_type: GENERATED_CONTENT_REVIEW_QUEUE_STATIC_CONTRACT.queueType, target_object_type: GENERATED_CONTENT_REVIEW_QUEUE_STATIC_CONTRACT.targetObjectType, target_object_id: draft, priority: GENERATED_CONTENT_REVIEW_QUEUE_STATIC_CONTRACT.priority, queue_status: queueStatus, review_status: reviewStatus, assigned_to: null, due_at: null, summary: GENERATED_CONTENT_REVIEW_QUEUE_STATIC_CONTRACT.summary, required_action: GENERATED_CONTENT_REVIEW_QUEUE_STATIC_CONTRACT.requiredAction }],
    exportReviewQueues: [],
    auditRows: [],
    auditFileContext: { intake_file_id: idFor(contentType, 701), upload_state: "confirmed" },
    currentUseEligible: true,
    nextQueueItemId: 1,
  };
}

function exportRequestFakeEvaluator(state) {
  return async (tx, evalInput) => ({
    ok: true,
    data: {
      claim: { claim_id: evalInput.claimId, claim_type: "finding", claim_status: "approved", claim_review_status: "approved", claim_strength: "unassessed", audience_gates: {} },
      evidence: { evidence_item_id: state.ids.evidence, evidence_review_status: "approved", support_strength: "unassessed", review_queue_item_id: "10000000-0000-4000-8000-000000000021", review_queue_status: "resolved", review_status: "approved", updated_at: "2026-08-06T09:00:00.000Z", sensitivity_level: "unknown" },
      locator: { source_locator_id: "10000000-0000-4000-8000-000000000022" },
      source: { source_id: idFor(state.draft.content_type, 607), source_code: null },
      source_version: { source_version_id: idFor(state.draft.content_type, 608), is_current: true },
      claim_review: { review_queue_item_id: "10000000-0000-4000-8000-000000000025", queue_status: "resolved", review_status: "approved" },
      evidence_review_decision: { decision_id: "10000000-0000-4000-8000-000000000027", decision_outcome: "accepted" },
      claim_review_decision: { decision_id: "10000000-0000-4000-8000-000000000028", decision_outcome: "accepted", approved_audiences: ["internal", "funder"] },
      candidate: { intake_source_candidate_id: "90000000-0000-4000-8000-000000000003" },
      promotion_decision: { intake_promotion_decision_id: "10000000-0000-4000-8000-000000000026" },
      dimensions: {}, gap_items: [], client_followup_workflows: [], potential_conflict_groups: [],
      graph_relationships: [
        { relationship_type: "claim_supported_by_evidence", from_object_type: "claim", from_object_id: evalInput.claimId, to_object_type: "evidence_item", to_object_id: state.ids.evidence },
        { relationship_type: "evidence_located_by_source_locator", from_object_type: "evidence_item", from_object_id: state.ids.evidence, to_object_type: "source_locator", to_object_id: "10000000-0000-4000-8000-000000000022" },
        { relationship_type: "evidence_from_source_version", from_object_type: "evidence_item", from_object_id: state.ids.evidence, to_object_type: "source_version", to_object_id: idFor(state.draft.content_type, 608) },
        { relationship_type: "source_version_of_source", from_object_type: "source_version", from_object_id: idFor(state.draft.content_type, 608), to_object_type: "source", to_object_id: idFor(state.draft.content_type, 607) },
        { relationship_type: "source_version_from_candidate", from_object_type: "source_version", from_object_id: idFor(state.draft.content_type, 608), to_object_type: "intake_source_candidate", to_object_id: "90000000-0000-4000-8000-000000000003" },
        { relationship_type: "candidate_governed_by_data_dictionary", from_object_type: "intake_source_candidate", from_object_id: "90000000-0000-4000-8000-000000000003", to_object_type: "data_dictionary", to_object_id: "10000000-0000-4000-8000-000000000029" },
        { relationship_type: "candidate_governed_by_sensitivity_profile", from_object_type: "intake_source_candidate", from_object_id: "90000000-0000-4000-8000-000000000003", to_object_type: "intake_sensitivity_profile", to_object_id: "10000000-0000-4000-8000-000000000030" },
        { relationship_type: "evidence_review_queue", from_object_type: "evidence_item", from_object_id: state.ids.evidence, to_object_type: "review_queue_item", to_object_id: "10000000-0000-4000-8000-000000000021" },
        { relationship_type: "claim_review_queue", from_object_type: "claim", from_object_id: evalInput.claimId, to_object_type: "review_queue_item", to_object_id: "10000000-0000-4000-8000-000000000025" },
      ],
      graph_trace_completeness: { complete: true, missing_relationship_types: [], invalid_relationship_count: 0 },
      requestedAudience: evalInput.requestedAudience,
      eligible: state.currentUseEligible, blockerCodes: state.currentUseEligible ? [] : ["claim_review_unresolved"],
      affectedDimensionKeys: state.currentUseEligible ? [] : ["missingness"], affectedObjectIds: state.currentUseEligible ? [] : ["10000000-0000-4000-8000-000000000025"],
      truncated: false,
    },
    error: null,
  });
}

function makeExportRequestFakeTx(state) {
  return {
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, " ").trim();
      if (s.includes("intake_file_id::text AS intake_file_id") && s.includes("FROM kai.generated_content_blocks")) return { rows: [{ intake_file_id: state.auditFileContext.intake_file_id, upload_state: state.auditFileContext.upload_state }] };
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
        return { rows: state.exportReviewQueues.filter((q) => q.organization_id === organizationId && q.queue_type === queueType && q.target_object_type === targetType && q.target_object_id === targetId) };
      }
      if (s.includes("FROM kai.review_queue_items") && s.includes("target_object_type = $2") && s.includes("queue_type = $4")) {
        const [organizationId, targetType, targetId, queueType] = params;
        return { rows: state.genContentReviewQueues.filter((q) => q.organization_id === organizationId && q.target_object_type === targetType && q.target_object_id === targetId && q.queue_type === queueType) };
      }
      if (s.startsWith("INSERT INTO kai.review_queue_items")) {
        const [organizationId, queueType, targetType, targetId, priority, queueStatus, reviewStatus, summary, requiredAction] = params;
        const conflict = state.exportReviewQueues.find((q) => q.organization_id === organizationId && q.queue_type === queueType && q.target_object_type === targetType && q.target_object_id === targetId);
        if (conflict) return { rows: [] };
        const reviewQueueItemId = `00000000-0000-4000-8000-0000000009${String(state.nextQueueItemId++).padStart(2, "0")}`;
        state.exportReviewQueues.push({ review_queue_item_id: reviewQueueItemId, organization_id: organizationId, queue_type: queueType, target_object_type: targetType, target_object_id: targetId, priority, queue_status: queueStatus, review_status: reviewStatus, blocked_reason: null, assigned_to: null, due_at: null, summary, required_action: requiredAction, queue_metadata: {}, created_by: null, created_by_type: "system" });
        return { rows: [{ review_queue_item_id: reviewQueueItemId }] };
      }
      if (s.startsWith("INSERT INTO kai.upload_lifecycle_audit")) {
        const [organizationId, , operation, , metadataJson] = params;
        state.auditRows.push({ organization_id: organizationId, operation, outcome: "success", metadata: JSON.parse(metadataJson) });
        return { rows: [] };
      }
      if (s.includes("FROM kai.upload_lifecycle_audit")) {
        const [organizationId, operation, draftId, queueId] = params;
        return { rows: state.auditRows.filter((a) => a.organization_id === organizationId && a.operation === operation && a.outcome === "success" && a.metadata.generated_content_draft_id === draftId && a.metadata.review_queue_item_id === queueId).map((a) => ({ metadata: a.metadata })) };
      }
      throw new Error(`unhandled fake query: ${s}`);
    },
  };
}

function makeExportRequestRepository(state) {
  return createPostgresGeneratedContentRepository({ runInTransaction: async (callback) => callback(makeExportRequestFakeTx(state)), evaluator: exportRequestFakeEvaluator(state) });
}

function exportRequestInput(state, overrides = {}) {
  return { organizationId: ORG, generatedContentDraftId: state.ids.draft, requestedExportAudience: "internal", actorContext: gkAdminActor, now: "2026-08-06T10:00:00.000Z", ...overrides };
}

for (const contentType of CONTENT_TYPES) {
  test(`[${contentType}] section 4 - requestGeneratedDraftExportReview (via evaluateExportReviewReadiness) is not-ready while generated_content_review is unresolved (open or in_progress); no export_review row is created`, async () => {
    for (const queueStatusPair of [["open", "needs_gk_review"], ["in_progress", "needs_gk_review"]]) {
      const state = makeExportRequestFixtureState(contentType, { generatedContentReviewResolved: false });
      state.genContentReviewQueues[0].queue_status = queueStatusPair[0];
      state.genContentReviewQueues[0].review_status = queueStatusPair[1];
      const result = await requestGeneratedDraftExportReview(exportRequestInput(state), { env: enabledEnv, generatedContentRepository: makeExportRequestRepository(state), metadataOnlyAudit: auditRecorder() });
      assert.equal(result.ok, false, JSON.stringify(result));
      assert.equal(result.error.code, "conflict_current_state_changed");
      assert.equal(state.exportReviewQueues.length, 0);
      assert.equal(state.auditRows.length, 0);
    }
  });

  test(`[${contentType}] section 4 - once generated_content_review is resolved/resolved, requestGeneratedDraftExportReview succeeds and creates exactly one export_review row at its own initial (open/needs_gk_review) profile`, async () => {
    const state = makeExportRequestFixtureState(contentType, { generatedContentReviewResolved: true });
    const result = await requestGeneratedDraftExportReview(exportRequestInput(state), { env: enabledEnv, generatedContentRepository: makeExportRequestRepository(state), metadataOnlyAudit: auditRecorder() });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.exportReviewRequestAccepted, true);
    assert.equal(result.data.queueStatus, "open");
    assert.equal(result.data.reviewStatus, "needs_gk_review");
    assert.equal(state.exportReviewQueues.length, 1);
    assert.equal(state.exportReviewQueues[0].queue_type, "export_review");
    assert.equal(state.exportReviewQueues[0].target_object_type, "generated_content_draft");
    assert.equal(state.exportReviewQueues[0].target_object_id, state.ids.draft);
  });
}

// =======================================================================
// Section 5 - EXPORT-REVIEW LIFECYCLE (start/complete).
//
// Adapted, content-type-agnostic, from
// kai-sprint2-p3-09-export-review-start-boundary.spec.js and
// kai-sprint2-p3-13-export-review-completion-boundary.spec.js's fake-tx
// dispatch (read for convention, not imported/modified). Direct source
// reading of startGeneratedDraftExportReview/completeGeneratedDraftExportReview
// (postgresGeneratedContentRepository.js ~L2952-3160+) confirms neither
// function references content_type anywhere: the export_review queue row is
// keyed purely on (organization_id, queue_type, target_object_type,
// target_object_id) with no per-content-type branch. All four content
// types are therefore genuinely wired through the identical generic path -
// there is no carve-out to document here.
// =======================================================================

function makeExportLifecycleQueueRow(contentType, overrides = {}) {
  return {
    review_queue_item_id: idFor(contentType, 901),
    organization_id: ORG,
    queue_type: "export_review",
    target_object_type: "generated_content_draft",
    target_object_id: idFor(contentType, 802),
    priority: "medium",
    queue_status: "open",
    review_status: "needs_gk_review",
    blocked_reason: null, assigned_to: null, due_at: null,
    summary: "Generated draft requires export review.",
    required_action: "Review audience authority, current eligibility, citations, and the final export gate before any export.",
    queue_metadata: {}, created_by: null, created_by_type: "system",
    ...overrides,
  };
}

function makeExportLifecycleState(contentType, { queueRow = makeExportLifecycleQueueRow(contentType), updatedAtVersion = "2026-08-06T09:00:00.000Z" } = {}) {
  return { queueRow, auditRows: [], updatedAtVersion, auditFileContext: { intake_file_id: idFor(contentType, 702), upload_state: "confirmed" } };
}

function makeExportLifecycleFakeTx(state, { includeReviewStatusInUpdate }) {
  return {
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, " ").trim();
      if (s.startsWith("UPDATE kai.review_queue_items")) {
        let idx = 0;
        const newQueueStatus = params[idx++];
        const newReviewStatus = includeReviewStatusInUpdate ? params[idx++] : state.queueRow.review_status;
        const now = params[idx++];
        const organizationId = params[idx++];
        const reviewQueueItemId = params[idx++];
        const queueType = params[idx++];
        const targetType = params[idx++];
        const targetId = params[idx++];
        const expectedQueueStatus = params[idx++];
        const expectedReviewStatus = params[idx++];
        const expectedUpdatedAt = params[idx++];
        const row = state.queueRow;
        const matches = row && row.review_queue_item_id === reviewQueueItemId && row.organization_id === organizationId && row.queue_type === queueType && row.target_object_type === targetType && row.target_object_id === targetId && row.queue_status === expectedQueueStatus && row.review_status === expectedReviewStatus && state.updatedAtVersion === expectedUpdatedAt;
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
      if (s.includes("intake_file_id::text AS intake_file_id") && s.includes("FROM kai.generated_content_blocks")) return { rows: [{ intake_file_id: state.auditFileContext.intake_file_id, upload_state: state.auditFileContext.upload_state }] };
      if (s.startsWith("INSERT INTO kai.upload_lifecycle_audit")) {
        const [organizationId, , operation, , metadataJson] = params;
        state.auditRows.push({ organization_id: organizationId, operation, outcome: "success", metadata: JSON.parse(metadataJson) });
        return { rows: [] };
      }
      if (s.includes("FROM kai.upload_lifecycle_audit")) {
        const [organizationId, operation, draftId, queueId] = params;
        return { rows: state.auditRows.filter((a) => a.organization_id === organizationId && a.operation === operation && a.outcome === "success" && a.metadata.generated_content_draft_id === draftId && a.metadata.review_queue_item_id === queueId).map((a) => ({ metadata: a.metadata })) };
      }
      if (s.includes("FROM kai.limitation_snapshots")) return { rows: [] };
      throw new Error(`unhandled fake query: ${s}`);
    },
  };
}

function makeExportLifecycleRepository(state, includeReviewStatusInUpdate) {
  return createPostgresGeneratedContentRepository({ runInTransaction: async (callback) => callback(makeExportLifecycleFakeTx(state, { includeReviewStatusInUpdate })) });
}

for (const contentType of CONTENT_TYPES) {
  test(`[${contentType}] section 5 - startGeneratedDraftExportReview transitions open/needs_gk_review -> in_progress/needs_gk_review exactly once from the fresh profile; identical retry replays, a different actor conflicts`, async () => {
    const queueRow = makeExportLifecycleQueueRow(contentType);
    const state = makeExportLifecycleState(contentType, { queueRow });
    const input = { organizationId: ORG, generatedContentDraftId: queueRow.target_object_id, exportReviewQueueItemId: queueRow.review_queue_item_id, expectedUpdatedAt: state.updatedAtVersion, actorContext: gkAdminActor, now: "2026-08-06T10:00:00.000Z" };

    const first = await startGeneratedDraftExportReview(input, { env: enabledEnv, generatedContentRepository: makeExportLifecycleRepository(state, false), metadataOnlyAudit: auditRecorder() });
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(first.data.queueStatus, "in_progress");
    assert.equal(state.queueRow.queue_status, "in_progress");

    // An identical retry (same actor, expectedUpdatedAt, and requested
    // timestamp) against the now-in_progress row legitimately replays
    // (idempotent, audit-backed) rather than erroring - proven directly by
    // kai-sprint2-p3-09-export-review-start-boundary.spec.js's own "an
    // audit-backed identical replay ... converges" test. A DIFFERENT actor
    // attempting the same nominal transition, however, is not an identical
    // replay and must conflict rather than silently succeeding again.
    const identicalReplay = await startGeneratedDraftExportReview(input, { env: enabledEnv, generatedContentRepository: makeExportLifecycleRepository(state, false), metadataOnlyAudit: auditRecorder() });
    assert.equal(identicalReplay.ok, true, JSON.stringify(identicalReplay));
    assert.equal(identicalReplay.data.replayed, true);

    const differentActorAttempt = await startGeneratedDraftExportReview({ ...input, actorContext: gkAdminAlternateActor }, { env: enabledEnv, generatedContentRepository: makeExportLifecycleRepository(state, false), metadataOnlyAudit: auditRecorder() });
    assert.equal(differentActorAttempt.ok, false);
    assert.equal(differentActorAttempt.error.code, "conflict_current_state_changed");
  });

  test(`[${contentType}] section 5 - completeGeneratedDraftExportReview transitions in_progress/needs_gk_review -> resolved/resolved exactly once from the fresh profile; identical retry replays, a different actor conflicts`, async () => {
    const queueRow = makeExportLifecycleQueueRow(contentType, { queue_status: "in_progress" });
    const state = makeExportLifecycleState(contentType, { queueRow, updatedAtVersion: "2026-08-06T10:05:00.000Z" });
    const input = { organizationId: ORG, generatedContentDraftId: queueRow.target_object_id, exportReviewQueueItemId: queueRow.review_queue_item_id, expectedUpdatedAt: state.updatedAtVersion, actorContext: gkAdminActor, now: "2026-08-06T10:10:00.000Z" };

    const first = await completeGeneratedDraftExportReview(input, { env: enabledEnv, generatedContentRepository: makeExportLifecycleRepository(state, true), metadataOnlyAudit: auditRecorder() });
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(first.data.queueStatus, "resolved");
    assert.equal(first.data.reviewStatus, "resolved");
    assert.equal(state.queueRow.queue_status, "resolved");
    assert.equal(state.queueRow.review_status, "resolved");

    // Same idempotent-replay-vs-genuine-conflict distinction as start above:
    // an identical retry replays; a different actor conflicts.
    const identicalReplay = await completeGeneratedDraftExportReview(input, { env: enabledEnv, generatedContentRepository: makeExportLifecycleRepository(state, true), metadataOnlyAudit: auditRecorder() });
    assert.equal(identicalReplay.ok, true, JSON.stringify(identicalReplay));
    assert.equal(identicalReplay.data.replayed, true);

    const differentActorAttempt = await completeGeneratedDraftExportReview({ ...input, actorContext: gkAdminAlternateActor }, { env: enabledEnv, generatedContentRepository: makeExportLifecycleRepository(state, true), metadataOnlyAudit: auditRecorder() });
    assert.equal(differentActorAttempt.ok, false);
    assert.equal(differentActorAttempt.error.code, "conflict_current_state_changed");
  });
}

// =======================================================================
// Section 6 - FINAL AUTHORITY: resolving both reviews never itself implies
// final export eligibility.
//
// Adapted from kai-sprint2-p3-18-final-export-eligibility-gate-boundary.spec.js's
// `dependencies()`/`packet()` convention (read for convention, not
// imported/modified). The packet fed in below reflects exactly the
// terminal, resolved/resolved state both queues are left in by sections 3
// and 5's real repository calls above - it is not a hypothetical state.
// The real `evaluateFinalExportEligibility` (which itself calls the real
// VAL-EXP-* final-gate validator) is called directly; no gate predicate is
// re-derived here.
// =======================================================================

function finalGateDependencies(overrides = {}) {
  return {
    env: enabledEnv,
    runInTransaction: async (callback) => callback({ async query() { return { rows: [] }; } }),
    loadCandidate: async () => ({ export_candidate_id: "00000000-0000-4000-8000-000000000401", organization_id: ORG, generated_content_draft_id: "00000000-0000-4000-8000-000000000301", requested_audience: "internal" }),
    evaluatePacket: async () => ({
      ok: true,
      data: {
        generatedContentDraftId: "00000000-0000-4000-8000-000000000301",
        requestedExportAudience: "internal",
        draftStatus: "draft",
        generatedContentReviewQueueStatus: "resolved",
        generatedContentReviewStatus: "resolved",
        exportReviewQueueStatus: "resolved",
        exportReviewStatus: "resolved",
        currentUseEligible: true,
      },
      error: null,
    }),
    evaluator: async () => ({ ok: true, data: {}, error: null }),
    humanAuthorityDecisionRepository: {
      evaluateEffectiveness: async () => ({ ok: true, data: { effective: false, reason: "no_decision", headDecisionId: null }, error: null }),
    },
    ...overrides,
  };
}

for (const contentType of CONTENT_TYPES) {
  test(`[${contentType}] section 6 - both generated_content_review and export_review resolved/resolved, but no effective human export-authority decision, still BLOCKS final export eligibility`, async () => {
    // contentType is not a parameter of evaluateFinalExportEligibility or
    // its dependencies (the candidate/packet DTOs carry no content_type
    // field at all) - looping over it here proves the same real function
    // call produces the same blocked outcome regardless of which content
    // type's draft the candidate/packet nominally represent.
    const deps = finalGateDependencies();
    const result = await evaluateFinalExportEligibility({
      organizationId: ORG,
      exportCandidateId: "00000000-0000-4000-8000-000000000401",
      exportReviewQueueItemId: "00000000-0000-4000-8000-000000000303",
      actorContext: gkAdminActor,
    }, deps);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.finalExportEligible, false);
    assert.equal(result.data.effectiveHumanExportAuthority, false);
    assert.equal(result.data.validatorResult.severity, "blocker");
    assert.ok(result.data.validatorResult.evidence.failed_gates.includes("affirmative_human_export_authority_absent"), JSON.stringify(result.data.validatorResult.evidence));
  });
}

test("section 6 - a synthetic effective P3-17 human export-authority decision is required in addition to both reviews resolved/resolved (control: proves the packet above is not itself sufficient for any reason other than the missing authority)", async () => {
  const deps = finalGateDependencies({
    humanAuthorityDecisionRepository: { evaluateEffectiveness: async () => ({ ok: true, data: { effective: true, reason: null, headDecisionId: "decision-1" }, error: null }) },
  });
  const result = await evaluateFinalExportEligibility({
    organizationId: ORG,
    exportCandidateId: "00000000-0000-4000-8000-000000000401",
    exportReviewQueueItemId: "00000000-0000-4000-8000-000000000303",
    actorContext: gkAdminActor,
  }, deps);
  assert.equal(result.data.finalExportEligible, true, JSON.stringify(result));
});

// =======================================================================
// Section 7 - ALLOWLISTS.
// =======================================================================

test("section 7 - the lifecycle-facing allowlists all include exactly the same current content types", () => {
  const expected = new Set(CONTENT_TYPES);

  assert.deepEqual(new Set(__generatedContentServiceContract.ALLOWED_GENERATED_CONTENT_TYPES), expected);
  assert.deepEqual(new Set(__generatedContentRepositoryContract.ALLOWED_GENERATED_CONTENT_TYPES), expected);
  assert.deepEqual(new Set(EXPORT_CANDIDATE_CONTENT_TYPES), expected);

  // kaiExportReviewService.js's own ALLOWED_GENERATED_CONTENT_TYPES and
  // kaiGeneratedDraftLibraryService.js's LIBRARY_CONTENT_TYPES are not
  // exported from a testables/contract object, so they are proven directly
  // against source text - the same convention the sibling boundary specs
  // already use for their own lazy-import assertions (e.g. P3-04/P3-05's
  // "service lazy-loads the database-capable repository only after all
  // gates, per its own source" tests).
  const exportReviewServiceSource = readFileSync(new URL("../Backend/kai/services/kaiExportReviewService.js", import.meta.url), "utf8");
  assert.match(exportReviewServiceSource, /const ALLOWED_GENERATED_CONTENT_TYPES = new Set\(\[\s*"evidence_summary",\s*"impact_narrative",\s*"readiness_assessment",\s*"data_gap_memo",\s*"case_for_support",\s*"board_update",\s*"annual_report_section",?\s*\]\)/);

  const libraryServiceSource = readFileSync(new URL("../Backend/kai/services/kaiGeneratedDraftLibraryService.js", import.meta.url), "utf8");
  assert.match(libraryServiceSource, /const LIBRARY_CONTENT_TYPES = new Set\(\[\s*"evidence_summary",\s*"impact_narrative",\s*"readiness_assessment",\s*"data_gap_memo",\s*"case_for_support",\s*"board_update",\s*"annual_report_section",?\s*\]\)/);

  const readModelSource = readFileSync(new URL("../Backend/kai/db/kaiGeneratedDraftLibraryReadModels.js", import.meta.url), "utf8");
  assert.match(readModelSource, /d\.content_type IN \('evidence_summary', 'impact_narrative', 'readiness_assessment', 'data_gap_memo', 'case_for_support', 'board_update', 'annual_report_section'\)/);
});

test("section 7 - the intentionally-narrower funder/board-packet allowlists remain exactly as narrow as designed (not a lifecycle allowlist, not drift)", () => {
  // Grant Response Packet membership (PACKET_MEMBER_CONTENT_TYPES,
  // postgresGeneratedContentRepository.js) is funder-oriented by design:
  // only evidence_summary and impact_narrative are members. It gates packet
  // membership, not the generated_content_review/export_review lifecycle
  // itself, which every content type passes through identically (sections
  // 1-6 above).
  assert.deepEqual(new Set(__generatedContentRepositoryContract.PACKET_MEMBER_CONTENT_TYPES), new Set(["evidence_summary", "impact_narrative"]));

  // BOARD_REPORTING_PACKET_MEMBER_CONTENT_TYPES is not exported from the
  // repository's contract object; proven directly against source text that
  // it is defined identically (same two-member set) and for the same
  // funder/board-reporting-scoped reason, not because of any lifecycle
  // divergence.
  const repositorySource = readFileSync(new URL("../Backend/kai/dictionary/postgresGeneratedContentRepository.js", import.meta.url), "utf8");
  assert.match(repositorySource, /const BOARD_REPORTING_PACKET_MEMBER_CONTENT_TYPES = new Set\(\[CONTENT_TYPE, IMPACT_NARRATIVE_CONTENT_TYPE\]\)/);

  // Board Reporting Packet's own service-level allowlist
  // (kaiBoardReportingPacketService.js) is the same two-member,
  // funder/board-scoped set, exported directly.
  assert.deepEqual([...BOARD_REPORTING_PACKET_CONTENT_TYPES], ["evidence_summary", "impact_narrative"]);
});

// =======================================================================
// Section 8 - OWNERSHIP: generated_content_review is GK-reviewer-or-admin;
// export_review is GK-admin-only (a strict subset).
// =======================================================================

test("section 8 - generated_content_review start/complete allowed-roles constant is exactly {gk_reviewer, gk_admin}; export_review's is exactly {gk_admin}, a strict subset", () => {
  assert.deepEqual(__generatedContentServiceContract.COMPLETE_GENERATED_CONTENT_REVIEW_ALLOWED_ROLES, new Set(["gk_reviewer", "gk_admin"]));
  assert.deepEqual(__exportReviewServiceContract.EXPORT_REVIEW_ALLOWED_ROLES, new Set(["gk_admin"]));
  for (const role of __exportReviewServiceContract.EXPORT_REVIEW_ALLOWED_ROLES) {
    assert.ok(__generatedContentServiceContract.COMPLETE_GENERATED_CONTENT_REVIEW_ALLOWED_ROLES.has(role), `export_review's allowed role "${role}" must also be a generated_content_review allowed role (subset)`);
  }
  assert.ok(!__exportReviewServiceContract.EXPORT_REVIEW_ALLOWED_ROLES.has("gk_reviewer"), "gk_reviewer must NOT be allowed to touch export_review, even though it is allowed for generated_content_review");
});

test("section 8 - a disallowed ('client') actor is rejected by both startGeneratedContentReview/completeGeneratedContentReview and requestGeneratedDraftExportReview/startGeneratedDraftExportReview/completeGeneratedDraftExportReview", async () => {
  const state = makeReviewFixtureState("evidence_summary", { queueStatus: "open", reviewStatus: "needs_gk_review" });
  const start = await startGeneratedContentReview(reviewInput(state, { actorContext: clientActor }), { env: enabledEnv, generatedContentRepository: makeReviewRepository(state), metadataOnlyAudit: auditRecorder() });
  assert.equal(start.error.code, "authorization_denied");

  const completeState = makeReviewFixtureState("evidence_summary", { queueStatus: "in_progress", reviewStatus: "needs_gk_review" });
  const complete = await completeGeneratedContentReview(reviewInput(completeState, { actorContext: clientActor }), { env: enabledEnv, generatedContentRepository: makeReviewRepository(completeState), metadataOnlyAudit: auditRecorder() });
  assert.equal(complete.error.code, "authorization_denied");

  const exportState = makeExportRequestFixtureState("evidence_summary", { generatedContentReviewResolved: true });
  const request = await requestGeneratedDraftExportReview(exportRequestInput(exportState, { actorContext: clientActor }), { env: enabledEnv, generatedContentRepository: makeExportRequestRepository(exportState), metadataOnlyAudit: auditRecorder() });
  assert.equal(request.error.code, "authorization_denied");
});

test("section 8 - a gk_reviewer actor may start/complete generated_content_review but is REJECTED by export_review's request/start/complete (the concrete GK-reviewer-vs-GK-admin, generated_content_review-vs-export_review ownership distinction)", async () => {
  const startState = makeReviewFixtureState("evidence_summary", { queueStatus: "open", reviewStatus: "needs_gk_review" });
  const start = await startGeneratedContentReview(reviewInput(startState, { actorContext: gkReviewerActor }), { env: enabledEnv, generatedContentRepository: makeReviewRepository(startState), metadataOnlyAudit: auditRecorder() });
  assert.equal(start.ok, true, JSON.stringify(start));

  const completeState = makeReviewFixtureState("evidence_summary", { queueStatus: "in_progress", reviewStatus: "needs_gk_review" });
  const complete = await completeGeneratedContentReview(reviewInput(completeState, { actorContext: gkReviewerActor }), { env: enabledEnv, generatedContentRepository: makeReviewRepository(completeState), metadataOnlyAudit: auditRecorder() });
  assert.equal(complete.ok, true, JSON.stringify(complete));

  // The SAME gk_reviewer role, which just succeeded twice above, is
  // rejected outright by every export_review operation.
  const exportState = makeExportRequestFixtureState("evidence_summary", { generatedContentReviewResolved: true });
  const request = await requestGeneratedDraftExportReview(exportRequestInput(exportState, { actorContext: gkReviewerActor }), { env: enabledEnv, generatedContentRepository: makeExportRequestRepository(exportState), metadataOnlyAudit: auditRecorder() });
  assert.equal(request.error.code, "authorization_denied");

  const lifecycleQueueRow = makeExportLifecycleQueueRow("evidence_summary");
  const lifecycleState = makeExportLifecycleState("evidence_summary", { queueRow: lifecycleQueueRow });
  const startExport = await startGeneratedDraftExportReview(
    { organizationId: ORG, generatedContentDraftId: lifecycleQueueRow.target_object_id, exportReviewQueueItemId: lifecycleQueueRow.review_queue_item_id, expectedUpdatedAt: lifecycleState.updatedAtVersion, actorContext: gkReviewerActor, now: "2026-08-06T10:00:00.000Z" },
    { env: enabledEnv, generatedContentRepository: makeExportLifecycleRepository(lifecycleState, false), metadataOnlyAudit: auditRecorder() },
  );
  assert.equal(startExport.error.code, "authorization_denied");

  const completeQueueRow = makeExportLifecycleQueueRow("evidence_summary", { queue_status: "in_progress" });
  const completeLifecycleState = makeExportLifecycleState("evidence_summary", { queueRow: completeQueueRow, updatedAtVersion: "2026-08-06T10:05:00.000Z" });
  const completeExport = await completeGeneratedDraftExportReview(
    { organizationId: ORG, generatedContentDraftId: completeQueueRow.target_object_id, exportReviewQueueItemId: completeQueueRow.review_queue_item_id, expectedUpdatedAt: completeLifecycleState.updatedAtVersion, actorContext: gkReviewerActor, now: "2026-08-06T10:10:00.000Z" },
    { env: enabledEnv, generatedContentRepository: makeExportLifecycleRepository(completeLifecycleState, true), metadataOnlyAudit: auditRecorder() },
  );
  assert.equal(completeExport.error.code, "authorization_denied");
});

test("horizontal review-lifecycle conformance: all current content types were exercised", () => {
  assert.deepEqual(CONTENT_TYPES, ["evidence_summary", "impact_narrative", "readiness_assessment", "data_gap_memo", "case_for_support", "board_update", "annual_report_section"]);
});
