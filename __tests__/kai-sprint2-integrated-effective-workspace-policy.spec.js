import test from "node:test";
import assert from "node:assert/strict";
import { validateActorCanAccessKnowledgeWorkspace, validateActorCanPerformOperation } from "../Backend/kai/auth/kaiAuthorizationService.js";
import { getOrganizationAccessCapabilities } from "../Backend/kai/services/kaiOrganizationAccessCapabilitiesService.js";
import { listClaimLibraryCandidates } from "../Backend/kai/services/kaiClaimLibraryService.js";
import { listOrganizationEvidenceLibrary } from "../Backend/kai/services/kaiEvidenceLibraryService.js";
import { listAuthorizedEngagements, __engagementContextServiceContract as project } from "../Backend/kai/services/kaiEngagementContextService.js";
import { authorizeSourcePromotionDecision } from "../Backend/kai/services/kaiSourcePromotionService.js";
import { projectOrganizationAccessCapabilities, claimProposalHandoffOutcome, pendingClaimReviewWork } from "../frontend/impactEvidenceLibraryLogic.js";

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
