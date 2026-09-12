import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateBoardReportingPacketMembershipInTransaction,
} from "../Backend/kai/dictionary/postgresGeneratedContentRepository.js";
import {
  getBoardReportingPacket,
  __boardReportingPacketServiceTestables,
} from "../Backend/kai/services/kaiBoardReportingPacketService.js";
import {
  composeBoardReportingRenderModel,
  __boardReportingRenderModelServiceTestables,
} from "../Backend/kai/services/kaiBoardReportingPacketRenderModelService.js";
import {
  buildBoardReportingPacketRepresentation,
  canonicalFingerprint,
  composeBoardReportingPacketFingerprint,
  BOARD_REPORTING_PACKET_FINGERPRINT_ERROR,
} from "../Backend/kai/services/kaiBoardReportingPacketFingerprintService.js";

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

function draftFixture(n, {
  queueStatus,
  reviewStatus,
  eligible = true,
  audience = "internal",
  contentType = "evidence_summary",
}) {
  const draftId = `00000000-0000-4000-8000-0000000009${n}1`;
  const runId = `00000000-0000-4000-8000-0000000009${n}2`;
  const blockId = `00000000-0000-4000-8000-0000000009${n}3`;
  const citationId = `00000000-0000-4000-8000-0000000009${n}4`;
  const queueId = `00000000-0000-4000-8000-0000000009${n}5`;
  const claimId = `00000000-0000-4000-8000-0000000009${n}6`;
  const evidenceId = `00000000-0000-4000-8000-0000000009${n}7`;
  const sourceId = `00000000-0000-4000-8000-0000000009${n}8`;
  const sourceVersionId = `00000000-0000-4000-8000-0000000009${n}9`;
  const draft = {
    generated_content_draft_id: draftId,
    generation_run_id: runId,
    organization_id: ORG,
    content_type: contentType,
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
    contentType,
    draft,
    run: {
      generation_run_id: runId,
      organization_id: ORG,
      engagement_id: ENGAGEMENT,
      request_fingerprint: "a".repeat(64),
      content_type: contentType,
      requested_audience: audience,
    },
    siblingDrafts: [draft],
    blocks: [{
      generated_content_block_id: blockId,
      generated_content_draft_id: draftId,
      organization_id: ORG,
      ordinal: 1,
      text: `Board Reporting draft ${n}.`,
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

const EVIDENCE_SUMMARY = draftFixture(1, { queueStatus: "resolved", reviewStatus: "resolved" });
const IMPACT_NARRATIVE = draftFixture(2, { queueStatus: "resolved", reviewStatus: "resolved", contentType: "impact_narrative" });
const UNREVIEWED = draftFixture(3, { queueStatus: "open", reviewStatus: "needs_gk_review" });
const BLOCKED = draftFixture(4, { queueStatus: "resolved", reviewStatus: "resolved", eligible: false });
const FUNDER = draftFixture(5, { queueStatus: "resolved", reviewStatus: "resolved", audience: "funder" });
const OTHER = draftFixture(6, { queueStatus: "resolved", reviewStatus: "resolved" });
OTHER.run.engagement_id = OTHER_ENGAGEMENT;

const ALL_FIXTURES = [EVIDENCE_SUMMARY, IMPACT_NARRATIVE, UNREVIEWED, BLOCKED, FUNDER, OTHER];
const FIXTURES_BY_DRAFT_ID = Object.fromEntries(ALL_FIXTURES.map((fixture) => [fixture.draftId, fixture]));
const MEMBERSHIP_BY_ENGAGEMENT = {
  [ENGAGEMENT]: [EVIDENCE_SUMMARY.draftId, IMPACT_NARRATIVE.draftId, UNREVIEWED.draftId, BLOCKED.draftId, FUNDER.draftId],
  [OTHER_ENGAGEMENT]: [OTHER.draftId],
};

function firstArrayParam(params) {
  return params.find((param) => Array.isArray(param));
}

function makeTx() {
  return {
    async query(sql, params = []) {
      if (/FROM kai\.engagements\b/.test(sql)) {
        const [organizationId, engagementId] = params;
        if (organizationId === ORG && [ENGAGEMENT, OTHER_ENGAGEMENT].includes(engagementId)) {
          return { rows: [{ engagement_id: engagementId, organization_id: organizationId }] };
        }
        return { rows: [] };
      }
      if (/JOIN kai\.generation_runs r\b/.test(sql)) {
        const [organizationId, engagementId, contentTypes, draftStatus, audience] = params;
        const rows = (MEMBERSHIP_BY_ENGAGEMENT[engagementId] || [])
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
        return { rows: draftIds.map((id) => FIXTURES_BY_DRAFT_ID[id]).filter((f) => f?.draft.organization_id === organizationId).map((f) => f.draft) };
      }
      if (/FROM kai\.generation_runs\b/.test(sql) && !/JOIN/.test(sql)) {
        const runIds = firstArrayParam(params);
        return { rows: ALL_FIXTURES.filter((fixture) => runIds.includes(fixture.runId)).map((fixture) => fixture.run) };
      }
      if (/FROM kai\.generated_content_drafts\b/.test(sql) && /WHERE generation_run_id = ANY/.test(sql)) {
        const runIds = firstArrayParam(params);
        return { rows: ALL_FIXTURES.filter((fixture) => runIds.includes(fixture.runId)).flatMap((fixture) => fixture.siblingDrafts) };
      }
      if (/FROM kai\.generated_content_blocks\b/.test(sql)) {
        const draftIds = firstArrayParam(params);
        return { rows: draftIds.flatMap((id) => FIXTURES_BY_DRAFT_ID[id]?.blocks || []) };
      }
      if (/FROM kai\.generated_content_citations\b/.test(sql)) {
        const blockIds = firstArrayParam(params);
        return { rows: ALL_FIXTURES.flatMap((fixture) => fixture.citations.filter((citation) => blockIds.includes(citation.generated_content_block_id))) };
      }
      if (/FROM kai\.review_queue_items\b/.test(sql) && /blocked_reason/.test(sql)) {
        const draftIds = firstArrayParam(params);
        return { rows: draftIds.flatMap((id) => FIXTURES_BY_DRAFT_ID[id]?.exportReviewQueues || []) };
      }
      if (/FROM kai\.review_queue_items\b/.test(sql)) {
        const draftIds = firstArrayParam(params);
        return { rows: draftIds.flatMap((id) => FIXTURES_BY_DRAFT_ID[id]?.queues || []) };
      }
      throw new Error(`unexpected query in board-reporting packet boundary test: ${sql}`);
    },
  };
}

const sharedEvaluator = async (tx, args) => {
  const fixture = ALL_FIXTURES.find((f) => f.claimId === args.claimId);
  return {
    ok: true,
    data: {
      claim: { claim_id: args.claimId, claim_type: "finding", claim_status: "proposed", claim_review_status: "approved", claim_strength: "strong", audience_gates: {} },
      evidence: { evidence_item_id: fixture.evidenceId, evidence_review_status: "approved", support_strength: "strong", review_queue_item_id: "00000000-0000-4000-8000-000000000601", review_queue_status: "closed", review_status: "approved", updated_at: "2026-08-06T09:00:00.000Z", sensitivity_level: "unknown" },
      locator: { source_locator_id: "00000000-0000-4000-8000-000000000602" },
      source: { source_id: fixture.sourceId, source_code: null },
      source_version: { source_version_id: fixture.sourceVersionId, is_current: true },
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
        { relationship_type: "claim_supported_by_evidence", from_object_type: "claim", from_object_id: args.claimId, to_object_type: "evidence_item", to_object_id: fixture.evidenceId },
        { relationship_type: "evidence_located_by_source_locator", from_object_type: "evidence_item", from_object_id: fixture.evidenceId, to_object_type: "source_locator", to_object_id: "00000000-0000-4000-8000-000000000602" },
        { relationship_type: "evidence_from_source_version", from_object_type: "evidence_item", from_object_id: fixture.evidenceId, to_object_type: "source_version", to_object_id: fixture.sourceVersionId },
        { relationship_type: "source_version_of_source", from_object_type: "source_version", from_object_id: fixture.sourceVersionId, to_object_type: "source", to_object_id: fixture.sourceId },
        { relationship_type: "source_version_from_candidate", from_object_type: "source_version", from_object_id: fixture.sourceVersionId, to_object_type: "intake_source_candidate", to_object_id: "00000000-0000-4000-8000-000000000604" },
        { relationship_type: "candidate_governed_by_data_dictionary", from_object_type: "intake_source_candidate", from_object_id: "00000000-0000-4000-8000-000000000604", to_object_type: "data_dictionary", to_object_id: "00000000-0000-4000-8000-000000000608" },
        { relationship_type: "candidate_governed_by_sensitivity_profile", from_object_type: "intake_source_candidate", from_object_id: "00000000-0000-4000-8000-000000000604", to_object_type: "intake_sensitivity_profile", to_object_id: "00000000-0000-4000-8000-000000000609" },
        { relationship_type: "evidence_review_queue", from_object_type: "evidence_item", from_object_id: fixture.evidenceId, to_object_type: "review_queue_item", to_object_id: "00000000-0000-4000-8000-000000000601" },
        { relationship_type: "claim_review_queue", from_object_type: "claim", from_object_id: args.claimId, to_object_type: "review_queue_item", to_object_id: "00000000-0000-4000-8000-000000000603" },
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
  };
};

test("Board Reporting V1 membership includes only resolved, current, internal evidence_summary and impact_narrative drafts", async () => {
  const result = await evaluateBoardReportingPacketMembershipInTransaction(
    makeTx(),
    { organizationId: ORG, engagementId: ENGAGEMENT },
    sharedEvaluator,
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.packetAudience, "internal");
  assert.deepEqual(result.data.drafts.map((draft) => draft.generatedContentDraftId), [
    EVIDENCE_SUMMARY.draftId,
    IMPACT_NARRATIVE.draftId,
  ]);
  assert.deepEqual(result.data.drafts.map((draft) => draft.contentType), ["evidence_summary", "impact_narrative"]);
  assert.deepEqual(result.data.drafts.map((draft) => draft.requestedAudience), ["internal", "internal"]);
});

test("Board Reporting V1 membership fails closed for stale, unreviewed, cross-audience, and cross-tenant state", async () => {
  const result = await evaluateBoardReportingPacketMembershipInTransaction(
    makeTx(),
    { organizationId: ORG, engagementId: ENGAGEMENT },
    sharedEvaluator,
  );
  assert.equal(result.ok, true);
  const ids = result.data.drafts.map((draft) => draft.generatedContentDraftId);
  assert.ok(!ids.includes(UNREVIEWED.draftId));
  assert.ok(!ids.includes(BLOCKED.draftId));
  assert.ok(!ids.includes(FUNDER.draftId));

  const crossTenant = await evaluateBoardReportingPacketMembershipInTransaction(
    makeTx(),
    { organizationId: OTHER_ORG, engagementId: ENGAGEMENT },
    sharedEvaluator,
  );
  assert.equal(crossTenant.ok, false);
  assert.equal(crossTenant.error.code, "not_found");
});

test("Board Reporting service exposes a read-only internal packet DTO with no Grant export/candidate/finalization fields", async () => {
  const result = await getBoardReportingPacket({
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    actorContext: reviewerActor,
  }, {
    env: enabledEnv,
    generatedContentRepository: {
      async getBoardReportingPacket() {
        return {
          ok: true,
          data: {
            organizationId: ORG,
            engagementId: ENGAGEMENT,
            packetAudience: "internal",
            drafts: [membershipMember()],
          },
          error: null,
        };
      },
    },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.packetAudience, "internal");
  assert.deepEqual(result.data.supportedContentTypes, ["evidence_summary", "impact_narrative"]);
  assert.equal(result.data.members.length, 1);
  const serialized = JSON.stringify(result.data);
  for (const forbidden of [
    "exportReviewVisible",
    "grantResponsePacketExportCandidateId",
    "finalReleaseAuthorityEffective",
    "finalExportEligible",
    "finalDeliveryState",
    "exportManifest",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} must not be present`);
  }
});

test("Board Reporting render model and fingerprint are deterministic and internal-only", async () => {
  const input = { organizationId: ORG, engagementId: ENGAGEMENT, actorContext: reviewerActor };
  const readBoardReportingPacket = async () => ({
    ok: true,
    data: {
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      packetAudience: "internal",
      supportedContentTypes: ["evidence_summary", "impact_narrative"],
      members: [membershipMember(), membershipMember({
        generatedContentDraftId: IMPACT_NARRATIVE.draftId,
        generationRunId: IMPACT_NARRATIVE.runId,
        contentType: "impact_narrative",
        reviewUpdatedAt: "2026-09-01T00:00:00.000Z",
      })].map(toBoardMember),
    },
    error: null,
  });

  const first = await composeBoardReportingRenderModel(input, { readBoardReportingPacket });
  const second = await composeBoardReportingRenderModel(input, { readBoardReportingPacket });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.deepEqual(first.data, second.data);
  assert.equal(first.data.renderModelContractVersion, "kai-sprint2-board-reporting-render-model-v1");
  assert.deepEqual(first.data.members.map((member) => member.contentType), ["evidence_summary", "impact_narrative"]);

  const fp = composeBoardReportingPacketFingerprint(first.data);
  assert.equal(/^[a-f0-9]{64}$/.test(fp.fingerprint), true);
  assert.deepEqual(fp.orderedGeneratedContentDraftIds, [EVIDENCE_SUMMARY.draftId, IMPACT_NARRATIVE.draftId]);

  const changed = composeBoardReportingPacketFingerprint({
    ...first.data,
    members: first.data.members.map((member, index) => index === 0
      ? { ...member, blocks: [{ ...member.blocks[0], citations: [{ ...member.blocks[0].citations[0], blockerCodes: ["manual_review_required"] }] }] }
      : member),
  });
  assert.notEqual(changed.fingerprint, fp.fingerprint);

  const timestampOnly = composeBoardReportingPacketFingerprint({
    ...first.data,
    members: first.data.members.map((member) => ({ ...member, reviewUpdatedAt: "2027-01-01T00:00:00.000Z" })),
  });
  assert.equal(timestampOnly.fingerprint, fp.fingerprint);
});

test("Board Reporting fingerprint refuses non-internal and empty render models", () => {
  const nonInternal = buildBoardReportingPacketRepresentation({
    ...renderModelFixture(),
    packetAudience: "funder",
  });
  assert.equal(nonInternal.representation, null);
  assert.equal(nonInternal.error, BOARD_REPORTING_PACKET_FINGERPRINT_ERROR.NOT_INTERNAL_AUDIENCE);

  const empty = buildBoardReportingPacketRepresentation({ ...renderModelFixture(), members: [] });
  assert.equal(empty.representation, null);
  assert.equal(empty.error, BOARD_REPORTING_PACKET_FINGERPRINT_ERROR.NO_ELIGIBLE_MEMBERS);
  assert.equal(canonicalFingerprint({ z: 1, a: { y: 2, x: 3 } }), canonicalFingerprint({ a: { x: 3, y: 2 }, z: 1 }));
});

test("Board Reporting render model fails closed for malformed packet state", () => {
  assert.equal(
    __boardReportingRenderModelServiceTestables.composeBoardReportingRenderModelFromPacket({
      ...packetFixture(),
      members: [membershipMember({ requestedAudience: "funder" })],
    }),
    null,
  );
  assert.equal(
    __boardReportingPacketServiceTestables.projectBoardReportingMember(membershipMember({ contentType: "board_update" })),
    null,
  );
});

function citationFixture(overrides = {}) {
  return {
    generatedContentCitationId: EVIDENCE_SUMMARY.citations[0].generated_content_citation_id,
    claimId: EVIDENCE_SUMMARY.claimId,
    evidenceItemId: EVIDENCE_SUMMARY.evidenceId,
    sourceId: EVIDENCE_SUMMARY.sourceId,
    sourceVersionId: EVIDENCE_SUMMARY.sourceVersionId,
    supportStrength: "strong",
    claimReviewStatus: "approved",
    evidenceReviewStatus: "approved",
    currentEligible: true,
    blockerCodes: [],
    affectedDimensionKeys: [],
    affectedObjectIds: [],
    ...overrides,
  };
}

function membershipMember(overrides = {}) {
  return {
    generationRunId: EVIDENCE_SUMMARY.runId,
    generatedContentDraftId: EVIDENCE_SUMMARY.draftId,
    contentType: "evidence_summary",
    draftStatus: "draft",
    requestedAudience: "internal",
    reviewQueueItemId: EVIDENCE_SUMMARY.queues[0].review_queue_item_id,
    queueStatus: "resolved",
    reviewStatus: "resolved",
    reviewUpdatedAt: "2026-08-06T09:00:00.000Z",
    currentUseEligible: true,
    exportReviewQueueItemId: null,
    exportReviewQueueStatus: null,
    exportReviewStatus: null,
    blocks: [{
      generatedContentBlockId: EVIDENCE_SUMMARY.blocks[0].generated_content_block_id,
      ordinal: 1,
      text: "Board Reporting packet member.",
      citations: [citationFixture()],
    }],
    ...overrides,
  };
}

function packetFixture(overrides = {}) {
  return {
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    packetAudience: "internal",
    supportedContentTypes: ["evidence_summary", "impact_narrative"],
    members: [toBoardMember(membershipMember())],
    ...overrides,
  };
}

function toBoardMember(member) {
  const {
    exportReviewQueueItemId,
    exportReviewQueueStatus,
    exportReviewStatus,
    ...boardMember
  } = member;
  return boardMember;
}

function renderModelFixture(overrides = {}) {
  return {
    renderModelContractVersion: "kai-sprint2-board-reporting-render-model-v1",
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    packetAudience: "internal",
    supportedContentTypes: ["evidence_summary", "impact_narrative"],
    members: [
      __boardReportingRenderModelServiceTestables.composeBoardReportingRenderModelFromPacket(packetFixture()).members[0],
    ],
    ...overrides,
  };
}
