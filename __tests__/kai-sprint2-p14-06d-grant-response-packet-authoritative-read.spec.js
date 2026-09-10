// P14-06D: authoritative READ ONLY current packet export-candidate/review
// state. This suite proves the backend reload contract only reads an exact
// current candidate by the existing P14-02 structural identity plus P14-03
// canonical fingerprint, never latest/newest/preferred rows, and only exposes
// packet review identity to the existing export-review-visible role.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createPostgresGrantResponsePacketExportCandidateRepository } from "../Backend/kai/dictionary/postgresGrantResponsePacketExportCandidateRepository.js";
import { composeGrantResponsePacketExportCandidateFingerprint } from "../Backend/kai/services/kaiGrantResponsePacketExportCandidateFingerprintService.js";
import { getGrantResponsePacket } from "../Backend/kai/services/kaiGrantResponsePacketService.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const ENGAGEMENT = "14060000-0000-4000-8000-000000000001";
const OTHER_ENGAGEMENT = "14060000-0000-4000-8000-000000000002";
const IDENTITY = "14060000-0000-4000-8000-0000000000e1";
const OTHER_IDENTITY = "14060000-0000-4000-8000-0000000000e2";
const CANDIDATE = "14060000-0000-4000-8000-0000000000c1";
const OLD_CANDIDATE = "14060000-0000-4000-8000-0000000000c2";
const QUEUE = "14060000-0000-4000-8000-0000000000a1";
const UPDATED_AT = "2026-09-09T12:34:56.789Z";

const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" });

const gkAdminActorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_admin" }],
});
const gkReviewerActorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000002",
  organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" }],
});

function citation(overrides = {}) {
  return {
    claimId: "14060000-0000-4000-8000-0000000000b1",
    evidenceItemId: "14060000-0000-4000-8000-0000000000b2",
    sourceId: "14060000-0000-4000-8000-0000000000b3",
    sourceVersionId: "14060000-0000-4000-8000-0000000000b4",
    generatedContentCitationId: "14060000-0000-4000-8000-0000000000b5",
    supportStrength: "strong",
    claimReviewStatus: "resolved",
    evidenceReviewStatus: "resolved",
    currentEligible: true,
    blockerCodes: [],
    affectedDimensionKeys: [],
    affectedObjectIds: [],
    ...overrides,
  };
}

function renderModel(overrides = {}) {
  return {
    renderModelContractVersion: "kai-sprint2-grant-response-packet-render-model-v1",
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    packetAudience: "funder",
    members: [{
      generatedContentDraftId: "14060000-0000-4000-8000-0000000000d1",
      contentType: "evidence_summary",
      requestedAudience: "funder",
      draftStatus: "draft",
      currentUseEligible: true,
      blocks: [{
        ordinal: 0,
        generatedContentBlockId: "14060000-0000-4000-8000-0000000000f1",
        citations: [citation()],
      }],
    }],
    ...overrides,
  };
}

const currentFingerprint = composeGrantResponsePacketExportCandidateFingerprint(renderModel()).fingerprint;
const changedFingerprint = composeGrantResponsePacketExportCandidateFingerprint(
  renderModel({ members: [{ ...renderModel().members[0], blocks: [{ ...renderModel().members[0].blocks[0], citations: [citation({ blockerCodes: ["changed"] })] }] }] }),
).fingerprint;

function queueRow({ queueStatus = "open", reviewStatus = "needs_gk_review", candidateId = CANDIDATE, org = ORG } = {}) {
  return {
    review_queue_item_id: QUEUE,
    organization_id: org,
    queue_type: "export_review",
    target_object_type: "grant_response_packet_export_candidate",
    target_object_id: candidateId,
    priority: "medium",
    queue_status: queueStatus,
    review_status: reviewStatus,
    summary: "Grant Response Packet export candidate requires export review.",
    required_action: "Review packet membership, funder audience, and export authority before any export.",
    blocked_reason: null,
    assigned_to: null,
    due_at: null,
    queue_metadata: {},
    created_by: null,
    created_by_type: "system",
    updated_at: UPDATED_AT,
  };
}

function makeReadTx({
  identityByEngagement = { [ENGAGEMENT]: IDENTITY },
  candidatesByFingerprint = {},
  reviewRowsByCandidate = {},
} = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, params = []) {
      queries.push({ sql, params });
      assert.doesNotMatch(sql, /\bINSERT\b|\bUPDATE\b|\bDELETE\b/i, "authoritative read must not mutate");
      if (/FROM kai\.grant_response_packet_export_identities/.test(sql)) {
        const [organizationId, engagementId] = params;
        if (organizationId !== ORG) return { rows: [] };
        const identityId = identityByEngagement[engagementId];
        return { rows: identityId ? [{ grant_response_packet_export_identity_id: identityId }] : [] };
      }
      if (/FROM kai\.grant_response_packet_export_candidates/.test(sql)) {
        const [organizationId, identityId, fingerprint] = params;
        const candidateId = organizationId === ORG && identityId === IDENTITY
          ? candidatesByFingerprint[fingerprint]
          : null;
        return { rows: candidateId ? [{ grant_response_packet_export_candidate_id: candidateId }] : [] };
      }
      if (/FROM kai\.review_queue_items/.test(sql)) {
        const [organizationId, , , candidateId] = params;
        const row = organizationId === ORG ? reviewRowsByCandidate[candidateId] : null;
        return { rows: row ? [row] : [] };
      }
      throw new Error(`unexpected query in P14-06D read tx: ${sql}`);
    },
  };
}

function repositoryWithTx(tx) {
  return createPostgresGrantResponsePacketExportCandidateRepository({
    runInTransaction: async (fn) => fn(tx),
  });
}

function readInput(overrides = {}) {
  return {
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    actorContext: gkAdminActorContext,
    ...overrides,
  };
}

async function readState({ tx, model = renderModel(), input = readInput() }) {
  const repository = repositoryWithTx(tx);
  return repository.readCurrentGrantResponsePacketExportCandidateReviewState(input, {
    composeRenderModel: async () => ({ ok: true, data: model, error: null }),
  });
}

test("P14-06D current packet with no candidate returns no candidate/review state and creates nothing", async () => {
  const tx = makeReadTx({ candidatesByFingerprint: {} });
  const result = await readState({ tx });
  assert.equal(result.ok, true);
  assert.equal(result.data.grantResponsePacketExportCandidateId, null);
  assert.equal(result.data.reviewQueueItemId, null);
  assert.equal(result.data.queueStatus, null);
  assert.equal(result.data.reviewStatus, null);
  assert.equal(result.data.reviewUpdatedAt, null);
  assert.equal(tx.queries.some((q) => /\bINSERT\b|\bUPDATE\b|\bDELETE\b/i.test(q.sql)), false);
});

test("P14-06D exact current candidate with no review returns that candidate and no queue state", async () => {
  const tx = makeReadTx({ candidatesByFingerprint: { [currentFingerprint]: CANDIDATE } });
  const result = await readState({ tx });
  assert.equal(result.ok, true);
  assert.equal(result.data.grantResponsePacketExportCandidateId, CANDIDATE);
  assert.equal(result.data.reviewQueueItemId, null);
  assert.equal(result.data.queueStatus, null);
  assert.equal(result.data.reviewStatus, null);
});

for (const [name, queueStatus, reviewStatus] of [
  ["open", "open", "needs_gk_review"],
  ["in_progress", "in_progress", "needs_gk_review"],
  ["resolved", "resolved", "resolved"],
]) {
  test(`P14-06D current candidate with ${name} review returns exact queue state`, async () => {
    const tx = makeReadTx({
      candidatesByFingerprint: { [currentFingerprint]: CANDIDATE },
      reviewRowsByCandidate: { [CANDIDATE]: queueRow({ queueStatus, reviewStatus }) },
    });
    const result = await readState({ tx });
    assert.equal(result.ok, true);
    assert.equal(result.data.grantResponsePacketExportCandidateId, CANDIDATE);
    assert.equal(result.data.reviewQueueItemId, QUEUE);
    assert.equal(result.data.queueStatus, queueStatus);
    assert.equal(result.data.reviewStatus, reviewStatus);
    assert.equal(result.data.reviewUpdatedAt, UPDATED_AT);
  });
}

test("P14-06D changed packet fingerprint excludes an older candidate instead of choosing latest/newest", async () => {
  const tx = makeReadTx({
    candidatesByFingerprint: { [changedFingerprint]: OLD_CANDIDATE },
    reviewRowsByCandidate: { [OLD_CANDIDATE]: queueRow({ candidateId: OLD_CANDIDATE }) },
  });
  const result = await readState({ tx });
  assert.equal(result.ok, true);
  assert.equal(result.data.grantResponsePacketExportCandidateId, null);
  assert.equal(tx.queries.some((q) => q.params?.includes(changedFingerprint)), false);
  assert.equal(tx.queries.some((q) => q.params?.includes(currentFingerprint)), true);
});

test("P14-06D wrong organization and wrong engagement cannot expose candidate/review state", async () => {
  const orgResult = await readState({
    tx: makeReadTx({
      candidatesByFingerprint: { [currentFingerprint]: CANDIDATE },
      reviewRowsByCandidate: { [CANDIDATE]: queueRow() },
    }),
    input: readInput({ organizationId: OTHER_ORG }),
  });
  assert.equal(orgResult.ok, true);
  assert.equal(orgResult.data.grantResponsePacketExportCandidateId, null);

  const engagementResult = await readState({
    tx: makeReadTx({
      identityByEngagement: { [ENGAGEMENT]: IDENTITY, [OTHER_ENGAGEMENT]: OTHER_IDENTITY },
      candidatesByFingerprint: { [currentFingerprint]: CANDIDATE },
      reviewRowsByCandidate: { [CANDIDATE]: queueRow() },
    }),
    input: readInput({ engagementId: OTHER_ENGAGEMENT }),
  });
  assert.equal(engagementResult.ok, true);
  assert.equal(engagementResult.data.grantResponsePacketExportCandidateId, null);
});

test("P14-06D repository source uses fingerprint equality only, with no latest/newest/created_at/updated_at selection", () => {
  const source = readFileSync(new URL("../Backend/kai/dictionary/postgresGrantResponsePacketExportCandidateRepository.js", import.meta.url), "utf8");
  const start = source.indexOf("async readCurrentGrantResponsePacketExportCandidateReviewState");
  const end = source.indexOf("\n    },\n  });", start);
  const fn = source.slice(start, end);
  assert.match(fn, /loadExistingCandidate/);
  assert.doesNotMatch(fn, /ORDER BY/i);
  assert.doesNotMatch(fn, /LIMIT\s+1/i);
  assert.doesNotMatch(fn, /latest|newest|oldest|preferred/i);
  const loadExistingCandidateSource = source.slice(
    source.indexOf("async function loadExistingCandidate"),
    source.indexOf("\n}\n\nasync function loadCandidateMembers"),
  );
  assert.match(loadExistingCandidateSource, /canonical_fingerprint\s*=\s*\$3/);
  assert.doesNotMatch(loadExistingCandidateSource, /ORDER BY|LIMIT\s+1|created_at|updated_at|latest|newest|oldest|preferred/i);
});

test("P14-06D packet GET hides packet candidate/review identity from restricted actors", async () => {
  const generatedContentRepository = {
    async getGrantResponsePacket() {
      return { ok: true, data: { organizationId: ORG, engagementId: ENGAGEMENT, packetAudience: "funder", drafts: [] }, error: null };
    },
  };
  const candidateRepository = {
    calls: 0,
    async readCurrentGrantResponsePacketExportCandidateReviewState() {
      this.calls += 1;
      throw new Error("restricted actor must not read packet candidate/review state");
    },
  };
  const result = await getGrantResponsePacket({
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    actorContext: gkReviewerActorContext,
  }, {
    env: enabledEnv,
    generatedContentRepository,
    grantResponsePacketExportCandidateRepository: candidateRepository,
  });
  assert.equal(result.ok, true);
  assert.equal(candidateRepository.calls, 0);
  assert.equal(result.data.exportReviewVisible, false);
  assert.equal(result.data.grantResponsePacketExportCandidateId, null);
  assert.equal(result.data.reviewQueueItemId, null);
  assert.equal(result.data.queueStatus, null);
  assert.equal(result.data.reviewStatus, null);
  assert.equal(result.data.reviewUpdatedAt, null);
});

test("P14-06D packet GET exposes current candidate/review state to the export-review-visible actor", async () => {
  const generatedContentRepository = {
    async getGrantResponsePacket() {
      return { ok: true, data: { organizationId: ORG, engagementId: ENGAGEMENT, packetAudience: "funder", drafts: [] }, error: null };
    },
  };
  const candidateRepository = {
    async readCurrentGrantResponsePacketExportCandidateReviewState() {
      return {
        ok: true,
        data: {
          organizationId: ORG,
          engagementId: ENGAGEMENT,
          grantResponsePacketExportCandidateId: CANDIDATE,
          reviewQueueItemId: QUEUE,
          queueStatus: "open",
          reviewStatus: "needs_gk_review",
          reviewUpdatedAt: UPDATED_AT,
        },
        error: null,
      };
    },
    async readGrantResponsePacketExportCandidateReviewStateById() {
      throw new Error("must not be called by this test's fake eligibility evaluator");
    },
  };
  let eligibilityCalls = 0;
  const result = await getGrantResponsePacket({
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    actorContext: gkAdminActorContext,
  }, {
    env: enabledEnv,
    generatedContentRepository,
    grantResponsePacketExportCandidateRepository: candidateRepository,
    grantResponsePacketHumanAuthorityDecisionRepository: {},
    evaluateGrantResponsePacketFinalExportEligibility: async (evaluateInput) => {
      eligibilityCalls += 1;
      assert.equal(evaluateInput.grantResponsePacketExportCandidateId, CANDIDATE);
      return {
        ok: true,
        data: {
          grantResponsePacketExportCandidateId: CANDIDATE,
          packetCandidateCurrent: true,
          reviewResolved: false,
          memberCurrentUseEligible: true,
          effectiveHumanExportAuthority: false,
          effectivenessReason: "no_decision",
          finalExportEligible: false,
          validatorResult: { severity: "blocker", evidence: { failed_gates: ["generated_content_review_unresolved"] } },
        },
        error: null,
      };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(eligibilityCalls, 1);
  assert.equal(result.data.exportReviewVisible, true);
  assert.equal(result.data.grantResponsePacketExportCandidateId, CANDIDATE);
  assert.equal(result.data.reviewQueueItemId, QUEUE);
  assert.equal(result.data.queueStatus, "open");
  assert.equal(result.data.reviewStatus, "needs_gk_review");
  assert.equal(result.data.reviewUpdatedAt, UPDATED_AT);
  assert.equal(result.data.finalReleaseAuthorityEffective, false);
  assert.equal(result.data.finalReleaseAuthorityReason, "no_decision");
  assert.equal(result.data.finalExportEligible, false);
  assert.deepEqual(result.data.finalExportEligibilityBlockedReasons, ["generated_content_review_unresolved"]);
  for (const key of Object.keys(result.data)) {
    assert.doesNotMatch(key, /manifest|approval/i);
  }
});

test("P14-06D existing REQUEST/START/COMPLETE route behavior remains on POST siblings, while read uses existing GET", () => {
  const source = readFileSync(new URL("../Backend/kai/routes/sprint2IntakeApi.js", import.meta.url), "utf8");
  assert.equal((source.match(/router\.get\(\s*\n\s*"\/admin\/organizations\/:organizationId\/engagements\/:engagementId\/grant-response-packet"/g) || []).length, 1);
  assert.equal((source.match(/router\.post\(\s*\n\s*"\/admin\/organizations\/:organizationId\/engagements\/:engagementId\/grant-response-packet\/export-candidates\/:grantResponsePacketExportCandidateId\/export-review-request"/g) || []).length, 1);
  assert.equal((source.match(/router\.post\(\s*\n\s*"\/admin\/organizations\/:organizationId\/engagements\/:engagementId\/grant-response-packet\/export-candidates\/:grantResponsePacketExportCandidateId\/export-review-queue\/:exportReviewQueueItemId\/start"/g) || []).length, 1);
  assert.equal((source.match(/router\.post\(\s*\n\s*"\/admin\/organizations\/:organizationId\/engagements\/:engagementId\/grant-response-packet\/export-candidates\/:grantResponsePacketExportCandidateId\/export-review-queue\/:exportReviewQueueItemId\/complete"/g) || []).length, 1);
});
