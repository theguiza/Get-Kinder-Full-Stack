import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  evaluateGrantResponsePacketMembershipInTransaction,
  __generatedContentRepositoryTestables,
} from "../Backend/kai/dictionary/postgresGeneratedContentRepository.js";
import {
  getGrantResponsePacket,
  __grantResponsePacketServiceTestables,
} from "../Backend/kai/services/kaiGrantResponsePacketService.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const ENGAGEMENT = "00000000-0000-4000-8000-000000000701";
const OTHER_ENGAGEMENT = "00000000-0000-4000-8000-000000000702";

const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" });

function actorWithRole(role) {
  return Object.freeze({
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000001",
    source: "public.userdata",
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: role }],
  });
}
const reviewerActor = actorWithRole("gk_reviewer");
const adminActor = actorWithRole("gk_admin");

// One coherent per-draft immutable graph, parameterized only by the ids,
// review/eligibility state, and requested_audience a test needs to vary -
// shaped identically to the existing P3-02 review-packet boundary test's own
// `state()`/`dto()` fixtures, since a Grant Response Packet member is
// exactly that same governed packet, never a second shape.
function draftFixture(n, { queueStatus, reviewStatus, eligible = true, audience = "funder" }) {
  const draftId = `00000000-0000-4000-8000-0000000009${n}1`;
  const runId = `00000000-0000-4000-8000-0000000009${n}2`;
  const blockId = `00000000-0000-4000-8000-0000000009${n}3`;
  const citationId = `00000000-0000-4000-8000-0000000009${n}4`;
  const queueId = `00000000-0000-4000-8000-0000000009${n}5`;
  const claimId = `00000000-0000-4000-8000-0000000009${n}6`;
  const evidenceId = `00000000-0000-4000-8000-0000000009${n}7`;
  const sourceId = `00000000-0000-4000-8000-0000000009${n}8`;
  const sourceVersionId = `00000000-0000-4000-8000-0000000009${n}9`;

  // kai.generated_content_drafts.review_status is a separate, immutable
  // static field (always "needs_gk_review" per its own contract - review
  // progress lives entirely in the joined kai.review_queue_items row's own
  // queue_status/review_status, never here).
  const draft = {
    generated_content_draft_id: draftId,
    generation_run_id: runId,
    organization_id: ORG,
    content_type: "evidence_summary",
    requested_audience: audience,
    draft_status: "draft",
    review_status: "needs_gk_review",
  };
  return {
    draftId,
    runId,
    claimId,
    evidenceId,
    sourceId,
    sourceVersionId,
    audience,
    draft,
    run: {
      generation_run_id: runId,
      organization_id: ORG,
      request_fingerprint: "a".repeat(64),
      content_type: "evidence_summary",
      requested_audience: audience,
    },
    siblingDrafts: [draft],
    blocks: [{
      generated_content_block_id: blockId,
      generated_content_draft_id: draftId,
      organization_id: ORG,
      ordinal: 1,
      text: `Draft ${n} governed content.`,
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
      queue_status: queueStatus,
      review_status: reviewStatus,
      assigned_to: null,
      due_at: null,
      summary: "Generated draft requires human review.",
      required_action:
        "Review citations, audience eligibility, limitations, unsupported claims, and numeric or causal assertions before any use.",
      updated_at: "2026-08-06T09:00:00.000Z",
    }],
    exportReviewQueues: [],
    eligible,
  };
}

const DRAFT_A = draftFixture(1, { queueStatus: "resolved", reviewStatus: "resolved", eligible: true, audience: "funder" });
const DRAFT_B = draftFixture(2, { queueStatus: "open", reviewStatus: "needs_gk_review", eligible: true, audience: "funder" });
const DRAFT_C = draftFixture(3, { queueStatus: "resolved", reviewStatus: "resolved", eligible: false, audience: "funder" });
const DRAFT_D = draftFixture(4, { queueStatus: "resolved", reviewStatus: "resolved", eligible: true, audience: "funder" });
// Identical resolved/eligible state to DRAFT_A, same engagement, differing
// only by requested_audience - proves funder-only membership: neither
// "internal" nor "public" is ever treated as equivalent to "funder", no
// matter how eligible/resolved the underlying draft is.
const DRAFT_E_INTERNAL = draftFixture(5, { queueStatus: "resolved", reviewStatus: "resolved", eligible: true, audience: "internal" });
const DRAFT_F_PUBLIC = draftFixture(6, { queueStatus: "resolved", reviewStatus: "resolved", eligible: true, audience: "public" });

const ALL_FIXTURES = [DRAFT_A, DRAFT_B, DRAFT_C, DRAFT_D, DRAFT_E_INTERNAL, DRAFT_F_PUBLIC];
const FIXTURES_BY_DRAFT_ID = Object.fromEntries(ALL_FIXTURES.map((fixture) => [fixture.draftId, fixture]));
// Mirrors what the real `generated_content_drafts JOIN generation_runs`
// membership query would itself return before any content_type/draft_status/
// requested_audience/organization filtering is applied by the mock query
// handler below - exactly like the live SQL's own WHERE clause, not a
// pre-filtered fixture list.
const MEMBERSHIP_BY_ENGAGEMENT = {
  [ENGAGEMENT]: [DRAFT_A.draftId, DRAFT_B.draftId, DRAFT_C.draftId, DRAFT_E_INTERNAL.draftId, DRAFT_F_PUBLIC.draftId],
  [OTHER_ENGAGEMENT]: [DRAFT_D.draftId],
};
const ENGAGEMENT_ROWS = [
  { engagement_id: ENGAGEMENT, organization_id: ORG },
  { engagement_id: OTHER_ENGAGEMENT, organization_id: ORG },
];

function evaluatorFor(fixture) {
  return async (tx, { claimId }) => ({
    ok: true,
    data: {
      claim: {
        claim_id: claimId,
        claim_type: "finding",
        claim_status: "proposed",
        claim_review_status: "approved",
        claim_strength: "strong",
        audience_gates: {},
      },
      evidence: {
        evidence_item_id: fixture.evidenceId,
        evidence_review_status: "approved",
        support_strength: "strong",
        review_queue_item_id: "00000000-0000-4000-8000-000000000601",
        review_queue_status: "closed",
        review_status: "approved",
        updated_at: "2026-08-06T09:00:00.000Z",
        sensitivity_level: "unknown",
      },
      locator: { source_locator_id: "00000000-0000-4000-8000-000000000602" },
      source: { source_id: fixture.sourceId, source_code: null },
      source_version: { source_version_id: fixture.sourceVersionId, is_current: true },
      claim_review: { review_queue_item_id: "00000000-0000-4000-8000-000000000603", queue_status: "closed", review_status: "approved" },
      evidence_review_decision: { decision_id: "00000000-0000-4000-8000-000000000606", decision_outcome: "accepted" },
      claim_review_decision: {
        decision_id: "00000000-0000-4000-8000-000000000607",
        decision_outcome: "accepted",
        approved_audiences: ["internal", "funder"],
      },
      candidate: { intake_source_candidate_id: "00000000-0000-4000-8000-000000000604" },
      promotion_decision: { intake_promotion_decision_id: "00000000-0000-4000-8000-000000000605" },
      dimensions: {},
      gap_items: [],
      client_followup_workflows: [],
      potential_conflict_groups: [],
      graph_relationships: [
        { relationship_type: "claim_supported_by_evidence", from_object_type: "claim", from_object_id: claimId, to_object_type: "evidence_item", to_object_id: fixture.evidenceId },
        { relationship_type: "evidence_located_by_source_locator", from_object_type: "evidence_item", from_object_id: fixture.evidenceId, to_object_type: "source_locator", to_object_id: "00000000-0000-4000-8000-000000000602" },
        { relationship_type: "evidence_from_source_version", from_object_type: "evidence_item", from_object_id: fixture.evidenceId, to_object_type: "source_version", to_object_id: fixture.sourceVersionId },
        { relationship_type: "source_version_of_source", from_object_type: "source_version", from_object_id: fixture.sourceVersionId, to_object_type: "source", to_object_id: fixture.sourceId },
        { relationship_type: "source_version_from_candidate", from_object_type: "source_version", from_object_id: fixture.sourceVersionId, to_object_type: "intake_source_candidate", to_object_id: "00000000-0000-4000-8000-000000000604" },
        { relationship_type: "candidate_governed_by_data_dictionary", from_object_type: "intake_source_candidate", from_object_id: "00000000-0000-4000-8000-000000000604", to_object_type: "data_dictionary", to_object_id: "00000000-0000-4000-8000-000000000608" },
        { relationship_type: "candidate_governed_by_sensitivity_profile", from_object_type: "intake_source_candidate", from_object_id: "00000000-0000-4000-8000-000000000604", to_object_type: "intake_sensitivity_profile", to_object_id: "00000000-0000-4000-8000-000000000609" },
        { relationship_type: "evidence_review_queue", from_object_type: "evidence_item", from_object_id: fixture.evidenceId, to_object_type: "review_queue_item", to_object_id: "00000000-0000-4000-8000-000000000601" },
        { relationship_type: "claim_review_queue", from_object_type: "claim", from_object_id: claimId, to_object_type: "review_queue_item", to_object_id: "00000000-0000-4000-8000-000000000603" },
      ],
      graph_trace_completeness: { complete: true, missing_relationship_types: [], invalid_relationship_count: 0 },
      requestedAudience: fixture.audience,
      eligible: fixture.eligible,
      blockerCodes: fixture.eligible ? [] : ["evidence_superseded"],
      affectedDimensionKeys: [],
      affectedObjectIds: [],
      truncated: false,
    },
    error: null,
  });
}

// One evaluator dispatching by claimId to whichever fixture owns that claim -
// toReviewPacket is reused unmodified per draft, so a single shared evaluator
// function must serve every draft composed in the same membership scan.
const sharedEvaluator = async (tx, args) => {
  const fixture = ALL_FIXTURES.find((f) => f.claimId === args.claimId);
  return evaluatorFor(fixture)(tx, args);
};

function firstArrayParam(params) {
  return params.find((param) => Array.isArray(param));
}

// Models the bounded/batched read architecture exactly: a fixed, small
// number of queries regardless of membership size (engagement existence +
// membership listing + one batched query per row group), each expressed as
// `= ANY($n::uuid[])` over every member draft id / generation run id / block
// id at once - never a query issued per member draft. No "current draft"
// pointer exists in this mock because the production code no longer reads
// one draft's graph at a time.
function makeTx() {
  return {
    async query(sql, params = []) {
      if (/FROM kai\.engagements\b/.test(sql)) {
        const [organizationId, engagementId] = params;
        const row = ENGAGEMENT_ROWS.find((r) => r.organization_id === organizationId && r.engagement_id === engagementId);
        return { rows: row ? [row] : [] };
      }
      if (/JOIN kai\.generation_runs r\b/.test(sql)) {
        const [organizationId, engagementId, contentTypes, draftStatus, audience] = params;
        const ids = MEMBERSHIP_BY_ENGAGEMENT[engagementId] || [];
        const rows = ids
          .map((id) => FIXTURES_BY_DRAFT_ID[id])
          .filter((fixture) => fixture
            && fixture.draft.organization_id === organizationId
            && contentTypes.includes(fixture.draft.content_type)
            && fixture.draft.draft_status === draftStatus
            && fixture.draft.requested_audience === audience)
          .map((fixture) => ({ generated_content_draft_id: fixture.draftId }));
        return { rows };
      }
      if (/FROM kai\.generated_content_drafts\b/.test(sql) && /WHERE organization_id/.test(sql) && /ANY/.test(sql)) {
        const [organizationId] = params;
        const draftIds = firstArrayParam(params);
        const rows = draftIds
          .map((id) => FIXTURES_BY_DRAFT_ID[id])
          .filter((fixture) => fixture && fixture.draft.organization_id === organizationId)
          .map((fixture) => fixture.draft);
        return { rows };
      }
      if (/FROM kai\.generated_content_drafts\b/.test(sql) && /WHERE generation_run_id = ANY/.test(sql)) {
        const runIds = firstArrayParam(params);
        const rows = ALL_FIXTURES.filter((fixture) => runIds.includes(fixture.runId)).flatMap((fixture) => fixture.siblingDrafts);
        return { rows };
      }
      if (/FROM kai\.generation_runs\b/.test(sql) && !/JOIN/.test(sql)) {
        const runIds = firstArrayParam(params);
        const rows = ALL_FIXTURES.filter((fixture) => runIds.includes(fixture.runId)).map((fixture) => fixture.run);
        return { rows };
      }
      if (/FROM kai\.generated_content_blocks\b/.test(sql)) {
        const draftIds = firstArrayParam(params);
        const rows = draftIds.flatMap((id) => FIXTURES_BY_DRAFT_ID[id]?.blocks || []);
        return { rows };
      }
      if (/FROM kai\.generated_content_citations\b/.test(sql)) {
        const blockIds = firstArrayParam(params);
        const rows = ALL_FIXTURES.flatMap((fixture) => fixture.citations.filter((citation) => blockIds.includes(citation.generated_content_block_id)));
        return { rows };
      }
      if (/FROM kai\.review_queue_items\b/.test(sql) && /blocked_reason/.test(sql)) {
        const draftIds = firstArrayParam(params);
        const rows = draftIds.flatMap((id) => FIXTURES_BY_DRAFT_ID[id]?.exportReviewQueues || []);
        return { rows };
      }
      if (/FROM kai\.review_queue_items\b/.test(sql)) {
        const draftIds = firstArrayParam(params);
        const rows = draftIds.flatMap((id) => FIXTURES_BY_DRAFT_ID[id]?.queues || []);
        return { rows };
      }
      throw new Error(`unexpected query in grant-response-packet boundary test: ${sql}`);
    },
  };
}

// Counting variant of makeTx() - proves the read architecture issues a
// query count that never scales with membership size (no per-draft
// SQL/read-packet fan-out).
function makeCountingTx() {
  const base = makeTx();
  const counts = { total: 0 };
  return {
    counts,
    async query(sql, params) {
      counts.total += 1;
      return base.query(sql, params);
    },
  };
}

test("Grant Response Packet membership includes only the requesting engagement's own eligible funder-audience drafts", async () => {
  const result = await evaluateGrantResponsePacketMembershipInTransaction(
    makeTx(),
    { organizationId: ORG, engagementId: ENGAGEMENT },
    sharedEvaluator,
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.drafts.length, 1);
  assert.equal(result.data.drafts[0].generatedContentDraftId, DRAFT_A.draftId);
  assert.equal(result.data.drafts[0].requestedAudience, "funder");
  assert.equal(result.data.packetAudience, "funder");
});

test("Grant Response Packet membership excludes drafts belonging to a different engagement", async () => {
  const result = await evaluateGrantResponsePacketMembershipInTransaction(
    makeTx(),
    { organizationId: ORG, engagementId: OTHER_ENGAGEMENT },
    sharedEvaluator,
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.drafts.length, 1);
  assert.equal(result.data.drafts[0].generatedContentDraftId, DRAFT_D.draftId);
  assert.ok(!result.data.drafts.some((d) => d.generatedContentDraftId === DRAFT_A.draftId));
});

test("Grant Response Packet membership fails closed for an engagement that does not belong to the requesting organization", async () => {
  const result = await evaluateGrantResponsePacketMembershipInTransaction(
    makeTx(),
    { organizationId: OTHER_ORG, engagementId: ENGAGEMENT },
    sharedEvaluator,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
});

test("Grant Response Packet membership excludes not-yet-reviewed and blocked/ineligible drafts even though they belong to the engagement", async () => {
  const result = await evaluateGrantResponsePacketMembershipInTransaction(
    makeTx(),
    { organizationId: ORG, engagementId: ENGAGEMENT },
    sharedEvaluator,
  );
  assert.equal(result.ok, true);
  const ids = result.data.drafts.map((d) => d.generatedContentDraftId);
  assert.ok(!ids.includes(DRAFT_B.draftId), "not-yet-reviewed draft must never become packet membership");
  assert.ok(!ids.includes(DRAFT_C.draftId), "currentUseEligible=false draft must never become packet membership");
});

test("Grant Response Packet membership excludes an identical internal-audience draft in the same engagement", async () => {
  const result = await evaluateGrantResponsePacketMembershipInTransaction(
    makeTx(),
    { organizationId: ORG, engagementId: ENGAGEMENT },
    sharedEvaluator,
  );
  assert.equal(result.ok, true);
  const ids = result.data.drafts.map((d) => d.generatedContentDraftId);
  assert.ok(!ids.includes(DRAFT_E_INTERNAL.draftId), "requested_audience=internal must never be treated as equivalent to funder");
});

test("Grant Response Packet membership excludes an identical public-audience draft in the same engagement", async () => {
  const result = await evaluateGrantResponsePacketMembershipInTransaction(
    makeTx(),
    { organizationId: ORG, engagementId: ENGAGEMENT },
    sharedEvaluator,
  );
  assert.equal(result.ok, true);
  const ids = result.data.drafts.map((d) => d.generatedContentDraftId);
  assert.ok(!ids.includes(DRAFT_F_PUBLIC.draftId), "requested_audience=public must never be treated as equivalent to funder");
});

test("Grant Response Packet membership is deterministic across repeated evaluation of the same governed state", async () => {
  const first = await evaluateGrantResponsePacketMembershipInTransaction(
    makeTx(),
    { organizationId: ORG, engagementId: ENGAGEMENT },
    sharedEvaluator,
  );
  const second = await evaluateGrantResponsePacketMembershipInTransaction(
    makeTx(),
    { organizationId: ORG, engagementId: ENGAGEMENT },
    sharedEvaluator,
  );
  assert.deepEqual(first.data, second.data);
});

test("Grant Response Packet composition preserves exact citation identity and support/eligibility fields, with no cross-draft substitution", async () => {
  const result = await evaluateGrantResponsePacketMembershipInTransaction(
    makeTx(),
    { organizationId: ORG, engagementId: ENGAGEMENT },
    sharedEvaluator,
  );
  const [packet] = result.data.drafts;
  assert.equal(packet.blocks[0].generatedContentBlockId, DRAFT_A.blocks[0].generated_content_block_id);
  const [citation] = packet.blocks[0].citations;
  assert.equal(citation.generatedContentCitationId, DRAFT_A.citations[0].generated_content_citation_id);
  assert.equal(citation.claimId, DRAFT_A.claimId);
  assert.equal(citation.evidenceItemId, DRAFT_A.evidenceId);
  assert.equal(citation.sourceId, DRAFT_A.sourceId);
  assert.equal(citation.sourceVersionId, DRAFT_A.sourceVersionId);
  assert.equal(citation.currentEligible, true);
  assert.deepEqual(citation.blockerCodes, []);
  assert.notEqual(citation.claimId, DRAFT_C.claimId);
});

test("Grant Response Packet membership query resolves engagement_id by plain equality only - never a NULL-matching or latest/newest guess", () => {
  const source = readFileSync(
    new URL("../Backend/kai/dictionary/postgresGeneratedContentRepository.js", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("async function loadGrantResponsePacketMemberDraftIds");
  const end = source.indexOf("\n}\n", start);
  const fn = source.slice(start, end);
  assert.ok(/r\.engagement_id\s*=\s*\$2::uuid/.test(fn));
  assert.ok(!/IS NOT DISTINCT FROM/.test(fn));
  assert.ok(!/COALESCE/.test(fn));
  assert.ok(!/ORDER BY.*created_at/.test(fn));
  assert.ok(!/LIMIT 1/.test(fn));
  assert.ok(/requested_audience\s*=\s*\$5/.test(fn), "membership must require an exact requested_audience match");
});

test("Grant Response Packet membership issues a fixed, bounded query count that never scales with membership size (no per-draft SQL fan-out)", async () => {
  const smallTx = makeCountingTx();
  await evaluateGrantResponsePacketMembershipInTransaction(
    smallTx,
    { organizationId: ORG, engagementId: OTHER_ENGAGEMENT },
    sharedEvaluator,
  );
  const smallCount = smallTx.counts.total;

  const largeTx = makeCountingTx();
  await evaluateGrantResponsePacketMembershipInTransaction(
    largeTx,
    { organizationId: ORG, engagementId: ENGAGEMENT },
    sharedEvaluator,
  );
  const largeCount = largeTx.counts.total;

  // OTHER_ENGAGEMENT has 1 candidate draft, ENGAGEMENT has 5 - a per-draft
  // fan-out would issue strictly more queries for the larger membership set.
  // The bounded/batched architecture issues the same fixed query count
  // (engagement check + membership listing + 7 batched row-group reads)
  // regardless.
  assert.equal(smallCount, 9);
  assert.equal(largeCount, 9);
});

test("Grant Response Packet membership evaluates a claim cited by more than one member draft at most once, never once per citing draft", async () => {
  // A dedicated two-draft engagement where both drafts cite the exact same
  // claim/evidence/source/source-version - the only way to prove the
  // evaluator itself (not just the batched structural read) stays flat
  // as membership grows, since the shared module-level fixtures above
  // never let two eligible packet members share a claim.
  const org = "00000000-0000-4000-8000-000000000001";
  const engagementId = "00000000-0000-4000-8000-000000000801";
  const sharedClaimId = "00000000-0000-4000-8000-000000000811";
  const sharedEvidenceId = "00000000-0000-4000-8000-000000000812";
  const sharedSourceId = "00000000-0000-4000-8000-000000000813";
  const sharedSourceVersionId = "00000000-0000-4000-8000-000000000814";

  function sharedClaimDraft(n) {
    const draftId = `00000000-0000-4000-8000-0000000082${n}1`;
    const runId = `00000000-0000-4000-8000-0000000082${n}2`;
    const blockId = `00000000-0000-4000-8000-0000000082${n}3`;
    const citationId = `00000000-0000-4000-8000-0000000082${n}4`;
    const queueId = `00000000-0000-4000-8000-0000000082${n}5`;
    const draft = {
      generated_content_draft_id: draftId,
      generation_run_id: runId,
      organization_id: org,
      content_type: "evidence_summary",
      requested_audience: "funder",
      draft_status: "draft",
      review_status: "needs_gk_review",
    };
    return {
      draftId,
      runId,
      draft,
      run: { generation_run_id: runId, organization_id: org, request_fingerprint: "a".repeat(64), content_type: "evidence_summary", requested_audience: "funder" },
      siblingDrafts: [draft],
      blocks: [{ generated_content_block_id: blockId, generated_content_draft_id: draftId, organization_id: org, ordinal: 1, text: `Shared-claim draft ${n}.` }],
      citations: [{
        generated_content_citation_id: citationId,
        generated_content_block_id: blockId,
        organization_id: org,
        claim_id: sharedClaimId,
        evidence_item_id: sharedEvidenceId,
        block_ordinal: 1,
      }],
      queues: [{
        review_queue_item_id: queueId,
        organization_id: org,
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
    };
  }

  const sharedDraft1 = sharedClaimDraft(1);
  const sharedDraft2 = sharedClaimDraft(2);
  const fixturesById = { [sharedDraft1.draftId]: sharedDraft1, [sharedDraft2.draftId]: sharedDraft2 };
  const allDraftIds = [sharedDraft1.draftId, sharedDraft2.draftId];

  const tx = {
    async query(sql, params) {
      if (/FROM kai\.engagements\b/.test(sql)) {
        return { rows: [{ engagement_id: engagementId, organization_id: org }] };
      }
      if (/JOIN kai\.generation_runs r\b/.test(sql)) {
        return { rows: allDraftIds.map((id) => ({ generated_content_draft_id: id })) };
      }
      if (/FROM kai\.generated_content_drafts\b/.test(sql) && /WHERE organization_id/.test(sql) && /ANY/.test(sql)) {
        const draftIds = firstArrayParam(params);
        return { rows: draftIds.map((id) => fixturesById[id].draft) };
      }
      if (/FROM kai\.generated_content_drafts\b/.test(sql) && /WHERE generation_run_id = ANY/.test(sql)) {
        const runIds = firstArrayParam(params);
        return { rows: Object.values(fixturesById).filter((f) => runIds.includes(f.runId)).flatMap((f) => f.siblingDrafts) };
      }
      if (/FROM kai\.generation_runs\b/.test(sql) && !/JOIN/.test(sql)) {
        const runIds = firstArrayParam(params);
        return { rows: Object.values(fixturesById).filter((f) => runIds.includes(f.runId)).map((f) => f.run) };
      }
      if (/FROM kai\.generated_content_blocks\b/.test(sql)) {
        const draftIds = firstArrayParam(params);
        return { rows: draftIds.flatMap((id) => fixturesById[id].blocks) };
      }
      if (/FROM kai\.generated_content_citations\b/.test(sql)) {
        const blockIds = firstArrayParam(params);
        return { rows: Object.values(fixturesById).flatMap((f) => f.citations.filter((c) => blockIds.includes(c.generated_content_block_id))) };
      }
      if (/FROM kai\.review_queue_items\b/.test(sql) && /blocked_reason/.test(sql)) {
        const draftIds = firstArrayParam(params);
        return { rows: draftIds.flatMap((id) => fixturesById[id].exportReviewQueues) };
      }
      if (/FROM kai\.review_queue_items\b/.test(sql)) {
        const draftIds = firstArrayParam(params);
        return { rows: draftIds.flatMap((id) => fixturesById[id].queues) };
      }
      throw new Error(`unexpected query in shared-claim boundary test: ${sql}`);
    },
  };

  let evaluatorCalls = 0;
  const countingEvaluator = async (tx2, args) => {
    evaluatorCalls += 1;
    assert.equal(args.claimId, sharedClaimId);
    return {
      ok: true,
      data: {
        claim: { claim_id: sharedClaimId, claim_type: "finding", claim_status: "proposed", claim_review_status: "approved", claim_strength: "strong", audience_gates: {} },
        evidence: { evidence_item_id: sharedEvidenceId, evidence_review_status: "approved", support_strength: "strong", review_queue_item_id: "00000000-0000-4000-8000-000000000901", review_queue_status: "closed", review_status: "approved", updated_at: "2026-08-06T09:00:00.000Z", sensitivity_level: "unknown" },
        locator: { source_locator_id: "00000000-0000-4000-8000-000000000902" },
        source: { source_id: sharedSourceId, source_code: null },
        source_version: { source_version_id: sharedSourceVersionId, is_current: true },
        claim_review: { review_queue_item_id: "00000000-0000-4000-8000-000000000903", queue_status: "closed", review_status: "approved" },
        evidence_review_decision: { decision_id: "00000000-0000-4000-8000-000000000906", decision_outcome: "accepted" },
        claim_review_decision: {
          decision_id: "00000000-0000-4000-8000-000000000907",
          decision_outcome: "accepted",
          approved_audiences: ["internal", "funder"],
        },
        candidate: { intake_source_candidate_id: "00000000-0000-4000-8000-000000000904" },
        promotion_decision: { intake_promotion_decision_id: "00000000-0000-4000-8000-000000000905" },
        dimensions: {},
        gap_items: [],
        client_followup_workflows: [],
        potential_conflict_groups: [],
        graph_relationships: [
          { relationship_type: "claim_supported_by_evidence", from_object_type: "claim", from_object_id: sharedClaimId, to_object_type: "evidence_item", to_object_id: sharedEvidenceId },
          { relationship_type: "evidence_located_by_source_locator", from_object_type: "evidence_item", from_object_id: sharedEvidenceId, to_object_type: "source_locator", to_object_id: "00000000-0000-4000-8000-000000000902" },
          { relationship_type: "evidence_from_source_version", from_object_type: "evidence_item", from_object_id: sharedEvidenceId, to_object_type: "source_version", to_object_id: sharedSourceVersionId },
          { relationship_type: "source_version_of_source", from_object_type: "source_version", from_object_id: sharedSourceVersionId, to_object_type: "source", to_object_id: sharedSourceId },
          { relationship_type: "source_version_from_candidate", from_object_type: "source_version", from_object_id: sharedSourceVersionId, to_object_type: "intake_source_candidate", to_object_id: "00000000-0000-4000-8000-000000000904" },
          { relationship_type: "candidate_governed_by_data_dictionary", from_object_type: "intake_source_candidate", from_object_id: "00000000-0000-4000-8000-000000000904", to_object_type: "data_dictionary", to_object_id: "00000000-0000-4000-8000-000000000908" },
          { relationship_type: "candidate_governed_by_sensitivity_profile", from_object_type: "intake_source_candidate", from_object_id: "00000000-0000-4000-8000-000000000904", to_object_type: "intake_sensitivity_profile", to_object_id: "00000000-0000-4000-8000-000000000909" },
          { relationship_type: "evidence_review_queue", from_object_type: "evidence_item", from_object_id: sharedEvidenceId, to_object_type: "review_queue_item", to_object_id: "00000000-0000-4000-8000-000000000901" },
          { relationship_type: "claim_review_queue", from_object_type: "claim", from_object_id: sharedClaimId, to_object_type: "review_queue_item", to_object_id: "00000000-0000-4000-8000-000000000903" },
        ],
        graph_trace_completeness: { complete: true, missing_relationship_types: [], invalid_relationship_count: 0 },
        requestedAudience: "funder",
        eligible: true,
        blockerCodes: [],
        affectedDimensionKeys: [],
        affectedObjectIds: [],
        truncated: false,
      },
      error: null,
    };
  };

  const result = await evaluateGrantResponsePacketMembershipInTransaction(tx, { organizationId: org, engagementId }, countingEvaluator);
  assert.equal(result.ok, true);
  assert.equal(result.data.drafts.length, 2);
  assert.equal(evaluatorCalls, 1, "the shared claim must be evaluated once per packet read, not once per citing draft");
});

test("Grant Response Packet membership recovers each member's own already-governed export-manifest identity/history exactly, and never queries for a member that has no exportReviewQueueItemId", async () => {
  // A dedicated two-draft engagement: one member has already been submitted
  // for export review (non-null exportReviewQueueItemId) and has an
  // existing governed manifest to recover; the other has never been
  // submitted for export review at all. Proves the export/reuse foundation
  // reuses the exact P3-20 durable-read functions per member, keyed only by
  // that member's own exportReviewQueueItemId - never a query issued (and
  // never a fabricated identity returned) for a member with none.
  const org = "00000000-0000-4000-8000-000000000001";
  const engagementId = "00000000-0000-4000-8000-000000000851";
  const withManifestQueueItemId = "00000000-0000-4000-8000-000000000861";
  const existingExportManifestId = "00000000-0000-4000-8000-000000000862";
  const existingExportCandidateId = "00000000-0000-4000-8000-000000000863";

  function memberDraft(n, { exportReviewQueueItemId }) {
    const draftId = `00000000-0000-4000-8000-0000000085${n}1`;
    const runId = `00000000-0000-4000-8000-0000000085${n}2`;
    const blockId = `00000000-0000-4000-8000-0000000085${n}3`;
    const citationId = `00000000-0000-4000-8000-0000000085${n}4`;
    const queueId = `00000000-0000-4000-8000-0000000085${n}5`;
    const claimId = `00000000-0000-4000-8000-0000000085${n}6`;
    const evidenceId = `00000000-0000-4000-8000-0000000085${n}7`;
    const draft = {
      generated_content_draft_id: draftId,
      generation_run_id: runId,
      organization_id: org,
      content_type: "evidence_summary",
      requested_audience: "funder",
      draft_status: "draft",
      review_status: "needs_gk_review",
    };
    return {
      draftId,
      runId,
      claimId,
      evidenceId,
      draft,
      run: { generation_run_id: runId, organization_id: org, request_fingerprint: "a".repeat(64), content_type: "evidence_summary", requested_audience: "funder" },
      siblingDrafts: [draft],
      blocks: [{ generated_content_block_id: blockId, generated_content_draft_id: draftId, organization_id: org, ordinal: 1, text: `Export-linkage draft ${n}.` }],
      citations: [{
        generated_content_citation_id: citationId,
        generated_content_block_id: blockId,
        organization_id: org,
        claim_id: claimId,
        evidence_item_id: evidenceId,
        block_ordinal: 1,
      }],
      queues: [{
        review_queue_item_id: queueId,
        organization_id: org,
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
      exportReviewQueues: exportReviewQueueItemId ? [{
        review_queue_item_id: exportReviewQueueItemId,
        organization_id: org,
        queue_type: "export_review",
        target_object_type: "generated_content_draft",
        target_object_id: draftId,
        priority: "medium",
        queue_status: "resolved",
        review_status: "resolved",
        blocked_reason: null,
        assigned_to: null,
        due_at: null,
        summary: "Generated draft requires export review.",
        required_action:
          "Review audience authority, current eligibility, citations, and the final export gate before any export.",
        queue_metadata: {},
        created_by: null,
        created_by_type: "system",
        updated_at: "2026-08-06T09:00:00.000Z",
      }] : [],
    };
  }

  const draftWithManifest = memberDraft(1, { exportReviewQueueItemId: withManifestQueueItemId });
  const draftWithoutExportReview = memberDraft(2, { exportReviewQueueItemId: null });
  const fixturesById = {
    [draftWithManifest.draftId]: draftWithManifest,
    [draftWithoutExportReview.draftId]: draftWithoutExportReview,
  };
  const allDraftIds = [draftWithManifest.draftId, draftWithoutExportReview.draftId];

  const evidenceIdByClaimId = {
    [draftWithManifest.claimId]: draftWithManifest.evidenceId,
    [draftWithoutExportReview.claimId]: draftWithoutExportReview.evidenceId,
  };
  const eligibleEvaluator = async (tx2, args) => ({
    ok: true,
    data: {
      claim: { claim_id: args.claimId, claim_type: "finding", claim_status: "proposed", claim_review_status: "approved", claim_strength: "strong", audience_gates: {} },
      evidence: { evidence_item_id: evidenceIdByClaimId[args.claimId], evidence_review_status: "approved", support_strength: "strong", review_queue_item_id: "00000000-0000-4000-8000-000000000871", review_queue_status: "closed", review_status: "approved", updated_at: "2026-08-06T09:00:00.000Z", sensitivity_level: "unknown" },
      locator: { source_locator_id: "00000000-0000-4000-8000-000000000872" },
      source: { source_id: "00000000-0000-4000-8000-000000000873", source_code: null },
      source_version: { source_version_id: "00000000-0000-4000-8000-000000000874", is_current: true },
      claim_review: { review_queue_item_id: "00000000-0000-4000-8000-000000000875", queue_status: "closed", review_status: "approved" },
      evidence_review_decision: { decision_id: "00000000-0000-4000-8000-000000000878", decision_outcome: "accepted" },
      claim_review_decision: {
        decision_id: "00000000-0000-4000-8000-000000000879",
        decision_outcome: "accepted",
        approved_audiences: ["internal", "funder"],
      },
      candidate: { intake_source_candidate_id: "00000000-0000-4000-8000-000000000876" },
      promotion_decision: { intake_promotion_decision_id: "00000000-0000-4000-8000-000000000877" },
      dimensions: {},
      gap_items: [],
      client_followup_workflows: [],
      potential_conflict_groups: [],
      graph_relationships: [
        { relationship_type: "claim_supported_by_evidence", from_object_type: "claim", from_object_id: args.claimId, to_object_type: "evidence_item", to_object_id: evidenceIdByClaimId[args.claimId] },
        { relationship_type: "evidence_located_by_source_locator", from_object_type: "evidence_item", from_object_id: evidenceIdByClaimId[args.claimId], to_object_type: "source_locator", to_object_id: "00000000-0000-4000-8000-000000000872" },
        { relationship_type: "evidence_from_source_version", from_object_type: "evidence_item", from_object_id: evidenceIdByClaimId[args.claimId], to_object_type: "source_version", to_object_id: "00000000-0000-4000-8000-000000000874" },
        { relationship_type: "source_version_of_source", from_object_type: "source_version", from_object_id: "00000000-0000-4000-8000-000000000874", to_object_type: "source", to_object_id: "00000000-0000-4000-8000-000000000873" },
        { relationship_type: "source_version_from_candidate", from_object_type: "source_version", from_object_id: "00000000-0000-4000-8000-000000000874", to_object_type: "intake_source_candidate", to_object_id: "00000000-0000-4000-8000-000000000876" },
        { relationship_type: "candidate_governed_by_data_dictionary", from_object_type: "intake_source_candidate", from_object_id: "00000000-0000-4000-8000-000000000876", to_object_type: "data_dictionary", to_object_id: "00000000-0000-4000-8000-000000000880" },
        { relationship_type: "candidate_governed_by_sensitivity_profile", from_object_type: "intake_source_candidate", from_object_id: "00000000-0000-4000-8000-000000000876", to_object_type: "intake_sensitivity_profile", to_object_id: "00000000-0000-4000-8000-000000000881" },
        { relationship_type: "evidence_review_queue", from_object_type: "evidence_item", from_object_id: evidenceIdByClaimId[args.claimId], to_object_type: "review_queue_item", to_object_id: "00000000-0000-4000-8000-000000000871" },
        { relationship_type: "claim_review_queue", from_object_type: "claim", from_object_id: args.claimId, to_object_type: "review_queue_item", to_object_id: "00000000-0000-4000-8000-000000000875" },
      ],
      graph_trace_completeness: { complete: true, missing_relationship_types: [], invalid_relationship_count: 0 },
      requestedAudience: "funder",
      eligible: true,
      blockerCodes: [],
      affectedDimensionKeys: [],
      affectedObjectIds: [],
      truncated: false,
    },
    error: null,
  });

  const tx = {
    async query(sql, params) {
      if (/FROM kai\.engagements\b/.test(sql)) {
        return { rows: [{ engagement_id: engagementId, organization_id: org }] };
      }
      if (/JOIN kai\.generation_runs r\b/.test(sql)) {
        return { rows: allDraftIds.map((id) => ({ generated_content_draft_id: id })) };
      }
      if (/FROM kai\.generated_content_drafts\b/.test(sql) && /WHERE organization_id/.test(sql) && /ANY/.test(sql)) {
        const draftIds = firstArrayParam(params);
        return { rows: draftIds.map((id) => fixturesById[id].draft) };
      }
      if (/FROM kai\.generated_content_drafts\b/.test(sql) && /WHERE generation_run_id = ANY/.test(sql)) {
        const runIds = firstArrayParam(params);
        return { rows: Object.values(fixturesById).filter((f) => runIds.includes(f.runId)).flatMap((f) => f.siblingDrafts) };
      }
      if (/FROM kai\.generation_runs\b/.test(sql) && !/JOIN/.test(sql)) {
        const runIds = firstArrayParam(params);
        return { rows: Object.values(fixturesById).filter((f) => runIds.includes(f.runId)).map((f) => f.run) };
      }
      if (/FROM kai\.generated_content_blocks\b/.test(sql)) {
        const draftIds = firstArrayParam(params);
        return { rows: draftIds.flatMap((id) => fixturesById[id].blocks) };
      }
      if (/FROM kai\.generated_content_citations\b/.test(sql)) {
        const blockIds = firstArrayParam(params);
        return { rows: Object.values(fixturesById).flatMap((f) => f.citations.filter((c) => blockIds.includes(c.generated_content_block_id))) };
      }
      if (/FROM kai\.review_queue_items\b/.test(sql) && /blocked_reason/.test(sql)) {
        const draftIds = firstArrayParam(params);
        return { rows: draftIds.flatMap((id) => fixturesById[id].exportReviewQueues) };
      }
      if (/FROM kai\.review_queue_items\b/.test(sql)) {
        const draftIds = firstArrayParam(params);
        return { rows: draftIds.flatMap((id) => fixturesById[id].queues) };
      }
      throw new Error(`unexpected query in export-manifest-linkage boundary test: ${sql}`);
    },
  };

  const identityCalls = [];
  const historyCalls = [];
  const manifestReaders = {
    async loadManifestIdentity(tx2, args) {
      identityCalls.push(args);
      assert.equal(args.organizationId, org);
      assert.equal(args.exportReviewQueueItemId, withManifestQueueItemId);
      return { exportManifestId: existingExportManifestId };
    },
    async loadManifestHistory(tx2, args) {
      historyCalls.push(args);
      assert.equal(args.organizationId, org);
      assert.equal(args.exportReviewQueueItemId, withManifestQueueItemId);
      return {
        exportManifestHistory: [{
          exportManifestId: existingExportManifestId,
          exportCandidateId: existingExportCandidateId,
          createdAt: "2026-08-06T09:00:00.000Z",
        }],
      };
    },
  };

  const result = await evaluateGrantResponsePacketMembershipInTransaction(
    tx,
    { organizationId: org, engagementId },
    eligibleEvaluator,
    manifestReaders,
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.drafts.length, 2);

  // Never a query (or a fabricated identity) for the member with no
  // exportReviewQueueItemId at all.
  assert.equal(identityCalls.length, 1);
  assert.equal(historyCalls.length, 1);

  const withManifestPacket = result.data.drafts.find((d) => d.generatedContentDraftId === draftWithManifest.draftId);
  assert.equal(withManifestPacket.exportManifestId, existingExportManifestId);
  assert.deepEqual(withManifestPacket.exportManifestHistory, [{
    exportManifestId: existingExportManifestId,
    exportCandidateId: existingExportCandidateId,
    createdAt: "2026-08-06T09:00:00.000Z",
  }]);

  const withoutExportReviewPacket = result.data.drafts.find((d) => d.generatedContentDraftId === draftWithoutExportReview.draftId);
  assert.equal(withoutExportReviewPacket.exportManifestId, null);
  assert.deepEqual(withoutExportReviewPacket.exportManifestHistory, []);
});

test("Grant Response Packet membership never calls the single-draft per-draft read-packet evaluator", () => {
  const source = readFileSync(
    new URL("../Backend/kai/dictionary/postgresGeneratedContentRepository.js", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("export async function evaluateGrantResponsePacketMembershipInTransaction");
  const end = source.indexOf("\n}\n", start);
  const fn = source.slice(start, end);
  assert.ok(!/evaluateGeneratedDraftReviewPacketInTransaction/.test(fn), "membership composition must not fan out per draft into the single-draft read-packet path");
  assert.ok(/readReviewPacketStatesBatch/.test(fn), "membership composition must read draft graph state via the batched reader");
});

function serviceInput(overrides = {}) {
  return { organizationId: ORG, engagementId: ENGAGEMENT, actorContext: reviewerActor, ...overrides };
}

test("Grant Response Packet service gates: both flags, exact input, mapped human, active tenant membership, and gk_admin/gk_reviewer precede repository loading", async () => {
  let repositoryCalls = 0;
  const repository = {
    async getGrantResponsePacket() {
      repositoryCalls += 1;
      return { ok: true, data: { organizationId: ORG, engagementId: ENGAGEMENT, packetAudience: "funder", drafts: [] }, error: null };
    },
  };
  assert.equal((await getGrantResponsePacket(serviceInput(), { env: {}, generatedContentRepository: repository })).error.code, "feature_disabled");
  assert.equal((await getGrantResponsePacket(serviceInput(), { env: { KAI_SPRINT2_ENABLED: "true" }, generatedContentRepository: repository })).error.code, "feature_disabled");
  assert.equal((await getGrantResponsePacket({ ...serviceInput(), extra: true }, { env: enabledEnv, generatedContentRepository: repository })).error.code, "validation_blocker");
  assert.equal((await getGrantResponsePacket(serviceInput({ actorContext: { actorType: "system", actorUserId: reviewerActor.actorUserId } }), { env: enabledEnv, generatedContentRepository: repository })).error.code, "authorization_denied");
  assert.equal((await getGrantResponsePacket(serviceInput({ organizationId: OTHER_ORG }), { env: enabledEnv, generatedContentRepository: repository })).error.code, "authorization_denied");
  assert.equal((await getGrantResponsePacket(serviceInput({ actorContext: actorWithRole("gk_operator") }), { env: enabledEnv, generatedContentRepository: repository })).error.code, "authorization_denied");
  assert.equal(repositoryCalls, 0);
  const okResult = await getGrantResponsePacket(serviceInput(), { env: enabledEnv, generatedContentRepository: repository });
  assert.equal(okResult.ok, true);
  assert.equal(okResult.data.packetAudience, "funder");
  assert.equal(repositoryCalls, 1);
});

test("Grant Response Packet service projects export-review fields only for an actor independently holding export-review authority", async () => {
  const repositoryPacket = {
    generationRunId: DRAFT_A.run.generation_run_id,
    generatedContentDraftId: DRAFT_A.draftId,
    contentType: "evidence_summary",
    draftStatus: "draft",
    requestedAudience: "funder",
    reviewQueueItemId: DRAFT_A.queues[0].review_queue_item_id,
    queueStatus: "resolved",
    reviewStatus: "resolved",
    reviewUpdatedAt: "2026-08-06T09:00:00.000Z",
    currentUseEligible: true,
    exportReviewQueueItemId: "00000000-0000-4000-8000-000000000801",
    exportReviewQueueStatus: "open",
    exportReviewStatus: "needs_gk_review",
    exportManifestId: "00000000-0000-4000-8000-000000000802",
    exportManifestHistory: [{
      exportManifestId: "00000000-0000-4000-8000-000000000802",
      exportCandidateId: "00000000-0000-4000-8000-000000000803",
      createdAt: "2026-08-06T09:00:00.000Z",
    }],
    blocks: [{
      ordinal: 1,
      text: "Visible draft text.",
      citations: [{
        claimId: DRAFT_A.claimId,
        evidenceItemId: DRAFT_A.evidenceId,
        sourceId: DRAFT_A.sourceId,
        sourceVersionId: DRAFT_A.sourceVersionId,
        supportStrength: "strong",
        claimReviewStatus: "approved",
        evidenceReviewStatus: "approved",
        currentEligible: true,
        blockerCodes: [],
        affectedDimensionKeys: [],
        affectedObjectIds: [],
      }],
    }],
  };
  const repository = {
    async getGrantResponsePacket() {
      return { ok: true, data: { organizationId: ORG, engagementId: ENGAGEMENT, packetAudience: "funder", drafts: [repositoryPacket] }, error: null };
    },
  };
  const currentPacketCandidateRepository = {
    async readCurrentGrantResponsePacketExportCandidateReviewState() {
      return {
        ok: true,
        data: {
          organizationId: ORG,
          engagementId: ENGAGEMENT,
          grantResponsePacketExportCandidateId: null,
          reviewQueueItemId: null,
          queueStatus: null,
          reviewStatus: null,
          reviewUpdatedAt: null,
        },
        error: null,
      };
    },
  };

  const reviewerResult = await getGrantResponsePacket(serviceInput({ actorContext: reviewerActor }), { env: enabledEnv, generatedContentRepository: repository });
  assert.equal(reviewerResult.ok, true);
  assert.equal(reviewerResult.data.drafts[0].exportReviewVisible, false);
  assert.equal(reviewerResult.data.drafts[0].exportReviewQueueItemId, null);
  assert.equal(reviewerResult.data.drafts[0].exportReviewQueueStatus, null);
  assert.equal(reviewerResult.data.drafts[0].exportReviewStatus, null);
  assert.equal(reviewerResult.data.drafts[0].exportManifestId, null);
  assert.deepEqual(reviewerResult.data.drafts[0].exportManifestHistory, []);

  const adminResult = await getGrantResponsePacket(serviceInput({ actorContext: adminActor }), {
    env: enabledEnv,
    generatedContentRepository: repository,
    grantResponsePacketExportCandidateRepository: currentPacketCandidateRepository,
  });
  assert.equal(adminResult.ok, true);
  assert.equal(adminResult.data.drafts[0].exportReviewVisible, true);
  assert.equal(adminResult.data.drafts[0].exportReviewQueueItemId, "00000000-0000-4000-8000-000000000801");
  assert.equal(adminResult.data.drafts[0].exportManifestId, "00000000-0000-4000-8000-000000000802");
  assert.deepEqual(adminResult.data.drafts[0].exportManifestHistory, [{
    exportManifestId: "00000000-0000-4000-8000-000000000802",
    exportCandidateId: "00000000-0000-4000-8000-000000000803",
    createdAt: "2026-08-06T09:00:00.000Z",
  }]);
});

test("Grant Response Packet service rejects injected repository packets containing raw or prohibited fields with system_error", async () => {
  const repository = {
    async getGrantResponsePacket() {
      return {
        ok: true,
        data: {
          organizationId: ORG,
          engagementId: ENGAGEMENT,
          packetAudience: "funder",
          drafts: [{
            generationRunId: DRAFT_A.run.generation_run_id,
            generatedContentDraftId: DRAFT_A.draftId,
            contentType: "evidence_summary",
            draftStatus: "draft",
            requestedAudience: "funder",
            reviewQueueItemId: DRAFT_A.queues[0].review_queue_item_id,
            queueStatus: "resolved",
            reviewStatus: "resolved",
            reviewUpdatedAt: "2026-08-06T09:00:00.000Z",
            currentUseEligible: true,
            exportReviewQueueItemId: null,
            exportReviewQueueStatus: null,
            exportReviewStatus: null,
            prompt: "blocked",
            blocks: [{
              ordinal: 1,
              text: "Visible draft text.",
              citations: [{
                claimId: DRAFT_A.claimId,
                evidenceItemId: DRAFT_A.evidenceId,
                sourceId: DRAFT_A.sourceId,
                sourceVersionId: DRAFT_A.sourceVersionId,
                supportStrength: "strong",
                claimReviewStatus: "approved",
                evidenceReviewStatus: "approved",
                currentEligible: true,
                blockerCodes: [],
                affectedDimensionKeys: [],
                affectedObjectIds: [],
              }],
            }],
          }],
        },
        error: null,
      };
    },
  };
  const result = await getGrantResponsePacket(serviceInput(), { env: enabledEnv, generatedContentRepository: repository });
  assert.equal(result.error.code, "system_error");
  assert.equal(result.data, null);
});

test("Grant Response Packet service lazy-loads the database-capable repository only after all gates", () => {
  const source = readFileSync(new URL("../Backend/kai/services/kaiGrantResponsePacketService.js", import.meta.url), "utf8");
  const topLevelImports = source.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(topLevelImports.every((line) => !/postgresGeneratedContentRepository|kaiDb|pg/.test(line)));
  assert.ok(source.indexOf("isKaiSprint2Enabled") < source.indexOf("createDefaultGeneratedContentRepository"));
});

test("repository input validator requires exactly organizationId and engagementId as UUIDs", () => {
  const { validateGrantResponsePacketMembershipInput } = __generatedContentRepositoryTestables;
  assert.equal(validateGrantResponsePacketMembershipInput({ organizationId: ORG, engagementId: ENGAGEMENT }), true);
  assert.equal(validateGrantResponsePacketMembershipInput({ organizationId: ORG, engagementId: ENGAGEMENT, extra: true }), false);
  assert.equal(validateGrantResponsePacketMembershipInput({ organizationId: "not-a-uuid", engagementId: ENGAGEMENT }), false);
});

test("service input validator is exposed for direct unit coverage", () => {
  const { isGetGrantResponsePacketInput } = __grantResponsePacketServiceTestables;
  assert.equal(isGetGrantResponsePacketInput(serviceInput()), true);
  assert.equal(isGetGrantResponsePacketInput({ ...serviceInput(), extra: true }), false);
});
