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

// One coherent per-draft immutable graph, parameterized only by the ids and
// review/eligibility state a test needs to vary - shaped identically to the
// existing P3-02 review-packet boundary test's own `state()`/`dto()`
// fixtures, since a Grant Response Packet member is exactly that same
// governed packet, never a second shape.
function draftFixture(n, { queueStatus, reviewStatus, eligible = true }) {
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
    requested_audience: "internal",
    draft_status: "draft",
    review_status: "needs_gk_review",
  };
  return {
    draftId,
    claimId,
    evidenceId,
    sourceId,
    sourceVersionId,
    draft,
    run: {
      generation_run_id: runId,
      organization_id: ORG,
      request_fingerprint: "a".repeat(64),
      content_type: "evidence_summary",
      requested_audience: "internal",
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

const DRAFT_A = draftFixture(1, { queueStatus: "resolved", reviewStatus: "resolved", eligible: true });
const DRAFT_B = draftFixture(2, { queueStatus: "open", reviewStatus: "needs_gk_review", eligible: true });
const DRAFT_C = draftFixture(3, { queueStatus: "resolved", reviewStatus: "resolved", eligible: false });
const DRAFT_D = draftFixture(4, { queueStatus: "resolved", reviewStatus: "resolved", eligible: true });

const FIXTURES_BY_DRAFT_ID = Object.fromEntries(
  [DRAFT_A, DRAFT_B, DRAFT_C, DRAFT_D].map((fixture) => [fixture.draftId, fixture]),
);
const MEMBERSHIP_BY_ENGAGEMENT = {
  [ENGAGEMENT]: [DRAFT_A.draftId, DRAFT_B.draftId, DRAFT_C.draftId],
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
      candidate: { intake_source_candidate_id: "00000000-0000-4000-8000-000000000604" },
      promotion_decision: { intake_promotion_decision_id: "00000000-0000-4000-8000-000000000605" },
      dimensions: {},
      gap_items: [],
      client_followup_workflows: [],
      potential_conflict_groups: [],
      requestedAudience: "internal",
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
// evaluateGeneratedDraftReviewPacketInTransaction is reused unmodified per
// draft, so a single shared evaluator function must serve every draft in
// the same membership scan.
const sharedEvaluator = async (tx, args) => {
  const fixture = [DRAFT_A, DRAFT_B, DRAFT_C, DRAFT_D].find((f) => f.claimId === args.claimId);
  return evaluatorFor(fixture)(tx, args);
};

function makeTx() {
  let current = null;
  return {
    async query(sql, params = []) {
      if (/FROM kai\.engagements\b/.test(sql)) {
        const [organizationId, engagementId] = params;
        const row = ENGAGEMENT_ROWS.find((r) => r.organization_id === organizationId && r.engagement_id === engagementId);
        return { rows: row ? [row] : [] };
      }
      if (/JOIN kai\.generation_runs r\b/.test(sql)) {
        const [, engagementId] = params;
        const ids = MEMBERSHIP_BY_ENGAGEMENT[engagementId] || [];
        return { rows: ids.map((id) => ({ generated_content_draft_id: id })) };
      }
      if (/FROM kai\.generated_content_drafts\s+WHERE organization_id/.test(sql)) {
        const [, generatedContentDraftId] = params;
        current = FIXTURES_BY_DRAFT_ID[generatedContentDraftId] || null;
        return { rows: current ? [current.draft] : [] };
      }
      if (!current) throw new Error(`unexpected query with no active draft context: ${sql}`);
      if (/FROM kai\.generation_runs\b/.test(sql) && !/JOIN/.test(sql)) return { rows: [current.run] };
      if (/FROM kai\.generated_content_drafts\s+WHERE generation_run_id/.test(sql)) return { rows: current.siblingDrafts };
      if (/FROM kai\.generated_content_blocks/.test(sql)) return { rows: current.blocks };
      if (/FROM kai\.generated_content_citations/.test(sql)) return { rows: current.citations };
      if (/FROM kai\.review_queue_items/.test(sql) && /blocked_reason/.test(sql)) return { rows: current.exportReviewQueues };
      if (/FROM kai\.review_queue_items/.test(sql)) return { rows: current.queues };
      throw new Error(`unexpected query in grant-response-packet boundary test: ${sql}`);
    },
  };
}

test("Grant Response Packet membership includes only the requesting engagement's own eligible drafts", async () => {
  const result = await evaluateGrantResponsePacketMembershipInTransaction(
    makeTx(),
    { organizationId: ORG, engagementId: ENGAGEMENT },
    sharedEvaluator,
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.drafts.length, 1);
  assert.equal(result.data.drafts[0].generatedContentDraftId, DRAFT_A.draftId);
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
  const [citation] = packet.blocks[0].citations;
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
});

function serviceInput(overrides = {}) {
  return { organizationId: ORG, engagementId: ENGAGEMENT, actorContext: reviewerActor, ...overrides };
}

test("Grant Response Packet service gates: both flags, exact input, mapped human, active tenant membership, and gk_admin/gk_reviewer precede repository loading", async () => {
  let repositoryCalls = 0;
  const repository = {
    async getGrantResponsePacket() {
      repositoryCalls += 1;
      return { ok: true, data: { organizationId: ORG, engagementId: ENGAGEMENT, drafts: [] }, error: null };
    },
  };
  assert.equal((await getGrantResponsePacket(serviceInput(), { env: {}, generatedContentRepository: repository })).error.code, "feature_disabled");
  assert.equal((await getGrantResponsePacket(serviceInput(), { env: { KAI_SPRINT2_ENABLED: "true" }, generatedContentRepository: repository })).error.code, "feature_disabled");
  assert.equal((await getGrantResponsePacket({ ...serviceInput(), extra: true }, { env: enabledEnv, generatedContentRepository: repository })).error.code, "validation_blocker");
  assert.equal((await getGrantResponsePacket(serviceInput({ actorContext: { actorType: "system", actorUserId: reviewerActor.actorUserId } }), { env: enabledEnv, generatedContentRepository: repository })).error.code, "authorization_denied");
  assert.equal((await getGrantResponsePacket(serviceInput({ organizationId: OTHER_ORG }), { env: enabledEnv, generatedContentRepository: repository })).error.code, "authorization_denied");
  assert.equal((await getGrantResponsePacket(serviceInput({ actorContext: actorWithRole("gk_operator") }), { env: enabledEnv, generatedContentRepository: repository })).error.code, "authorization_denied");
  assert.equal(repositoryCalls, 0);
  assert.equal((await getGrantResponsePacket(serviceInput(), { env: enabledEnv, generatedContentRepository: repository })).ok, true);
  assert.equal(repositoryCalls, 1);
});

test("Grant Response Packet service projects export-review fields only for an actor independently holding export-review authority", async () => {
  const repositoryPacket = {
    generationRunId: DRAFT_A.run.generation_run_id,
    generatedContentDraftId: DRAFT_A.draftId,
    contentType: "evidence_summary",
    draftStatus: "draft",
    requestedAudience: "internal",
    reviewQueueItemId: DRAFT_A.queues[0].review_queue_item_id,
    queueStatus: "resolved",
    reviewStatus: "resolved",
    reviewUpdatedAt: "2026-08-06T09:00:00.000Z",
    currentUseEligible: true,
    exportReviewQueueItemId: "00000000-0000-4000-8000-000000000801",
    exportReviewQueueStatus: "open",
    exportReviewStatus: "needs_gk_review",
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
      return { ok: true, data: { organizationId: ORG, engagementId: ENGAGEMENT, drafts: [repositoryPacket] }, error: null };
    },
  };

  const reviewerResult = await getGrantResponsePacket(serviceInput({ actorContext: reviewerActor }), { env: enabledEnv, generatedContentRepository: repository });
  assert.equal(reviewerResult.ok, true);
  assert.equal(reviewerResult.data.drafts[0].exportReviewVisible, false);
  assert.equal(reviewerResult.data.drafts[0].exportReviewQueueItemId, null);
  assert.equal(reviewerResult.data.drafts[0].exportReviewQueueStatus, null);
  assert.equal(reviewerResult.data.drafts[0].exportReviewStatus, null);

  const adminResult = await getGrantResponsePacket(serviceInput({ actorContext: adminActor }), { env: enabledEnv, generatedContentRepository: repository });
  assert.equal(adminResult.ok, true);
  assert.equal(adminResult.data.drafts[0].exportReviewVisible, true);
  assert.equal(adminResult.data.drafts[0].exportReviewQueueItemId, "00000000-0000-4000-8000-000000000801");
});

test("Grant Response Packet service rejects injected repository packets containing raw or prohibited fields with system_error", async () => {
  const repository = {
    async getGrantResponsePacket() {
      return {
        ok: true,
        data: {
          organizationId: ORG,
          engagementId: ENGAGEMENT,
          drafts: [{
            generationRunId: DRAFT_A.run.generation_run_id,
            generatedContentDraftId: DRAFT_A.draftId,
            contentType: "evidence_summary",
            draftStatus: "draft",
            requestedAudience: "internal",
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
