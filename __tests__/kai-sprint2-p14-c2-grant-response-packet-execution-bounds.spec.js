import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateGrantResponsePacketMembershipInTransaction,
  evaluateBoardReportingPacketMembershipInTransaction,
  GRANT_RESPONSE_PACKET_MAX_CANDIDATE_DRAFTS,
  GRANT_RESPONSE_PACKET_MAX_DISTINCT_CLAIMS,
} from "../Backend/kai/dictionary/postgresGeneratedContentRepository.js";

// P14-C2: owner-directed INITIAL execution-safety bounds for the Grant
// Response Packet membership scan - 50 candidate drafts, 100 distinct cited
// claims, fail-closed with no partial packet on overflow. These are
// execution bounds over CANDIDATE state evaluated before final member
// eligibility is known, never an assertion of maximum system capacity.

const ORG = "00000000-0000-4000-8000-000000000001";
const ENGAGEMENT = "00000000-0000-4000-8000-000000000901";

function paddedId(prefix, index) {
  return `${prefix}-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

// Builds `count` distinct, fully eligible funder-audience drafts. When
// `claimsPerDraft` is 1 every draft cites its own unique claim (count
// distinct claims); when it is fractional (via `sharedClaimCount`) drafts
// share a bounded pool of claim ids instead, so the SAME claim cited by
// many drafts is proven to count once.
function buildDrafts(count, { distinctClaims = count } = {}) {
  const drafts = [];
  for (let i = 0; i < count; i += 1) {
    const draftId = paddedId("00000000", 1000 + i);
    const runId = paddedId("00000001", 1000 + i);
    const blockId = paddedId("00000002", 1000 + i);
    const citationId = paddedId("00000003", 1000 + i);
    const queueId = paddedId("00000004", 1000 + i);
    const claimIndex = i % distinctClaims;
    const claimId = paddedId("00000005", 1000 + claimIndex);
    const evidenceId = paddedId("00000006", 1000 + claimIndex);
    const sourceId = paddedId("00000007", 1000 + claimIndex);
    const sourceVersionId = paddedId("00000008", 1000 + claimIndex);

    const draft = {
      generated_content_draft_id: draftId,
      generation_run_id: runId,
      organization_id: ORG,
      content_type: "evidence_summary",
      requested_audience: "funder",
      draft_status: "draft",
      review_status: "needs_gk_review",
    };
    drafts.push({
      draftId,
      runId,
      claimId,
      evidenceId,
      sourceId,
      sourceVersionId,
      draft,
      run: {
        generation_run_id: runId,
        organization_id: ORG,
        engagement_id: ENGAGEMENT,
        request_fingerprint: "a".repeat(64),
        content_type: "evidence_summary",
        requested_audience: "funder",
      },
      siblingDrafts: [draft],
      blocks: [{
        generated_content_block_id: blockId,
        generated_content_draft_id: draftId,
        organization_id: ORG,
        ordinal: 1,
        text: `Draft ${i} governed content.`,
      }],
      citations: [{
        generated_content_citation_id: citationId,
        generated_content_block_id: blockId,
        organization_id: ORG,
        claim_id: claimId,
        evidence_item_id: evidenceId,
        block_ordinal: 1,
      }],
      queues: [{
        review_queue_item_id: queueId,
        organization_id: ORG,
        queue_type: "generated_content_review",
        target_object_type: "generated_content_draft",
        target_object_id: draftId,
        priority: "medium",
        queue_status: "resolved",
        review_status: "resolved",
        assigned_to: null,
        due_at: null,
        summary: "Generated draft requires human review.",
        required_action:
          "Review citations, audience eligibility, limitations, unsupported claims, and numeric or causal assertions before any use.",
        updated_at: "2026-08-06T09:00:00.000Z",
      }],
      exportReviewQueues: [],
    });
  }
  return drafts;
}

function firstArrayParam(params) {
  return params.find((param) => Array.isArray(param));
}

// A counting mock tx, generalized (unlike the fixed 1-9-draft fixtures in
// kai-grant-response-packet-boundary.spec.js) to any candidate-draft count,
// and honoring an optional trailing LIMIT param exactly like the real
// bounded overflow-probe query.
function makeTx(drafts) {
  const byDraftId = new Map(drafts.map((d) => [d.draftId, d]));
  const byClaimId = new Map(drafts.map((d) => [d.claimId, d]));
  return {
    counts: { total: 0 },
    async query(sql, params = []) {
      this.counts.total += 1;
      if (/FROM kai\.engagements\b/.test(sql)) {
        const [organizationId, engagementId] = params;
        return { rows: organizationId === ORG && engagementId === ENGAGEMENT ? [{ engagement_id: engagementId, organization_id: organizationId }] : [] };
      }
      if (/JOIN kai\.generation_runs r\b/.test(sql)) {
        const [organizationId, engagementId, contentTypes, draftStatus, audience, limit] = params;
        let rows = drafts
          .filter((d) => d.draft.organization_id === organizationId
            && d.run.engagement_id === engagementId
            && contentTypes.includes(d.draft.content_type)
            && d.draft.draft_status === draftStatus
            && d.draft.requested_audience === audience)
          .sort((a, b) => (a.draftId < b.draftId ? -1 : 1))
          .map((d) => ({ generated_content_draft_id: d.draftId }));
        if (/LIMIT \$6/.test(sql)) rows = rows.slice(0, limit);
        return { rows };
      }
      if (/FROM kai\.generated_content_drafts\b/.test(sql) && /WHERE organization_id/.test(sql) && /ANY/.test(sql)) {
        const [organizationId] = params;
        const draftIds = firstArrayParam(params);
        const rows = draftIds.map((id) => byDraftId.get(id)).filter((d) => d && d.draft.organization_id === organizationId).map((d) => d.draft);
        return { rows };
      }
      if (/FROM kai\.generated_content_drafts\b/.test(sql) && /WHERE generation_run_id = ANY/.test(sql)) {
        const runIds = firstArrayParam(params);
        const rows = drafts.filter((d) => runIds.includes(d.runId)).flatMap((d) => d.siblingDrafts);
        return { rows };
      }
      if (/FROM kai\.generation_runs\b/.test(sql) && !/JOIN/.test(sql)) {
        const runIds = firstArrayParam(params);
        const rows = drafts.filter((d) => runIds.includes(d.runId)).map((d) => d.run);
        return { rows };
      }
      if (/FROM kai\.generated_content_blocks\b/.test(sql)) {
        const draftIds = firstArrayParam(params);
        const rows = draftIds.flatMap((id) => byDraftId.get(id)?.blocks || []);
        return { rows };
      }
      if (/FROM kai\.generated_content_citations\b/.test(sql)) {
        const blockIds = firstArrayParam(params);
        const rows = drafts.flatMap((d) => d.citations.filter((c) => blockIds.includes(c.generated_content_block_id)));
        return { rows };
      }
      if (/FROM kai\.review_queue_items\b/.test(sql) && /blocked_reason/.test(sql)) {
        const draftIds = firstArrayParam(params);
        const rows = draftIds.flatMap((id) => byDraftId.get(id)?.exportReviewQueues || []);
        return { rows };
      }
      if (/FROM kai\.review_queue_items\b/.test(sql)) {
        const draftIds = firstArrayParam(params);
        const rows = draftIds.flatMap((id) => byDraftId.get(id)?.queues || []);
        return { rows };
      }
      throw new Error(`unexpected query in P14-C2 execution-bound test: ${sql}`);
    },
    evaluatorCallCount: 0,
    _byClaimId: byClaimId,
  };
}

function makeEvaluator(tx) {
  return async (evalTx, { claimId, requestedAudience }) => {
    tx.evaluatorCallCount += 1;
    const draft = tx._byClaimId.get(claimId);
    return {
      ok: true,
      data: {
        claim: { claim_id: claimId, claim_type: "finding", claim_status: "proposed", claim_review_status: "approved", claim_strength: "strong", audience_gates: {} },
        evidence: {
          evidence_item_id: draft.evidenceId,
          evidence_review_status: "approved",
          support_strength: "strong",
          review_queue_item_id: "00000000-0000-4000-8000-000000000601",
          review_queue_status: "closed",
          review_status: "approved",
          updated_at: "2026-08-06T09:00:00.000Z",
          sensitivity_level: "unknown",
        },
        locator: { source_locator_id: "00000000-0000-4000-8000-000000000602" },
        source: { source_id: draft.sourceId, source_code: null },
        source_version: { source_version_id: draft.sourceVersionId, is_current: true },
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
          { relationship_type: "claim_supported_by_evidence", from_object_type: "claim", from_object_id: claimId, to_object_type: "evidence_item", to_object_id: draft.evidenceId },
          { relationship_type: "evidence_located_by_source_locator", from_object_type: "evidence_item", from_object_id: draft.evidenceId, to_object_type: "source_locator", to_object_id: "00000000-0000-4000-8000-000000000602" },
          { relationship_type: "evidence_from_source_version", from_object_type: "evidence_item", from_object_id: draft.evidenceId, to_object_type: "source_version", to_object_id: draft.sourceVersionId },
          { relationship_type: "source_version_of_source", from_object_type: "source_version", from_object_id: draft.sourceVersionId, to_object_type: "source", to_object_id: draft.sourceId },
          { relationship_type: "source_version_from_candidate", from_object_type: "source_version", from_object_id: draft.sourceVersionId, to_object_type: "intake_source_candidate", to_object_id: "00000000-0000-4000-8000-000000000604" },
          { relationship_type: "candidate_governed_by_data_dictionary", from_object_type: "intake_source_candidate", from_object_id: "00000000-0000-4000-8000-000000000604", to_object_type: "data_dictionary", to_object_id: "00000000-0000-4000-8000-000000000608" },
          { relationship_type: "candidate_governed_by_sensitivity_profile", from_object_type: "intake_source_candidate", from_object_id: "00000000-0000-4000-8000-000000000604", to_object_type: "intake_sensitivity_profile", to_object_id: "00000000-0000-4000-8000-000000000609" },
          { relationship_type: "evidence_review_queue", from_object_type: "evidence_item", from_object_id: draft.evidenceId, to_object_type: "review_queue_item", to_object_id: "00000000-0000-4000-8000-000000000601" },
          { relationship_type: "claim_review_queue", from_object_type: "claim", from_object_id: claimId, to_object_type: "review_queue_item", to_object_id: "00000000-0000-4000-8000-000000000603" },
        ],
        graph_trace_completeness: { complete: true, missing_relationship_types: [], invalid_relationship_count: 0 },
        requestedAudience,
        eligible: true,
        blockerCodes: [],
        affectedDimensionKeys: [],
        affectedObjectIds: [],
        truncated: false,
      },
      error: null,
    };
  };
}

function evaluateBounded(tx, { maxCandidateDrafts, maxDistinctClaims } = {}) {
  const evaluator = makeEvaluator(tx);
  return evaluateGrantResponsePacketMembershipInTransaction(
    tx,
    { organizationId: ORG, engagementId: ENGAGEMENT },
    evaluator,
    undefined,
    { maxCandidateDrafts, maxDistinctClaims },
  );
}

test("P14-C2 constants: 50 candidate drafts / 100 distinct claims, as owner-directed", () => {
  assert.equal(GRANT_RESPONSE_PACKET_MAX_CANDIDATE_DRAFTS, 50);
  assert.equal(GRANT_RESPONSE_PACKET_MAX_DISTINCT_CLAIMS, 100);
});

test("50 candidate drafts are admitted to normal packet evaluation", async () => {
  const drafts = buildDrafts(50);
  const tx = makeTx(drafts);
  const result = await evaluateBounded(tx, { maxCandidateDrafts: 50, maxDistinctClaims: 100 });
  assert.equal(result.ok, true);
  assert.equal(result.data.drafts.length, 50);
  assert.equal(tx.evaluatorCallCount, 50);
});

test("51 candidate drafts fail closed before the claim evaluator runs, with no partial packet", async () => {
  const drafts = buildDrafts(51);
  const tx = makeTx(drafts);
  const result = await evaluateBounded(tx, { maxCandidateDrafts: 50, maxDistinctClaims: 100 });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(result.data, null);
  assert.equal(tx.evaluatorCallCount, 0, "evaluator must never be invoked once the candidate-draft bound is exceeded");
  assert.equal(result.blockers[0].blocking_reason, "candidate_drafts_execution_bound_exceeded");
  assert.equal(result.blockers[0].evidence.bound_dimension, "candidate_drafts");
  assert.equal(result.blockers[0].evidence.configured_limit, 50);
});

test("100 distinct claims are admitted to normal packet evaluation", async () => {
  // 100 drafts each citing its own claim, with the candidate-draft bound
  // disabled here so only the distinct-claim bound is under test.
  const hundredClaimDrafts = buildDrafts(100, { distinctClaims: 100 });
  const tx = makeTx(hundredClaimDrafts);
  const result = await evaluateBounded(tx, { maxCandidateDrafts: null, maxDistinctClaims: 100 });
  assert.equal(result.ok, true);
  assert.equal(result.data.drafts.length, 100);
  assert.equal(tx.evaluatorCallCount, 100);
});

test("101 distinct claims fail closed before evaluateClaimTraceabilityInTransaction, with no partial packet", async () => {
  const drafts = buildDrafts(101, { distinctClaims: 101 });
  const tx = makeTx(drafts);
  const result = await evaluateBounded(tx, { maxCandidateDrafts: null, maxDistinctClaims: 100 });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(result.data, null);
  assert.equal(tx.evaluatorCallCount, 0, "evaluator must never be invoked once the distinct-claim bound is exceeded");
  assert.equal(result.blockers[0].blocking_reason, "distinct_claims_execution_bound_exceeded");
  assert.equal(result.blockers[0].evidence.bound_dimension, "distinct_claims");
  assert.equal(result.blockers[0].evidence.configured_limit, 100);
  assert.equal(result.blockers[0].evidence.observed_count, 101);
});

test("a claim cited by many candidate drafts counts once toward the distinct-claim bound", async () => {
  // 150 drafts, but only 40 distinct claims (heavy re-citation) - well under
  // the 100-distinct-claim bound, so this must be admitted even though the
  // raw citation count (150) would exceed 100 if citations were miscounted
  // per-citation instead of per-unique-claim-id. Also exceeds the 50
  // candidate-draft bound, so the candidate-draft bound is disabled here to
  // isolate the distinct-claim counting behavior.
  const drafts = buildDrafts(150, { distinctClaims: 40 });
  const tx = makeTx(drafts);
  const result = await evaluateBounded(tx, { maxCandidateDrafts: null, maxDistinctClaims: 100 });
  assert.equal(result.ok, true);
  assert.equal(tx.evaluatorCallCount, 40, "each distinct claim must be evaluated at most once regardless of citing-draft count");
});

test("Board Reporting membership is unaffected by the Grant Response Packet execution bounds", async () => {
  // Board Reporting's own wrapper never supplies maxCandidateDrafts/
  // maxDistinctClaims, so a candidate/claim count that would fail-closed on
  // the funder path must still be admitted on the internal (Board
  // Reporting) audience path.
  const drafts = buildDrafts(51).map((d) => ({
    ...d,
    draft: { ...d.draft, requested_audience: "internal" },
    run: { ...d.run, requested_audience: "internal" },
  }));
  const tx = makeTx(drafts);
  const evaluator = makeEvaluator(tx);
  const result = await evaluateBoardReportingPacketMembershipInTransaction(
    tx,
    { organizationId: ORG, engagementId: ENGAGEMENT },
    evaluator,
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.drafts.length, 51);
});
