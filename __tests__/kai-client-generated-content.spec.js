import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express from "express";

import { resolveKaiActorContext } from "../Backend/kai/auth/kaiActorContext.js";
import { validateActorCanPerformOperation } from "../Backend/kai/auth/kaiAuthorizationService.js";
import { KAI_SPRINT2_P0_OPERATION_ROLES } from "../Backend/kai/config/kaiSprint2P0Contract.js";
import {
  getClientBoardReportingPreview,
  getClientGeneratedDraft,
  getClientGrantResponsePacketPreview,
  listClientGeneratedDrafts,
  __clientGeneratedContentServiceContract,
} from "../Backend/kai/services/kaiClientGeneratedContentService.js";
import {
  completeGeneratedContentReview,
  createEvidenceSummaryDraft,
  getGeneratedDraftReviewPacket,
  startGeneratedContentReview,
  __generatedContentServiceContract,
} from "../Backend/kai/services/kaiGeneratedContentService.js";
import { listGeneratedDraftLibraryIndex } from "../Backend/kai/services/kaiGeneratedDraftLibraryService.js";
import { getGrantResponsePacket } from "../Backend/kai/services/kaiGrantResponsePacketService.js";
import { getBoardReportingPacket } from "../Backend/kai/services/kaiBoardReportingPacketService.js";
import { __exportReviewServiceContract } from "../Backend/kai/services/kaiExportReviewService.js";
import { completeClientFollowup } from "../Backend/kai/services/kaiClientFollowupCompletionService.js";
import { getOrganizationAccessCapabilities } from "../Backend/kai/services/kaiOrganizationAccessCapabilitiesService.js";
import sprint2IntakeApiRouter, { __testables as routeTestables } from "../Backend/kai/routes/sprint2IntakeApi.js";
import {
  clientBoardReportingPreviewPath,
  clientGeneratedDraftPath,
  clientGeneratedDraftsPath,
  clientGrantResponsePacketPath,
  projectClientGeneratedDraft,
  projectClientGeneratedDraftList,
  projectClientPacketPreview,
} from "../frontend/impactEvidenceLibraryLogic.js";

/**
 * Client-safe Generated Drafts and packet previews. The real service, the
 * real GK index-row contract (responseDraftSummary), and the real
 * single-draft packet validator run; only the repository and index reads
 * are injected. The real-PostgreSQL path is proven by the board-reporting
 * mixed-content runner.
 */

const ENV = Object.freeze({ KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" });
const ORG = "11111111-2222-4333-8444-555555555555";
const OTHER_ORG = "99999999-8888-4777-8666-555555555555";
const ENGAGEMENT = "22222222-3333-4444-8555-666666666666";
const ENGAGEMENT_B = "22222222-3333-4444-8555-777777777777";
const GK_ORG = 77;
const NOW = "2026-09-24T12:00:00.000Z";

const id = (prefix, n) => `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const DRAFT_VISIBLE = id("d", 1);
const DRAFT_IN_GK_REVIEW = id("d", 2);
const DRAFT_INELIGIBLE = id("d", 3);
const DRAFT_AWAITING_CLIENT = id("d", 4);
const CLAIM_A = id("c", 1);
const CLAIM_B = id("c", 2);

// Nothing below may reach a client payload or error.
const HIDDEN = [
  "GENERATION-RUN-SECRET",
  "a0000000-0000-4000-8000-000000000099",
  "e0000000-0000-4000-8000-000000000001",
  "f0000000-0000-4000-8000-000000000001",
  "b0000000-0000-4000-8000-000000000001",
  "reviewQueueItemId",
  "review_queue_item_id",
  "evidenceItemId",
  "sourceVersionId",
  "supportStrength",
  "reviewed_supported",
  "needs_gk_review",
  "blockerCodes",
  "affectedObjectIds",
  "approvedAudiences",
  "exportReview",
  "exportManifest",
  "finalRelease",
  "grantResponsePacketExportCandidateId",
  "source-code-secret",
  "IN GK REVIEW DRAFT TEXT",
  "INELIGIBLE DRAFT TEXT",
  "AWAITING CLIENT DRAFT TEXT",
  "VAL-PKT-BOUND-001",
];

function citation(claimId, { eligible = true, blockers = [] } = {}) {
  return {
    generatedContentCitationId: "f0000000-0000-4000-8000-000000000001",
    claimId,
    evidenceItemId: "e0000000-0000-4000-8000-000000000001",
    sourceId: "b0000000-0000-4000-8000-000000000001",
    sourceCode: "source-code-secret",
    sourceVersionId: "a0000000-0000-4000-8000-000000000099",
    supportStrength: "reviewed_supported",
    claimReviewStatus: "reviewed",
    evidenceReviewStatus: "resolved",
    currentEligible: eligible,
    blockerCodes: blockers,
    affectedDimensionKeys: [],
    affectedObjectIds: ["a0000000-0000-4000-8000-000000000099"],
    approvedAudiences: ["internal"],
  };
}

function packet(draftId, {
  audience = "internal",
  contentType = "evidence_summary",
  queue = ["resolved", "resolved"],
  text = "Participants completed the program.",
  citations = [citation(CLAIM_A)],
  exportReviewQueueItemId = null,
} = {}) {
  return {
    generationRunId: "a0000000-0000-4000-8000-000000000099",
    generatedContentDraftId: draftId,
    contentType,
    draftStatus: "draft",
    requestedAudience: audience,
    reviewQueueItemId: id("9", 1),
    queueStatus: queue[0],
    reviewStatus: queue[1],
    reviewUpdatedAt: NOW,
    currentUseEligible: citations.every((c) => c.currentEligible === true),
    exportReviewQueueItemId,
    exportReviewQueueStatus: exportReviewQueueItemId ? "open" : null,
    exportReviewStatus: exportReviewQueueItemId ? "needs_gk_review" : null,
    blocks: [{ generatedContentBlockId: id("8", 1), ordinal: 1, text, citations }],
  };
}

const PACKETS = {
  [DRAFT_VISIBLE]: packet(DRAFT_VISIBLE, { citations: [citation(CLAIM_A), citation(CLAIM_B), citation(CLAIM_A)] }),
  [DRAFT_IN_GK_REVIEW]: packet(DRAFT_IN_GK_REVIEW, { queue: ["in_progress", "needs_gk_review"], text: "IN GK REVIEW DRAFT TEXT" }),
  [DRAFT_INELIGIBLE]: packet(DRAFT_INELIGIBLE, { text: "INELIGIBLE DRAFT TEXT", citations: [citation(CLAIM_A, { eligible: false, blockers: ["audience_gate_closed"] })] }),
  [DRAFT_AWAITING_CLIENT]: packet(DRAFT_AWAITING_CLIENT, {
    text: "AWAITING CLIENT DRAFT TEXT",
    citations: [citation(CLAIM_A), citation(CLAIM_B, { eligible: false, blockers: ["client_followup_unresolved"] })],
  }),
};

function indexRow(draftId, p) {
  return {
    generated_content_draft_id: draftId,
    organization_id: ORG,
    content_type: p.contentType,
    requested_audience: p.requestedAudience,
    draft_status: "draft",
    review_queue_item_id: p.reviewQueueItemId,
    queue_status: p.queueStatus,
    review_status: p.reviewStatus,
    created_at: NOW,
    export_review_queue_item_id: null,
    export_review_organization_id: null,
    export_review_queue_type: null,
    export_review_target_object_type: null,
    export_review_target_object_id: null,
    export_review_priority: null,
    export_review_queue_status: null,
    export_review_status: null,
    export_review_blocked_reason: null,
    export_review_assigned_to: null,
    export_review_due_at: null,
    export_review_summary: null,
    export_review_required_action: null,
    export_review_queue_metadata: null,
    export_review_created_by: null,
    export_review_created_by_type: null,
  };
}

function dependencies({ packets = PACKETS, calls = [], grp = null, board = null, packetFailures = {}, draftEngagements = {} } = {}) {
  const ids = Object.keys(packets).sort();
  const engagementOf = (draftId) => draftEngagements[draftId] ?? ENGAGEMENT;
  return {
    env: ENV,
    getEngagementForOrganization: async ({ organizationId, engagementId }) => {
      calls.push("engagement");
      return organizationId === ORG && [ENGAGEMENT, ENGAGEMENT_B].includes(engagementId)
        ? { engagement_id: engagementId, organization_id: organizationId }
        : null;
    },
    readGeneratedDraftEngagementId: async (organizationId, draftId) => {
      calls.push(`draft-engagement:${draftId}`);
      return organizationId === ORG && packets[draftId] ? engagementOf(draftId) : null;
    },
    listGeneratedDraftLibraryIndex: async (organizationId, { limit, afterGeneratedContentDraftId, engagementId }) => {
      calls.push("index");
      assert.equal(organizationId, ORG);
      assert.ok(engagementId, "the client scan is always project-scoped");
      return ids
        .filter((draftId) => engagementOf(draftId) === engagementId)
        .filter((draftId) => afterGeneratedContentDraftId === null || draftId > afterGeneratedContentDraftId)
        .slice(0, limit + 1)
        .map((draftId) => indexRow(draftId, packets[draftId]));
    },
    generatedContentRepository: {
      async getGeneratedDraftReviewPacket({ organizationId, generatedContentDraftId }) {
        calls.push(`packet:${generatedContentDraftId}`);
        if (packetFailures[generatedContentDraftId]) return { ok: false, error: { code: packetFailures[generatedContentDraftId], status: 409 } };
        if (organizationId !== ORG || !packets[generatedContentDraftId]) return { ok: false, error: { code: "not_found", status: 404 } };
        return { ok: true, data: packets[generatedContentDraftId] };
      },
      async getGrantResponsePacket({ organizationId, engagementId }) {
        calls.push("grp");
        if (organizationId !== ORG || engagementId !== ENGAGEMENT) return { ok: false, error: { code: "not_found", status: 404 } };
        return grp || {
          ok: true,
          data: {
            organizationId,
            engagementId,
            packetAudience: "funder",
            drafts: [{ ...packet(id("d", 7), { audience: "funder", text: "Funder paragraph." }), exportManifestId: id("7", 1), exportManifestHistory: [] }],
          },
        };
      },
      async getBoardReportingPacket({ organizationId, engagementId }) {
        calls.push("board");
        if (organizationId !== ORG || engagementId !== ENGAGEMENT) return { ok: false, error: { code: "not_found", status: 404 } };
        return board || { ok: true, data: { organizationId, engagementId, packetAudience: "internal", drafts: [packet(id("d", 8), { contentType: "impact_narrative", text: "Board narrative." })] } };
      },
    },
  };
}

function memberActor(roleName, { organizationId = ORG, kaiRoles = [] } = {}) {
  return {
    actorType: "human",
    actorUserId: `user-${roleName}`,
    kaiRoles,
    platformSuperuser: false,
    organizationMemberships: [{ organization_id: organizationId, role_name: roleName, membership_status: "active" }],
  };
}

async function clientAdminActor(boundOrganizationId = ORG) {
  const result = await resolveKaiActorContext(
    { user: { id: 501, email: "admin@harbourline.test" } },
    {
      findOrCreateKaiUserByLegacyPublicUserdataId: async ({ legacyPublicUserdataId, email }) => ({
        user_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        legacy_identity_source: "public.userdata",
        legacy_public_userdata_id: legacyPublicUserdataId,
        status: "active",
        email,
      }),
      listKaiRolesForUser: async () => [],
      listOrganizationMembershipsForUser: async () => [],
      resolveOrgScopeForUserId: async () => ({ memberships: [{ orgId: GK_ORG, role: "admin", is_active: true }] }),
      listActiveGkOrganizationBindingsForGkOrganizationIds: async (ids) =>
        ids.includes(GK_ORG) ? [{ gk_organization_id: GK_ORG, kai_organization_id: boundOrganizationId, status: "active" }] : [],
    },
  );
  assert.equal(result.ok, true);
  return result.actorContext;
}

function assertNoHidden(value, label) {
  const serialized = JSON.stringify(value);
  for (const secret of HIDDEN) assert.ok(!serialized.includes(secret), `${label} leaked ${secret}`);
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

test("contract: client reads admit the read_intake set; every GK generation, review, export, and final set is unchanged", () => {
  assert.deepEqual(
    [...__clientGeneratedContentServiceContract.CLIENT_GENERATED_CONTENT_ALLOWED_ROLES].sort(),
    [...KAI_SPRINT2_P0_OPERATION_ROLES.read_intake].sort(),
  );
  assert.deepEqual([...__generatedContentServiceContract.GENERATED_CONTENT_ALLOWED_ROLES].sort(), ["gk_admin", "gk_operator", "gk_reviewer"]);
  assert.deepEqual([...__generatedContentServiceContract.GENERATED_CONTENT_REVIEW_ALLOWED_ROLES].sort(), ["gk_admin", "gk_reviewer"]);
  assert.deepEqual([...__generatedContentServiceContract.COMPLETE_GENERATED_CONTENT_REVIEW_ALLOWED_ROLES].sort(), ["gk_admin", "gk_reviewer"]);
  assert.deepEqual([...__exportReviewServiceContract.EXPORT_REVIEW_ALLOWED_ROLES], ["gk_admin"]);
});

// ---------------------------------------------------------------------------
// Visibility and projection
// ---------------------------------------------------------------------------

test("list: only GK-reviewed, currently eligible drafts; held-only-by-client-follow-up drafts are counted, never shown", async () => {
  const actorContext = await clientAdminActor();
  const calls = [];
  const result = await listClientGeneratedDrafts({ organizationId: ORG, engagementId: ENGAGEMENT, actorContext }, dependencies({ calls }));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.data, {
    items: [{ generatedContentDraftId: DRAFT_VISIBLE, contentType: "evidence_summary", audience: "internal", reviewState: "reviewed", createdAt: NOW, blockCount: 1 }],
    awaitingClientInputCount: 1,
    nextCursor: null,
  });
  assertNoHidden(result, "list");
  assert.ok(!calls.includes(`packet:${DRAFT_IN_GK_REVIEW}`), "a draft still in GK review is never evaluated or shown");
});

test("detail: a visible draft returns block text and de-duplicated cited claim ids only; exact keys", async () => {
  const result = await getClientGeneratedDraft(
    { organizationId: ORG, engagementId: ENGAGEMENT, generatedContentDraftId: DRAFT_VISIBLE, actorContext: memberActor("client_contributor") },
    dependencies(),
  );
  assert.deepEqual(result.data, {
    generatedContentDraftId: DRAFT_VISIBLE,
    contentType: "evidence_summary",
    audience: "internal",
    reviewState: "reviewed",
    blocks: [{ ordinal: 1, text: "Participants completed the program.", supportingClaimIds: [CLAIM_A, CLAIM_B] }],
  });
  assertNoHidden(result, "detail");
});

test("detail: in-GK-review, ineligible, awaiting-client, foreign, and cross-org draft ids all read as not_found with nothing leaked", async () => {
  const actorContext = memberActor("client_reviewer");
  for (const draftId of [DRAFT_IN_GK_REVIEW, DRAFT_INELIGIBLE, DRAFT_AWAITING_CLIENT, id("d", 99)]) {
    const result = await getClientGeneratedDraft({ organizationId: ORG, engagementId: ENGAGEMENT, generatedContentDraftId: draftId, actorContext }, dependencies());
    assert.equal(result.ok, false, draftId);
    assert.equal(result.error.code, "not_found");
    assertNoHidden(result, `detail ${draftId}`);
  }
  const calls = [];
  const crossOrg = await getClientGeneratedDraft(
    { organizationId: ORG, engagementId: ENGAGEMENT, generatedContentDraftId: DRAFT_VISIBLE, actorContext: memberActor("client_admin", { organizationId: OTHER_ORG }) },
    dependencies({ calls }),
  );
  assert.equal(crossOrg.blockers[0].validator_key, "VAL-AUT-003");
  assert.deepEqual(calls, [], "no draft is read for a cross-org actor");
  // An own-org actor asking with another organization's id is denied too.
  const foreignOrgId = await getClientGeneratedDraft(
    { organizationId: OTHER_ORG, engagementId: ENGAGEMENT, generatedContentDraftId: DRAFT_VISIBLE, actorContext },
    dependencies({ calls }),
  );
  assert.equal(foreignOrgId.blockers[0].validator_key, "VAL-AUT-003");
  assert.deepEqual(calls, []);
});

test("unknown content type, audience/type mismatch, or malformed packet fails closed", async () => {
  const actorContext = memberActor("client_admin");
  const badType = await getClientGeneratedDraft(
    { organizationId: ORG, engagementId: ENGAGEMENT, generatedContentDraftId: DRAFT_VISIBLE, actorContext },
    dependencies({ packets: { [DRAFT_VISIBLE]: packet(DRAFT_VISIBLE, { contentType: "press_release" }) } }),
  );
  assert.equal(badType.ok, false);
  assert.equal(badType.error.code, "system_error");
  const mismatch = await getClientGeneratedDraft(
    { organizationId: ORG, engagementId: ENGAGEMENT, generatedContentDraftId: DRAFT_VISIBLE, actorContext },
    dependencies({ packets: { [DRAFT_VISIBLE]: packet(DRAFT_VISIBLE, { contentType: "board_update", audience: "public" }) } }),
  );
  assert.equal(mismatch.ok, false, "board_update is internal-only; a public one is never shown");
  const list = await listClientGeneratedDrafts(
    { organizationId: ORG, engagementId: ENGAGEMENT, actorContext },
    dependencies({ packets: { [DRAFT_VISIBLE]: { ...packet(DRAFT_VISIBLE), extra: "x" } } }),
  );
  assert.equal(list.ok, false);
  assert.equal(list.error.code, "system_error");
});

test("a per-draft current-state conflict hides that draft; any other failure fails the list closed", async () => {
  const actorContext = memberActor("client_admin");
  const conflict = await listClientGeneratedDrafts({ organizationId: ORG, engagementId: ENGAGEMENT, actorContext }, dependencies({ packetFailures: { [DRAFT_VISIBLE]: "conflict_current_state_changed" } }));
  assert.equal(conflict.ok, true);
  assert.deepEqual(conflict.data.items, []);
  const failure = await listClientGeneratedDrafts({ organizationId: ORG, engagementId: ENGAGEMENT, actorContext }, dependencies({ packetFailures: { [DRAFT_VISIBLE]: "system_error" } }));
  assert.equal(failure.ok, false);
});

test("pagination: each request scans at most 50 index rows; the opaque cursor continues without duplicates or skips, ineligible rows included", async () => {
  const total = 130;
  const packets = Object.fromEntries(Array.from({ length: total }, (_, index) => {
    const draftId = id("d", 100 + index);
    // Every third draft is ineligible: pages must still advance past it.
    const citations = index % 3 === 0 ? [citation(CLAIM_A, { eligible: false, blockers: ["audience_gate_closed"] })] : [citation(CLAIM_A)];
    return [draftId, packet(draftId, { citations })];
  }));
  const actorContext = memberActor("client_admin");
  const seen = [];
  let cursor = null;
  let requests = 0;
  do {
    const calls = [];
    const input = { organizationId: ORG, engagementId: ENGAGEMENT, actorContext, ...(cursor ? { cursor } : {}) };
    const result = await listClientGeneratedDrafts(input, dependencies({ packets, calls }));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(Object.keys(result.data).sort(), ["awaitingClientInputCount", "items", "nextCursor"]);
    assert.ok(calls.filter((call) => call.startsWith("packet:")).length <= __clientGeneratedContentServiceContract.CLIENT_DRAFT_SCAN_LIMIT);
    if (result.data.nextCursor) {
      assert.match(result.data.nextCursor, /^c1\./);
      assert.ok(!Object.keys(packets).includes(result.data.nextCursor), "the cursor is not a raw draft id");
    }
    seen.push(...result.data.items.map((item) => item.generatedContentDraftId));
    cursor = result.data.nextCursor;
    requests += 1;
  } while (cursor && requests < 10);
  const expected = Object.keys(packets).filter((_, index) => index % 3 !== 0).sort();
  assert.equal(requests, Math.ceil(total / __clientGeneratedContentServiceContract.CLIENT_DRAFT_SCAN_LIMIT));
  assert.deepEqual([...seen].sort(), expected, "every visible draft exactly once");
  assert.equal(new Set(seen).size, seen.length);
  // Exactly 50 rows: one full page and no cursor.
  const fifty = Object.fromEntries(Object.entries(packets).slice(0, 50));
  const exact = await listClientGeneratedDrafts({ organizationId: ORG, engagementId: ENGAGEMENT, actorContext }, dependencies({ packets: fifty }));
  assert.equal(exact.data.nextCursor, null);
  for (const bad of ["not-a-cursor", "c1.bm90LWEtdXVpZA", `c1.${Buffer.from(id("d", 1).toUpperCase()).toString("base64url")}`]) {
    const rejected = await listClientGeneratedDrafts({ organizationId: ORG, engagementId: ENGAGEMENT, actorContext, cursor: bad }, dependencies({ packets }));
    assert.equal(rejected.error.code, "validation_blocker", bad);
  }
});

test("project scoping: each project's list and detail contain only its own drafts; another project's draft is not_found", async () => {
  const draftA = id("d", 201);
  const draftB = id("d", 202);
  const packets = { [draftA]: packet(draftA, { text: "Alpha text." }), [draftB]: packet(draftB, { text: "Beta text." }) };
  const deps = dependencies({ packets, draftEngagements: { [draftB]: ENGAGEMENT_B } });
  const actorContext = memberActor("client_reviewer");
  const listA = await listClientGeneratedDrafts({ organizationId: ORG, engagementId: ENGAGEMENT, actorContext }, deps);
  const listB = await listClientGeneratedDrafts({ organizationId: ORG, engagementId: ENGAGEMENT_B, actorContext }, deps);
  assert.deepEqual(listA.data.items.map((item) => item.generatedContentDraftId), [draftA]);
  assert.deepEqual(listB.data.items.map((item) => item.generatedContentDraftId), [draftB]);
  const crossProject = await getClientGeneratedDraft({ organizationId: ORG, engagementId: ENGAGEMENT, generatedContentDraftId: draftB, actorContext }, deps);
  assert.equal(crossProject.error.code, "not_found");
  assert.doesNotMatch(JSON.stringify(crossProject), /Beta text/);
  const ownProject = await getClientGeneratedDraft({ organizationId: ORG, engagementId: ENGAGEMENT_B, generatedContentDraftId: draftB, actorContext }, deps);
  assert.equal(ownProject.data.blocks[0].text, "Beta text.");
  // An engagement outside the organization is not_found before any draft read.
  const calls = [];
  const foreignEngagement = await listClientGeneratedDrafts(
    { organizationId: ORG, engagementId: id("2", 9), actorContext },
    dependencies({ packets, calls }),
  );
  assert.equal(foreignEngagement.error.code, "not_found");
  assert.deepEqual(calls, ["engagement"]);
});

test("GK-only metadata never changes the client payload; changing client-visible content does", async () => {
  const actorContext = memberActor("client_reviewer");
  const read = (p) => getClientGeneratedDraft({ organizationId: ORG, engagementId: ENGAGEMENT, generatedContentDraftId: DRAFT_VISIBLE, actorContext }, dependencies({ packets: { [DRAFT_VISIBLE]: p } }));
  const base = await read(packet(DRAFT_VISIBLE));
  const internalChanged = packet(DRAFT_VISIBLE, { exportReviewQueueItemId: id("6", 1) });
  internalChanged.generationRunId = id("5", 5);
  internalChanged.reviewQueueItemId = id("5", 6);
  internalChanged.reviewUpdatedAt = "2026-09-25T00:00:00.000Z";
  internalChanged.blocks[0].citations[0].supportStrength = "reviewed_with_limitation";
  internalChanged.blocks[0].citations[0].evidenceItemId = id("5", 7);
  assert.deepEqual((await read(internalChanged)).data, base.data);
  const textChanged = await read(packet(DRAFT_VISIBLE, { text: "Participants completed and returned." }));
  assert.notDeepEqual(textChanged.data, base.data);
});

// ---------------------------------------------------------------------------
// Packet previews
// ---------------------------------------------------------------------------

test("Grant Response Packet and Board Reporting previews: governed membership only, no export/manifest/candidate/final state", async () => {
  const actorContext = await clientAdminActor();
  const grp = await getClientGrantResponsePacketPreview({ organizationId: ORG, engagementId: ENGAGEMENT, actorContext }, dependencies());
  assert.equal(grp.ok, true, JSON.stringify(grp));
  assert.deepEqual(grp.data, {
    engagementId: ENGAGEMENT,
    audience: "funder",
    status: "available",
    drafts: [{ generatedContentDraftId: id("d", 7), contentType: "evidence_summary", audience: "funder", reviewState: "reviewed", blocks: [{ ordinal: 1, text: "Funder paragraph.", supportingClaimIds: [CLAIM_A] }] }],
  });
  const board = await getClientBoardReportingPreview({ organizationId: ORG, engagementId: ENGAGEMENT, actorContext }, dependencies());
  assert.equal(board.data.audience, "internal");
  assert.equal(board.data.drafts[0].contentType, "impact_narrative");
  assertNoHidden([grp, board], "previews");

  const empty = await getClientGrantResponsePacketPreview(
    { organizationId: ORG, engagementId: ENGAGEMENT, actorContext },
    dependencies({ grp: { ok: true, data: { organizationId: ORG, engagementId: ENGAGEMENT, packetAudience: "funder", drafts: [] } } }),
  );
  assert.deepEqual(empty.data, { engagementId: ENGAGEMENT, audience: "funder", status: "no_reviewed_drafts", drafts: [] });

  const bounded = await getClientGrantResponsePacketPreview(
    { organizationId: ORG, engagementId: ENGAGEMENT, actorContext },
    dependencies({ grp: { ok: false, error: { code: "validation_blocker", status: 422 }, blockers: [{ validator_key: "VAL-PKT-BOUND-001" }] } }),
  );
  assert.equal(bounded.ok, false);
  assertNoHidden(bounded, "bounded error");

  const badMember = await getClientBoardReportingPreview(
    { organizationId: ORG, engagementId: ENGAGEMENT, actorContext },
    dependencies({ board: { ok: true, data: { organizationId: ORG, engagementId: ENGAGEMENT, packetAudience: "internal", drafts: [PACKETS[DRAFT_IN_GK_REVIEW]] } } }),
  );
  assert.equal(badMember.ok, false, "a packet member violating the visibility rule is a contract failure");
  assert.equal(badMember.error.code, "system_error");

  const foreignEngagement = await getClientGrantResponsePacketPreview(
    { organizationId: ORG, engagementId: id("2", 9), actorContext },
    dependencies(),
  );
  assert.equal(foreignEngagement.error.code, "not_found");
});

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

test("roles: binding-derived client_admin, client_reviewer, client_contributor, and GK roles get the same client projection", async () => {
  const expected = (await listClientGeneratedDrafts({ organizationId: ORG, engagementId: ENGAGEMENT, actorContext: await clientAdminActor() }, dependencies())).data;
  for (const actorContext of [memberActor("client_reviewer"), memberActor("client_contributor"), memberActor("gk_reviewer"), memberActor("gk_operator", { kaiRoles: ["gk_operator"] })]) {
    const result = await listClientGeneratedDrafts({ organizationId: ORG, engagementId: ENGAGEMENT, actorContext }, dependencies());
    assert.deepEqual(result.data, expected);
  }
});

test("no client role gains generation, GK review, GK draft/packet reads, export, or final authority", async () => {
  const deps = dependencies();
  for (const actorContext of [await clientAdminActor(), memberActor("client_reviewer"), memberActor("client_contributor")]) {
    const denials = {
      generate: await createEvidenceSummaryDraft({ organizationId: ORG, claimIds: [CLAIM_A], requestedAudience: "internal", actorContext, now: NOW }, deps),
      startReview: await startGeneratedContentReview({ organizationId: ORG, generatedContentDraftId: DRAFT_VISIBLE, reviewQueueItemId: id("9", 1), expectedUpdatedAt: NOW, actorContext, now: NOW }, deps),
      completeReview: await completeGeneratedContentReview({ organizationId: ORG, generatedContentDraftId: DRAFT_VISIBLE, reviewQueueItemId: id("9", 1), expectedUpdatedAt: NOW, actorContext, now: NOW }, deps),
      gkPacket: await getGeneratedDraftReviewPacket({ organizationId: ORG, generatedContentDraftId: DRAFT_VISIBLE, actorContext }, deps),
      gkIndex: await listGeneratedDraftLibraryIndex({ organizationId: ORG, limit: 25, actorContext }, deps),
      gkGrp: await getGrantResponsePacket({ organizationId: ORG, engagementId: ENGAGEMENT, actorContext }, deps),
      gkBoard: await getBoardReportingPacket({ organizationId: ORG, engagementId: ENGAGEMENT, actorContext }, deps),
    };
    for (const [label, result] of Object.entries(denials)) {
      assert.equal(result.ok, false, label);
      assert.ok(["authorization_denied", "validation_blocker"].includes(result.error.code), `${label}: ${result.error.code}`);
    }
    for (const operation of ["request_export_review", "record_final_release_authority", "create_export_manifest"]) {
      assert.equal(validateActorCanPerformOperation(actorContext, operation, ORG, { allowedRoles: __exportReviewServiceContract.EXPORT_REVIEW_ALLOWED_ROLES }).ok, false);
    }
  }
});

test("conditional client review stays the P2-11 follow-up: client_reviewer only, and client_admin/contributor are denied", async () => {
  const followup = { organizationId: ORG, claimId: CLAIM_B, clientFollowupItemId: id("4", 1), expectedUpdatedAt: NOW, now: NOW };
  for (const role of ["client_admin", "client_contributor"]) {
    const denied = await completeClientFollowup({ ...followup, actorContext: memberActor(role) }, { env: ENV });
    assert.equal(denied.ok, false);
    assert.equal(denied.blockers[0].blocking_reason, "role_not_allowed", role);
  }
  assert.equal(
    validateActorCanPerformOperation(memberActor("client_reviewer"), "complete_client_followup", ORG, { allowedRoles: new Set(["client_reviewer"]) }).ok,
    true,
  );
  const capabilities = await getOrganizationAccessCapabilities({ organizationId: ORG, actorContext: memberActor("client_reviewer") }, { env: ENV });
  assert.equal(capabilities.data.clientFollowupReview, true, "the existing capability gates the follow-up link");
  for (const role of ["client_admin", "client_contributor"]) {
    const other = await getOrganizationAccessCapabilities({ organizationId: ORG, actorContext: memberActor(role) }, { env: ENV });
    assert.equal(other.data.clientFollowupReview, false, role);
  }
});

test("cross-org and invalid input: denied before any draft, packet, or board read", async () => {
  const calls = [];
  const deps = dependencies({ calls });
  const crossOrg = await clientAdminActor(OTHER_ORG);
  for (const result of [
    await listClientGeneratedDrafts({ organizationId: ORG, engagementId: ENGAGEMENT, actorContext: crossOrg }, deps),
    await getClientGrantResponsePacketPreview({ organizationId: ORG, engagementId: ENGAGEMENT, actorContext: crossOrg }, deps),
    await getClientBoardReportingPreview({ organizationId: ORG, engagementId: ENGAGEMENT, actorContext: memberActor("client_contributor", { organizationId: OTHER_ORG }) }, deps),
  ]) {
    assert.equal(result.ok, false);
    assert.equal(result.blockers[0].validator_key, "VAL-AUT-003");
  }
  assert.deepEqual(calls, []);
  const actorContext = memberActor("client_admin");
  assert.equal((await listClientGeneratedDrafts({ organizationId: "ABCDEF00-2222-4333-8444-555555555555", engagementId: ENGAGEMENT, actorContext }, deps)).error.code, "validation_blocker");
  assert.equal((await listClientGeneratedDrafts({ organizationId: ORG, engagementId: ENGAGEMENT, actorContext, limit: 5 }, deps)).error.code, "validation_blocker");
  assert.equal((await getClientGeneratedDraft({ organizationId: ORG, engagementId: ENGAGEMENT, actorContext }, deps)).error.code, "validation_blocker");
  assert.equal((await listClientGeneratedDrafts({ organizationId: ORG, engagementId: ENGAGEMENT, actorContext: { actorType: "service" } }, deps)).error.code, "authorization_denied");
  assert.equal((await listClientGeneratedDrafts({ organizationId: ORG, engagementId: ENGAGEMENT, actorContext }, { ...deps, env: { KAI_SPRINT2_ENABLED: "true" } })).error.code, "feature_disabled");
});

// ---------------------------------------------------------------------------
// Mounted routes
// ---------------------------------------------------------------------------

test("routes: each client read forwards only its path ids and the resolved actor; malformed ids never reach the service", async () => {
  const actorContext = memberActor("client_contributor");
  const received = [];
  const stub = (name) => async (input) => {
    received.push([name, input]);
    return { ok: true, data: {} };
  };
  const restoreService = routeTestables.setIntakeServiceForTest({
    listClientGeneratedDrafts: stub("list"),
    getClientGeneratedDraft: stub("detail"),
    getClientGrantResponsePacketPreview: stub("grp"),
    getClientBoardReportingPreview: stub("board"),
  });
  const restoreActor = routeTestables.setActorContextMiddlewareForTest((req, _res, next) => {
    req.kaiSprint2ActorContext = actorContext;
    next();
  });
  const originalFlag = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "true";
  const app = express();
  app.use((req, _res, next) => {
    req.isAuthenticated = () => true;
    req.user = { id: 601 };
    next();
  });
  app.use("/api/kai/sprint2/intake", sprint2IntakeApiRouter);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const q = `organization_id=${OTHER_ORG}&audience=public&include_internal=true`;
    for (const path of [
      clientGeneratedDraftsPath(ORG, ENGAGEMENT, "c1.opaque"),
      clientGeneratedDraftPath(ORG, ENGAGEMENT, DRAFT_VISIBLE),
      clientGrantResponsePacketPath(ORG, ENGAGEMENT),
      clientBoardReportingPreviewPath(ORG, ENGAGEMENT),
    ]) {
      assert.equal((await fetch(`${base}${path}${path.includes("?") ? "&" : "?"}${q}`)).status, 200, path);
    }
    assert.deepEqual(received, [
      ["list", { organizationId: ORG, engagementId: ENGAGEMENT, cursor: "c1.opaque", actorContext }],
      ["detail", { organizationId: ORG, engagementId: ENGAGEMENT, generatedContentDraftId: DRAFT_VISIBLE, actorContext }],
      ["grp", { organizationId: ORG, engagementId: ENGAGEMENT, actorContext }],
      ["board", { organizationId: ORG, engagementId: ENGAGEMENT, actorContext }],
    ]);
    for (const path of [
      clientGeneratedDraftsPath("not-a-uuid", ENGAGEMENT),
      clientGeneratedDraftPath(ORG, ENGAGEMENT, "ABCDEF00-0000-4000-8000-000000000001"),
      clientGrantResponsePacketPath(ORG, "nope"),
      clientBoardReportingPreviewPath("nope", ENGAGEMENT),
    ]) {
      assert.equal((await fetch(`${base}${path}`)).status, 422, path);
    }
    assert.equal(received.length, 4);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    restoreActor();
    restoreService();
    process.env.KAI_SPRINT2_ENABLED = originalFlag;
  }
});

// ---------------------------------------------------------------------------
// Frontend
// ---------------------------------------------------------------------------

const componentSource = readFileSync("frontend/knowledgeStudio/ClientGeneratedDrafts.jsx", "utf8");
const clientStudioSource = readFileSync("frontend/knowledgeStudio/ClientKnowledgeStudio.jsx", "utf8");

test("frontend projections fail closed on unknown types, audiences, review states, or packet shape", () => {
  const draft = { generatedContentDraftId: DRAFT_VISIBLE, contentType: "evidence_summary", audience: "internal", reviewState: "reviewed", blocks: [{ ordinal: 1, text: "t", supportingClaimIds: [CLAIM_A], evidenceItemId: "x" }] };
  assert.doesNotMatch(JSON.stringify(projectClientGeneratedDraft(draft)), /evidenceItemId/);
  assert.equal(projectClientGeneratedDraft({ ...draft, reviewState: "final" }), null);
  assert.equal(projectClientGeneratedDraft({ ...draft, contentType: "press_release" }), null);
  assert.equal(projectClientGeneratedDraft({ ...draft, audience: "board" }), null);
  assert.equal(projectClientGeneratedDraftList({ items: [], awaitingClientInputCount: "1", nextCursor: null }), null);
  assert.equal(projectClientGeneratedDraftList({ items: [], awaitingClientInputCount: 0, nextCursor: 5 }), null);
  assert.deepEqual(projectClientGeneratedDraftList({ items: [], awaitingClientInputCount: 0, nextCursor: "c1.x" }), { items: [], awaitingClientInputCount: 0, nextCursor: "c1.x" });
  assert.equal(projectClientPacketPreview({ audience: "funder", status: "available", drafts: [] }, "funder"), null);
  assert.equal(projectClientPacketPreview({ audience: "funder", status: "no_reviewed_drafts", drafts: [draft] }, "funder"), null, "audience mismatch");
  assert.deepEqual(projectClientPacketPreview({ audience: "funder", status: "no_reviewed_drafts", drafts: [] }, "funder").drafts, []);
});

test("frontend: the Generated Drafts tab makes only client-safe reads and offers no generation/review/export/release control", () => {
  // Two read helpers: bounded draft pages and single client-safe reads.
  const requests = componentSource.match(/getJson\([^)]*\)?/g) || [];
  assert.deepEqual(requests, ["getJson(path)", "getJson(clientGeneratedDraftsPath(organizationId, engagementId, cursor)"]);
  for (const builder of ["clientGeneratedDraftsPath", "clientGeneratedDraftPath", "clientGrantResponsePacketPath", "clientBoardReportingPreviewPath"]) {
    assert.match(componentSource, new RegExp(`${builder}\\(`), builder);
  }
  for (const forbidden of [
    "generatedDraftLibraryIndexPath",
    "generatedDraftReviewPacketPath",
    "grantResponsePacketPath(",
    "boardReportingPacketPath",
    "boardReportingCandidatesPath",
    "generatedContentReviewStartPath",
    "generatedContentReviewCompletePath",
    "exportReviewRequestPath",
    "postJson",
    "fetch(",
    "reviewQueueItemId",
    "evidenceItemId",
  ]) {
    assert.ok(!componentSource.includes(forbidden), forbidden);
  }
  assert.doesNotMatch(componentSource, /create[A-Z]\w*Path|Draft\(\{|<form/, "no generation path builder or form");
  assert.match(componentSource, /list\.status === "success" && list\.awaitingClientInputCount > 0 && canReviewFollowups \? \(/);
  assert.match(componentSource, /onClick=\{list\.loadMore\}/);
  assert.match(componentSource, /if \(keyRef\.current !== requestKey\) return;/, "late responses for a previous project are dropped");
  assert.match(clientStudioSource, /\["generatedDrafts", "Generated Drafts"\]/);
  assert.match(clientStudioSource, /<ClientGeneratedDrafts\s+organizationId=\{organizationId\}\s+engagementId=\{engagementId\}\s+facts=\{facts\}\s+canReviewFollowups=\{canReviewFollowups\}\s+\/>/);
  assert.doesNotMatch(clientStudioSource, /getJson\(|postJson\(|fetch\(/);
});
