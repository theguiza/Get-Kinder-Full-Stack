import test from "node:test";
import assert from "node:assert/strict";
import { validateActorCanAccessKnowledgeWorkspace, validateActorCanPerformOperation } from "../Backend/kai/auth/kaiAuthorizationService.js";
import { getOrganizationAccessCapabilities } from "../Backend/kai/services/kaiOrganizationAccessCapabilitiesService.js";
import { listClaimLibraryCandidates } from "../Backend/kai/services/kaiClaimLibraryService.js";
import { listOrganizationEvidenceLibrary } from "../Backend/kai/services/kaiEvidenceLibraryService.js";
import { listAuthorizedEngagements, __engagementContextServiceContract as project } from "../Backend/kai/services/kaiEngagementContextService.js";
import { authorizeSourcePromotionDecision } from "../Backend/kai/services/kaiSourcePromotionService.js";
import { projectOrganizationAccessCapabilities, claimProposalHandoffOutcome, pendingClaimReviewWork, traceabilityUnavailableMessage, projectSensitivityDecisionResult, sensitivityDecisionResultText } from "../frontend/impactEvidenceLibraryLogic.js";

const ORG = "10000000-0000-4000-8000-000000000001";
const OTHER = "10000000-0000-4000-8000-000000000002";
const env = { KAI_SPRINT2_ENABLED: "true" };
const actor = (role, global = [], extra = {}) => ({
  actorType: "human", actorUserId: "10000000-0000-4000-8000-000000000003", kaiUserStatus: "active",
  kaiRoles: global, organizationMemberships: [{ organization_id: ORG, role_name: role, membership_status: "active" }], ...extra,
});
// Expected: workspace, human evidence/claim review, direct P2-02/P2-03,
// P1-08 service authority, project mutation. Each policy remains independent.
const cases = [
  ["global reviewer + client admin", actor("client_admin", ["gk_reviewer"]), [true, true, false, false, true]],
  ["global operator + client admin", actor("client_admin", ["gk_operator"]), [true, false, false, false, true]],
  ["global reviewer + org reviewer", actor("gk_reviewer", ["gk_reviewer"]), [true, true, true, true, false]],
  ["org-only reviewer", actor("gk_reviewer"), [true, true, true, true, false]],
  ["global reviewer + contributor", actor("client_contributor", ["gk_reviewer"]), [true, true, false, false, false]],
  ["client admin", actor("client_admin"), [false, false, false, false, true]],
  ["bound client admin", actor("client_admin", [], { organizationMemberships: [{ organization_id: ORG, role_name: "client_admin", membership_status: "active", source: "gk_organization_binding", gk_organization_id: 42 }] }), [false, false, false, false, true]],
  ["client reviewer", actor("client_reviewer"), [false, false, false, false, false]],
  ["client contributor", actor("client_contributor"), [false, false, false, false, false]],
  ["platform exception (full actor only)", actor("client_contributor", [], { platformSuperuser: true, platformSuperuserAuthority: "get_kinder_site_admin" }), [true, true, true, true, true]],
];

for (const [name, actorContext, expected] of cases) {
  test(`integrated effective policy: ${name}`, async () => {
    const result = await getOrganizationAccessCapabilities({ organizationId: ORG, actorContext }, { env });
    assert.equal(result.ok, true);
    const c = result.data;
    assert.deepEqual([c.internalKnowledgeWorkspace, c.workflowOperations.recordEvidenceReview, c.workflowOperations.proposeClaim, authorizeSourcePromotionDecision(actorContext, ORG).ok, c.projectManagement], expected);
    assert.equal(c.workflowOperations.recordClaimReview, expected[1]);
    assert.equal(c.workflowOperations.assessEvidenceCoverage, expected[2]);
    const projects = await listAuthorizedEngagements({ organizationId: ORG, actorContext }, {
      env, listEngagementsForOrganization: async ({ organizationId }) => { assert.equal(organizationId, ORG); return []; },
    });
    assert.equal(projects.ok, true);
    for (const [operation, roles] of [[project.CREATE_ENGAGEMENT_OPERATION, project.CREATE_ENGAGEMENT_ALLOWED_ROLES], [project.UPDATE_ENGAGEMENT_TARGET_OPERATION, project.UPDATE_ENGAGEMENT_TARGET_ALLOWED_ROLES], [project.UPDATE_ENGAGEMENT_PROJECT_DETAILS_OPERATION, project.UPDATE_ENGAGEMENT_PROJECT_DETAILS_ALLOWED_ROLES]]) {
      assert.equal(validateActorCanPerformOperation(actorContext, operation, ORG, { allowedRoles: roles }).ok, expected[4]);
    }
    let reads = 0;
    for (const [service, dependency] of [[listClaimLibraryCandidates, "listClaimLibraryReviewCandidates"], [listOrganizationEvidenceLibrary, "listOrganizationEvidenceItems"]]) {
      const read = await service({ organizationId: ORG, actorContext }, { env, [dependency]: async () => { reads++; return []; } });
      assert.equal(read.ok, expected[0], JSON.stringify(read));
      if (!expected[0]) assert.equal(read.blockers[0].blocking_reason, "role_not_allowed");
    }
    assert.equal(reads, expected[0] ? 2 : 0, "client denials reach no internal reader");
  });
}

for (const membership of [[], [{ organization_id: OTHER, role_name: "gk_reviewer", membership_status: "active" }], [{ organization_id: ORG, role_name: "client_admin", membership_status: "inactive" }]]) {
  test(`global capability never bypasses scope: ${JSON.stringify(membership)}`, async () => {
    const actorContext = actor("client_admin", ["gk_reviewer"], { organizationMemberships: membership });
    assert.equal(validateActorCanAccessKnowledgeWorkspace(actorContext, ORG).ok, false);
    const mustNotRead = async () => assert.fail("unauthorized internal read");
    for (const [service, dependency] of [[listClaimLibraryCandidates, "listClaimLibraryReviewCandidates"], [listOrganizationEvidenceLibrary, "listOrganizationEvidenceItems"], [listAuthorizedEngagements, "listEngagementsForOrganization"]]) {
      const denied = await service({ organizationId: ORG, actorContext }, { env, [dependency]: mustNotRead });
      assert.equal(denied.ok, false);
      assert.equal(denied.blockers[0].blocking_reason, "missing_active_organization_membership");
    }
  });
}

test("authorization modes remain deliberately different", () => {
  const allowedRoles = new Set(["gk_reviewer"]);
  const mixed = actor("client_admin", ["gk_reviewer"]);
  const orgOnly = actor("gk_reviewer");
  const check = (a, options) => validateActorCanPerformOperation(a, "review", ORG, { allowedRoles, ...options }).ok;
  assert.deepEqual([check(mixed, {}), check(mixed, { globalRolesOnly: true }), check(mixed, { combineGlobalRoles: true })], [false, true, true]);
  assert.deepEqual([check(orgOnly, {}), check(orgOnly, { globalRolesOnly: true }), check(orgOnly, { combineGlobalRoles: true })], [true, false, true]);
  assert.equal(check(orgOnly, { globalRolesOnly: true, combineGlobalRoles: true }), false);
  assert.equal(validateActorCanAccessKnowledgeWorkspace({ ...mixed, actorType: "system" }, ORG).ok, false);
});

test("capability projection preserves unknown classification and handoff messages distinguish outcomes", async () => {
  for (const dto of [null, {}, [], { internalKnowledgeWorkspace: false }, { internalKnowledgeWorkspace: "true" }]) assert.equal(projectOrganizationAccessCapabilities(dto), null);
  const result = await getOrganizationAccessCapabilities({ organizationId: ORG, actorContext: actor("client_admin") }, { env });
  assert.equal(projectOrganizationAccessCapabilities(result.data).internalKnowledgeWorkspace, false);
  assert.match(claimProposalHandoffOutcome({ status: "replayed" }).message, /replayed the existing/);
  assert.match(claimProposalHandoffOutcome({ status: "not_created", error_code: "authorization_denied", blocking_reason: "role_not_allowed" }).message, /authorization_denied: role_not_allowed/);
  assert.match(claimProposalHandoffOutcome(null).message, /could not be confirmed/);
});


test("persisted pending claim review remains discoverable without successful traceability, never invents review work", () => {
  const claimId = "10000000-0000-4000-8000-000000000004";
  const reviewQueueItemId = "10000000-0000-4000-8000-000000000005";
  const queue = { reviewQueueItemId, queueType: "claim_review", targetObjectType: "claim", targetObjectId: claimId, queueStatus: "open", reviewStatus: "needs_gk_review" };
  const claim = { claimId, claimReviewStatus: "needs_gk_review", reviewQueueItems: [queue] };
  assert.deepEqual(pendingClaimReviewWork([claim]), [{ claimId, reviewQueueItemId }]);
  assert.deepEqual(pendingClaimReviewWork([claim], [{ claimId }]), []);
  assert.deepEqual(pendingClaimReviewWork([{ ...claim, reviewQueueItems: [] }]), []);
  assert.deepEqual(pendingClaimReviewWork([{ ...claim, claimReviewStatus: "approved" }]), []);
  for (const change of [{ queueStatus: "resolved" }, { targetObjectId: OTHER }, { queueType: "evidence_review" }, { reviewStatus: "resolved" }]) {
    assert.deepEqual(pendingClaimReviewWork([{ ...claim, reviewQueueItems: [{ ...queue, ...change }] }]), []);
  }
});

test("an unavailable claim traceability states the server's reason: missing P2-04 gap state is a prerequisite, not stale state", () => {
  const missingGaps = { statusCode: 409, body: { ok: false, error: { code: "conflict_current_state_changed", message: "Current resource state changed." }, data: { traceability_conflict_reason: "gap_dimension_requires_missing_p204_state" } } };
  assert.match(traceabilityUnavailableMessage(missingGaps, { canGenerateGapFollowups: true }), /coverage gaps have not been generated yet.*Use Generate gap followups/);
  assert.match(traceabilityUnavailableMessage(missingGaps), /organization Get Kinder role must generate/);
  assert.doesNotMatch(traceabilityUnavailableMessage(missingGaps), /state changed/);
  const notCurrent = { statusCode: 409, body: { ok: false, error: { message: "Current resource state changed." }, data: { traceability_conflict_reason: "source_version_not_current" } } };
  assert.match(traceabilityUnavailableMessage(notCurrent), /not currently consistent \(source_version_not_current\)/);
  // No reason, or an unsafe one, keeps the server's message; nothing is invented.
  assert.equal(traceabilityUnavailableMessage({ statusCode: 403, body: { error: { message: "Actor is not authorized for this operation." } } }), "Actor is not authorized for this operation.");
  assert.equal(traceabilityUnavailableMessage({ statusCode: 409, body: { error: { message: "Current resource state changed." }, data: { traceability_conflict_reason: "<b>x</b>" } } }), "Current resource state changed.");
});

test("the GK sensitivity result line reports the P1-07 handoff the server returned; a 200 never hides an uncreated source candidate", () => {
  const recorded = (handoff, decision = "reviewed") => sensitivityDecisionResultText(projectSensitivityDecisionResult(
    { statusCode: 200, body: { ok: true, data: { current_decision: { decision_outcome: decision }, source_candidate_handoff: handoff } } }, decision));
  assert.match(recorded({ status: "created", candidate_status: "needs_gk_review" }), /^Review recorded\. This file is now a source candidate/);
  assert.match(recorded({ status: "replayed" }), /now a source candidate/);
  assert.equal(recorded({ status: "not_created", error_code: "authorization_denied" }),
    "Review recorded, but the source candidate was not created (authorization_denied). No source review item exists for this file yet.");
  for (const handoff of [null, { status: "not_applicable" }, { status: "surprise" }]) {
    assert.equal(recorded(handoff), "Review recorded. The source-candidate handoff status is not available.");
  }
  assert.equal(recorded({ status: "not_applicable" }, "needs_more_information"), "Marked as needing more information.");
  assert.equal(sensitivityDecisionResultText(projectSensitivityDecisionResult({ statusCode: 409 }, "reviewed")), "");
});

test("reporting-packet read capabilities project the packet services' own gk_admin/gk_reviewer combined-role contract", async () => {
  const { __grantResponsePacketServiceContract: grp } = await import("../Backend/kai/services/kaiGrantResponsePacketService.js");
  const { __boardReportingPacketServiceContract: board } = await import("../Backend/kai/services/kaiBoardReportingPacketService.js");
  assert.deepEqual([...grp.GENERATED_CONTENT_REVIEW_ALLOWED_ROLES].sort(), ["gk_admin", "gk_reviewer"]);
  assert.deepEqual([...board.GENERATED_CONTENT_REVIEW_ALLOWED_ROLES].sort(), ["gk_admin", "gk_reviewer"]);
  const expected = [
    ["organization gk_admin", actor("gk_admin"), true],
    ["organization gk_reviewer", actor("gk_reviewer"), true],
    ["global gk_reviewer + client_admin", actor("client_admin", ["gk_reviewer"]), true],
    ["organization gk_operator", actor("gk_operator"), false],
    ["global gk_operator + client_admin", actor("client_admin", ["gk_operator"]), false],
    ["client admin", actor("client_admin"), false],
    ["client reviewer", actor("client_reviewer"), false],
  ];
  for (const [label, actorContext, allowed] of expected) {
    const result = await getOrganizationAccessCapabilities({ organizationId: ORG, actorContext }, { env });
    assert.deepEqual([result.data.workflowOperations.readGrantResponsePacket, result.data.workflowOperations.readBoardReportingPacket], [allowed, allowed], label);
    // The flag is exactly the read's own predicate.
    for (const [contract, operation] of [[grp, grp.GET_GRANT_RESPONSE_PACKET_OPERATION], [board, board.GET_BOARD_REPORTING_PACKET_OPERATION]]) {
      assert.equal(validateActorCanPerformOperation(actorContext, operation, ORG, { allowedRoles: contract.GENERATED_CONTENT_REVIEW_ALLOWED_ROLES, combineGlobalRoles: true }).ok, allowed, label);
    }
  }
  const projected = projectOrganizationAccessCapabilities((await getOrganizationAccessCapabilities({ organizationId: ORG, actorContext: actor("gk_operator") }, { env })).data);
  assert.deepEqual([projected.workflowOperations.readGrantResponsePacket, projected.workflowOperations.readBoardReportingPacket], [false, false]);
  const missing = projectOrganizationAccessCapabilities({ internalKnowledgeWorkspace: true, intakeContribution: false, clientFollowupReview: false, projectManagement: false,
    improvementPlanManagement: false, organizationJoinReview: false, organizationAccessManagement: false, workflowOperations: {} });
  assert.deepEqual([missing.workflowOperations.readGrantResponsePacket, missing.workflowOperations.readBoardReportingPacket], [false, false], "an absent flag fails closed");
});
