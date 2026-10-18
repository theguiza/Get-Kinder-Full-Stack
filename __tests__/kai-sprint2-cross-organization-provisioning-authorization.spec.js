import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import accessAdministrationRouter, { __testables } from "../Backend/kai/routes/kaiAccessAdministrationApi.js";
import {
  viewEffectiveKaiAccess,
  manageOrganizationMembership,
  grantOrganizationRole,
  revokeOrganizationRole,
  manageGlobalKaiRole,
  getAccessAdministrationContext,
  resolveOrganizationRoleAdministration,
  onboardGkStaffMember,
  offboardGkStaffRole,
} from "../Backend/kai/services/kaiAccessAdministrationService.js";
import { resolveKaiActorContext } from "../Backend/kai/auth/kaiActorContext.js";
import { createProductionMetadataOnlyAuditForAccessAdministration } from "../Backend/kai/services/kaiMetadataOnlyAuditComposition.js";
import { getOrganizationAccessCapabilities, computeOrganizationOperationReadiness } from "../Backend/kai/services/kaiOrganizationAccessCapabilitiesService.js";
import { validateActorCanAccessKnowledgeWorkspace, validateActorCanPerformOperation, validateActorCanPerformSensitivityReview } from "../Backend/kai/auth/kaiAuthorizationService.js";
import {
  GLOBAL_ROLE_EXPLANATIONS,
  describeReadinessGap,
  projectTeamAccessAdministrationContext,
  projectTeamAccessGlobalAdministration,
  projectTeamAccessRoster,
  teamAccessGlobalRoleRequest,
  teamAccessHandoffNotice,
  describeStaffOnboardingError,
  projectTeamAccessStaffOnboardingRoles,
  staffOffboardingResultMessage,
  staffOnboardingResultMessage,
  staffOnboardingStatusText,
  teamAccessStaffOffboardingRequest,
  teamAccessStaffOnboardingByEmailRequest,
  teamAccessStaffOnboardingRequest,
} from "../frontend/teamAccess/teamAccessLogic.js";
import { getReviewCockpitCapabilities } from "../Backend/kai/services/kaiReviewCockpitService.js";
import { listAuthorizedOrganizations } from "../Backend/kai/services/kaiOrganizationContextService.js";
import { authorizeSourcePromotionDecision } from "../Backend/kai/services/kaiSourcePromotionService.js";
import { recordEvidenceReviewDecision } from "../Backend/kai/services/kaiHumanReviewService.js";
import { extractEvidenceFromSourceVersion } from "../Backend/kai/services/kaiEvidenceLineageService.js";
import { assessEvidenceCoverageForSourceVersion } from "../Backend/kai/services/kaiEvidenceCoverageAssessmentService.js";
import { proposeClaim } from "../Backend/kai/services/kaiClaimProposalService.js";
import { generateClaimGapFollowups } from "../Backend/kai/services/kaiClaimGapFollowupService.js";
import { createSourceCandidateStub } from "../Backend/kai/services/kaiSourceCandidateService.js";
import { createSensitivityReviewQueueItem } from "../Backend/kai/services/kaiReviewQueueService.js";
import { assessOrganizationRequirement } from "../Backend/kai/services/kaiRequirementAssessmentService.js";
import { listClaimLibraryCandidates } from "../Backend/kai/services/kaiClaimLibraryService.js";

/**
 * Reusable provisioning and effective-authorization conformance across three
 * organizations. One person may hold different authority in Organizations A,
 * B, and C at once (a global GK role, a stored organization role, a
 * binding-derived client_admin, nothing); each organization is decided on its
 * own. Real: the actor resolver, the shared validators, the capability reads,
 * the access-administration router and services, the audit metadata composer,
 * and each service's authorization before its repository. Only kai.* rows are
 * an in-memory store; the PostgreSQL runners prove the same writers and the
 * organization-scoped SQL.
 */

const ENV = { KAI_SPRINT2_ENABLED: "true" };
const NOW = "2026-10-16T00:00:00.000Z";
const BASE = "/api/kai/sprint2/access-administration";
const ORG_A = "00000000-0000-4000-8000-0000000000a2";
const ORG_B = "00000000-0000-4000-8000-0000000000b2";
const ORG_C = "00000000-0000-4000-8000-0000000000c2";
const ORGS = Object.freeze({ A: ORG_A, B: ORG_B, C: ORG_C });
// Organization B is bound to Get Kinder organization 7202; its Get Kinder
// administrators hold a derived, never-stored client_admin there.
const GK_ORG_B = 7202;
const ID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const USERS = Object.freeze({
  superuser: { user_id: ID(9001), legacy: 9001, email: "super@cross-org.synthetic.test" },
  delegatedAdmin: { user_id: ID(9002), legacy: 9002, email: "delegated@cross-org.synthetic.test" },
  clientAdminA: { user_id: ID(9003), legacy: 9003, email: "client-admin-a@cross-org.synthetic.test" },
  reviewerX: { user_id: ID(9004), legacy: 9004, email: "reviewer-x@cross-org.synthetic.test", gkAdminOf: [GK_ORG_B] },
  operator: { user_id: ID(9005), legacy: 9005, email: "operator@cross-org.synthetic.test" },
  dual: { user_id: ID(9006), legacy: 9006, email: "dual@cross-org.synthetic.test" },
  plain: { user_id: ID(9007), legacy: 9007, email: "plain@cross-org.synthetic.test" },
  newcomer: { user_id: ID(9008), legacy: 9008, email: "newcomer@cross-org.synthetic.test" },
});

const row = (organizationId, user, roleName, membershipStatus = "active") => ({
  organization_id: organizationId, user_id: user.user_id, role_name: roleName, membership_status: membershipStatus,
});

function createStore() {
  const state = {
    memberships: [
      row(ORG_A, USERS.delegatedAdmin, "gk_admin"),
      row(ORG_A, USERS.clientAdminA, "client_admin"),
      // Configuration 1: stored GK reviewer in A, derived client_admin in B, nothing in C.
      row(ORG_A, USERS.reviewerX, "gk_reviewer"),
      // Configuration 2: the global gk_operator, an organization operator in A, a client role in B.
      row(ORG_A, USERS.operator, "gk_operator"),
      row(ORG_B, USERS.operator, "client_contributor"),
      // Configuration 3: one account holding operator and reviewer capability.
      row(ORG_A, USERS.dual, "gk_operator"),
      row(ORG_A, USERS.dual, "gk_reviewer"),
      row(ORG_A, USERS.plain, "client_contributor"),
    ],
    globalRoles: {
      [USERS.delegatedAdmin.user_id]: ["gk_admin"],
      [USERS.reviewerX.user_id]: ["gk_reviewer"],
      [USERS.operator.user_id]: ["gk_operator"],
      [USERS.dual.user_id]: ["gk_operator", "gk_reviewer"],
    },
    // Get Kinder account columns by legacy id; every synthetic account is
    // verified and unsuspended unless a test overrides it here.
    accounts: {},
    auditRows: [],
    writes: [],
  };
  const accountOf = (user) => (user
    ? { id: user.legacy, email: user.email, email_verified: true, is_suspended: false, ...(state.accounts[user.legacy] || {}) }
    : null);
  const userByLegacy = (legacy) => Object.values(USERS).find((user) => user.legacy === legacy) || null;
  const userById = (userId) => Object.values(USERS).find((user) => user.user_id === userId) || null;
  const rowsFor = (organizationId, userId) => state.memberships.filter((entry) => entry.organization_id === organizationId && entry.user_id === userId);
  const kaiUserOf = (user) => (user
    ? { user_id: user.user_id, legacy_identity_source: "public.userdata", legacy_public_userdata_id: user.legacy, email: user.email, status: "active" }
    : null);
  const derivedAdminsOf = (organizationId) => (organizationId === ORG_B
    ? Object.values(USERS).filter((user) => (user.gkAdminOf || []).includes(GK_ORG_B))
    : []);

  const dependencies = {
    env: ENV,
    runInTransaction: async (callback) => callback({ query: async () => ({ rows: [] }) }),
    listOrganizationMembershipRowsForOrganization: async (organizationId) => state.memberships
      .filter((entry) => entry.organization_id === organizationId)
      .map((entry) => ({ ...entry, legacy_identity_source: "public.userdata", legacy_public_userdata_id: userById(entry.user_id).legacy, email: userById(entry.user_id).email, kai_user_status: "active" })),
    listOrganizationMembershipRowsForUserInOrganization: async (organizationId, userId) => rowsFor(organizationId, userId).map((entry) => ({ ...entry })),
    countActiveStoredClientAdminMemberships: async (organizationId, _tx, { excludingUserId = null } = {}) => new Set(state.memberships
      .filter((entry) => entry.organization_id === organizationId && entry.role_name === "client_admin" && entry.membership_status === "active" && entry.user_id !== excludingUserId)
      .map((entry) => entry.user_id)).size,
    hasActiveDerivedClientAdminForOrganization: async (organizationId) => derivedAdminsOf(organizationId).length > 0,
    getActiveGkOrganizationIdForKaiOrganization: async (organizationId) => (organizationId === ORG_B ? GK_ORG_B : null),
    listActiveGkOrganizationAdminLegacyUserIds: async (gkOrganizationId) => (gkOrganizationId === GK_ORG_B ? derivedAdminsOf(ORG_B).map((user) => user.legacy) : []),
    findKaiUserByLegacyPublicUserdataId: async (legacy) => kaiUserOf(userByLegacy(legacy)),
    findOrCreateKaiUserByLegacyPublicUserdataId: async ({ legacyPublicUserdataId }) => kaiUserOf(userByLegacy(legacyPublicUserdataId)),
    getStaffAccountById: async (legacy) => accountOf(userByLegacy(legacy)),
    listStaffAccountsByExactEmail: async (email) => Object.values(USERS).filter((user) => user.email === email).map(accountOf),
    // Every organization the person has stored access to, and the derived
    // client_admin access sign-in derives from an active binding.
    listOrganizationMembershipsForUser: async (userId) => state.memberships.filter((entry) => entry.user_id === userId).map((entry) => ({ ...entry })),
    resolveEffectiveClientOrganizationMembershipsForLegacyUser: async (legacy) => ((userByLegacy(legacy)?.gkAdminOf || []).includes(GK_ORG_B)
      ? [{ organization_id: ORG_B, role_name: "client_admin", membership_status: "active", source: "gk_organization_binding", gk_organization_id: GK_ORG_B }]
      : []),
    listKaiRolesForUser: async (userId) => [...(state.globalRoles[userId] || [])],
    upsertOrganizationMembershipRoleStatus: async ({ organizationId, userId, roleName, membershipStatus, previousRoleName = null }) => {
      const existing = rowsFor(organizationId, userId);
      if (previousRoleName === null && existing.length > 1) return { conflict: true, mutated: false };
      const target = previousRoleName === null ? existing[0] : existing.find((entry) => entry.role_name === previousRoleName);
      if (previousRoleName !== null && !target) return { conflict: true, mutated: false };
      const previousRow = target ? { ...target } : null;
      if (previousRow && previousRow.role_name === roleName && previousRow.membership_status === membershipStatus) return { previousRow, newRow: previousRow, mutated: false, replay: true };
      state.writes.push({ kind: "upsert", organizationId, userId, roleName, membershipStatus });
      if (target) Object.assign(target, { role_name: roleName, membership_status: membershipStatus });
      else state.memberships.push({ organization_id: organizationId, user_id: userId, role_name: roleName, membership_status: membershipStatus });
      return { previousRow, newRow: { organization_id: organizationId, user_id: userId, role_name: roleName, membership_status: membershipStatus }, mutated: true };
    },
    grantOrganizationMembershipRole: async ({ organizationId, userId, roleName }) => {
      const existing = rowsFor(organizationId, userId);
      const hadActiveAccess = existing.some((entry) => entry.membership_status === "active");
      const target = existing.find((entry) => entry.role_name === roleName);
      const previousRow = target ? { ...target } : null;
      if (target?.membership_status === "active") return { previousRow, newRow: previousRow, mutated: false, replay: true, hadActiveAccess };
      state.writes.push({ kind: "grant", organizationId, userId, roleName });
      if (target) target.membership_status = "active";
      else state.memberships.push({ organization_id: organizationId, user_id: userId, role_name: roleName, membership_status: "active" });
      return { previousRow, newRow: { organization_id: organizationId, user_id: userId, role_name: roleName, membership_status: "active" }, mutated: true, replay: false, hadActiveAccess };
    },
    revokeOrganizationMembershipRole: async ({ organizationId, userId, roleName }) => {
      const existing = rowsFor(organizationId, userId);
      const target = existing.find((entry) => entry.role_name === roleName);
      const remainingActiveRoleNames = existing.filter((entry) => entry !== target && entry.membership_status === "active").map((entry) => entry.role_name);
      if (!target) return { notFound: true, mutated: false, remainingActiveRoleNames };
      const previousRow = { ...target };
      if (target.membership_status !== "active") return { previousRow, newRow: previousRow, mutated: false, replay: true, remainingActiveRoleNames };
      state.writes.push({ kind: "revoke", organizationId, userId, roleName });
      target.membership_status = "inactive";
      return { previousRow, newRow: { ...target }, mutated: true, replay: false, remainingActiveRoleNames };
    },
    listOrganizationsForPlatformAdministration: async () => [
      { organization_id: ORG_A, name: "Synthetic A" }, { organization_id: ORG_B, name: "Synthetic B" }, { organization_id: ORG_C, name: "Synthetic C" },
    ],
    listGlobalRoleAssignmentRows: async (userId) => (state.globalRoles[userId] || []).map((roleName) => ({ user_id: userId, role_name: roleName })),
    assignGlobalRole: async ({ userId, roleName }) => {
      const roles = (state.globalRoles[userId] ||= []);
      if (roles.includes(roleName)) return { ok: true, mutated: false, replay: true };
      state.writes.push({ kind: "global_assign", userId, roleName });
      roles.push(roleName);
      return { ok: true, mutated: true, replay: false };
    },
    revokeGlobalRole: async ({ userId, roleName }) => {
      const roles = state.globalRoles[userId] || [];
      if (!roles.includes(roleName)) return { ok: true, mutated: false, replay: true };
      state.writes.push({ kind: "global_revoke", userId, roleName });
      state.globalRoles[userId] = roles.filter((role) => role !== roleName);
      return { ok: true, mutated: true, replay: false };
    },
    // The real metadata-only audit composer; only the final insert is captured.
    createProductionMetadataOnlyAuditForAccessAdministration: (args) => createProductionMetadataOnlyAuditForAccessAdministration({
      ...args,
      insertAuditEvent: async (metadata) => {
        state.auditRows.push(metadata);
        return { ok: true };
      },
    }),
  };
  return { state, dependencies };
}

// The real resolveKaiActorContext for each request: stored memberships,
// global roles, and the derived client_admin from an active binding.
async function resolveActor(store, user, { superuser = false } = {}) {
  const resolved = await resolveKaiActorContext({ id: user.legacy, email: user.email }, {
    findOrCreateKaiUserByLegacyPublicUserdataId: async () => ({
      user_id: user.user_id, legacy_identity_source: "public.userdata", legacy_public_userdata_id: user.legacy, status: "active", email: user.email,
    }),
    listKaiRolesForUser: async (userId) => [...(store.state.globalRoles[userId] || [])],
    listOrganizationMembershipsForUser: async (userId) => store.state.memberships.filter((entry) => entry.user_id === userId).map((entry) => ({ ...entry })),
    resolveOrgScopeForUserId: async () => ({ memberships: (user.gkAdminOf || []).map((orgId) => ({ orgId, role: "admin", is_active: true })) }),
    listActiveGkOrganizationBindingsForGkOrganizationIds: async () => [{ gk_organization_id: GK_ORG_B, kai_organization_id: ORG_B, status: "active" }],
  });
  assert.equal(resolved.ok, true, JSON.stringify(resolved));
  const actorContext = { ...resolved.actorContext };
  if (superuser) Object.assign(actorContext, { platformSuperuser: true, platformSuperuserAuthority: "get_kinder_site_admin" });
  return actorContext;
}

async function withRouter(store, actorContext, work) {
  const { dependencies } = store;
  const restore = __testables.setAccessAdministrationServiceForTest({
    viewEffectiveKaiAccess: (input) => viewEffectiveKaiAccess(input, dependencies),
    manageOrganizationMembership: (input) => manageOrganizationMembership(input, dependencies),
    grantOrganizationRole: (input) => grantOrganizationRole(input, dependencies),
    revokeOrganizationRole: (input) => revokeOrganizationRole(input, dependencies),
    manageGlobalKaiRole: (input) => manageGlobalKaiRole(input, dependencies),
    getAccessAdministrationContext: (input) => getAccessAdministrationContext(input, dependencies),
    onboardGkStaffMember: (input) => onboardGkStaffMember(input, dependencies),
    offboardGkStaffRole: (input) => offboardGkStaffRole(input, dependencies),
  });
  const previous = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "true";
  const app = express();
  app.use(express.json());
  app.use(BASE, (req, _res, next) => {
    req.isAuthenticated = () => true;
    req.user = { id: actorContext.legacyPublicUserdataId };
    req.kaiSprint2ActorContext = actorContext;
    next();
  });
  app.use(BASE, accessAdministrationRouter);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const call = async (method, path, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${BASE}${path}`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const parsed = await response.json().catch(() => null);
    return { status: response.status, code: parsed?.error?.code ?? null, reason: parsed?.blockers?.[0]?.blocking_reason ?? null, body: parsed };
  };
  try {
    return await work(call);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    restore();
    if (previous === undefined) delete process.env.KAI_SPRINT2_ENABLED;
    else process.env.KAI_SPRINT2_ENABLED = previous;
  }
}

const grant = (organizationId, user) => [`/organizations/${organizationId}/memberships/${user.legacy}/roles`];
const revoke = (organizationId, user, roleName) => `/organizations/${organizationId}/memberships/${user.legacy}/roles/${roleName}/revoke`;
const put = (organizationId, user) => `/organizations/${organizationId}/memberships/${user.legacy}`;
const globalRole = (user) => `/global-roles/${user.legacy}`;

/**
 * A repository that records every call and returns a generic success, so a
 * service that authorizes reaches it exactly once and a refusal never does.
 */
function probe(methodName, result = { ok: true, data: { probe: true } }) {
  const calls = [];
  return { calls, repository: { async [methodName](input) { calls.push(input); return result; } } };
}

const SOURCE_VERSION = ID(7001);
const EVIDENCE_ITEM = ID(7002);
const QUEUE_ITEM = ID(7003);
const CLAIM = ID(7004);
const PROFILE = ID(7005);
const REQUIREMENT = ID(7006);

// Every governed operation, called through its real service with a probing
// repository. `true` means the service authorized and forwarded exactly the
// requested organization to its (organization-scoped) repository.
const OPERATIONS = Object.freeze({
  recordEvidenceReview: async (actorContext, organizationId) => {
    const p = probe("recordEvidenceReviewDecision");
    const result = await recordEvidenceReviewDecision(
      { organizationId, evidenceItemId: EVIDENCE_ITEM, reviewQueueItemId: QUEUE_ITEM, expectedUpdatedAt: NOW, decision: "supported", actorContext, now: NOW },
      { env: ENV, humanReviewRepository: p.repository },
    );
    return { result, calls: p.calls };
  },
  extractEvidence: async (actorContext, organizationId) => {
    const p = probe("extractEvidenceFromSourceVersion");
    const result = await extractEvidenceFromSourceVersion({ organizationId, sourceVersionId: SOURCE_VERSION, actorContext, now: NOW }, { env: ENV, evidenceLineageRepository: p.repository });
    return { result, calls: p.calls };
  },
  assessEvidenceCoverage: async (actorContext, organizationId) => {
    const p = probe("readEvidenceCoverageAssessmentFacts");
    const result = await assessEvidenceCoverageForSourceVersion({ organizationId, sourceVersionId: SOURCE_VERSION, actorContext }, { env: ENV, evidenceCoverageAssessmentRepository: p.repository });
    return { result, calls: p.calls };
  },
  proposeClaim: async (actorContext, organizationId) => {
    const p = probe("proposeClaim");
    const result = await proposeClaim({ organizationId, evidenceItemId: EVIDENCE_ITEM, actorContext, now: NOW }, { env: ENV, claimProposalRepository: p.repository });
    return { result, calls: p.calls };
  },
  generateClaimGapFollowups: async (actorContext, organizationId) => {
    const p = probe("generateClaimGapsAndFollowups");
    const result = await generateClaimGapFollowups({ organizationId, claimId: CLAIM, actorContext, now: NOW }, { env: ENV, claimGapFollowupRepository: p.repository });
    return { result, calls: p.calls };
  },
  createSourceCandidate: async (actorContext, organizationId) => {
    const p = probe("createSourceCandidateStub");
    const result = await createSourceCandidateStub({ organizationId, intakeSensitivityProfileId: PROFILE, actorContext, now: NOW }, { env: ENV, sourceCandidateRepository: p.repository });
    return { result, calls: p.calls };
  },
  createSensitivityReviewItem: async (actorContext, organizationId) => {
    const p = probe("createSensitivityReviewQueueItem");
    const result = await createSensitivityReviewQueueItem({ organizationId, intakeSensitivityProfileId: PROFILE, actorContext, now: NOW }, { env: ENV, reviewQueueRepository: p.repository });
    return { result, calls: p.calls };
  },
  readClaimLibrary: async (actorContext, organizationId) => {
    const calls = [];
    const result = await listClaimLibraryCandidates({ organizationId, actorContext }, {
      env: ENV,
      listClaimLibraryReviewCandidates: async (scopedOrganizationId) => { calls.push({ organizationId: scopedOrganizationId }); return []; },
    });
    return { result, calls };
  },
});

// The access, capability, and promotion surfaces one organization presents
// to one actor. Each value is a server decision; nothing is inferred.
async function surfaceFor(actorContext, organizationId) {
  const listed = (await listAuthorizedOrganizations({ actorContext }, { env: ENV })).data.items.map((item) => item.organization_id);
  const capabilities = await getOrganizationAccessCapabilities({ organizationId, actorContext }, { env: ENV });
  const cockpit = await getReviewCockpitCapabilities({ organizationId, actorContext }, { env: ENV });
  const data = capabilities.ok ? capabilities.data : null;
  return {
    listed: listed.includes(organizationId),
    capabilities: capabilities.ok ? "ok" : `${capabilities.error.code}/${capabilities.blockers?.[0]?.blocking_reason}`,
    gkWorkspace: data?.internalKnowledgeWorkspace === true,
    recordEvidenceReview: data?.workflowOperations.recordEvidenceReview === true,
    recordClaimReview: data?.workflowOperations.recordClaimReview === true,
    extractEvidence: data?.workflowOperations.extractEvidence === true,
    proposeClaim: data?.workflowOperations.proposeClaim === true,
    acceptCoverageLimitation: data?.workflowOperations.acceptCoverageLimitation === true,
    projectManagement: data?.projectManagement === true,
    teamAccess: data?.organizationAccessManagement === true,
    sourceReview: cockpit.data.can_review_source_candidates,
    sensitivityReview: cockpit.data.can_manage_sensitivity_review,
    promoteSource: authorizeSourcePromotionDecision(actorContext, organizationId).ok,
  };
}

// Runs every operation and returns which ones authorized. A refusal must be
// the shared validator's own structured result, reach no repository, and
// never be mislabeled as a tenant-boundary violation.
async function enforcementFor(actorContext, organizationId) {
  const authorized = {};
  for (const [name, run] of Object.entries(OPERATIONS)) {
    const { result, calls } = await run(actorContext, organizationId);
    if (calls.length > 0) {
      assert.equal(calls.length, 1, name);
      assert.equal(calls[0].organizationId ?? calls[0].identity?.organizationId, organizationId, `${name}: the repository is scoped to the requested organization`);
      authorized[name] = true;
      continue;
    }
    assert.equal(result.ok, false, name);
    assert.equal(result.error.code, "authorization_denied", `${name}: ${JSON.stringify(result)}`);
    assert.ok(["role_not_allowed", "missing_active_organization_membership"].includes(result.blockers?.[0]?.blocking_reason), `${name}: ${JSON.stringify(result.blockers)}`);
    authorized[name] = false;
  }
  return authorized;
}

const NOTHING = Object.freeze({
  listed: false, capabilities: "authorization_denied/missing_active_organization_membership", gkWorkspace: false,
  recordEvidenceReview: false, recordClaimReview: false, extractEvidence: false, proposeClaim: false, acceptCoverageLimitation: false,
  projectManagement: false, teamAccess: false, sourceReview: false, sensitivityReview: false, promoteSource: false,
});
const NO_ENFORCED = Object.freeze(Object.fromEntries(Object.keys(OPERATIONS).map((name) => [name, false])));

// --------------------------------------------------------------------------
// Configurations 1-3: per-organization effective authority
// --------------------------------------------------------------------------

test("configuration 1: global gk_reviewer + stored gk_reviewer in A + binding-derived client_admin in B + nothing in C, decided per organization", async () => {
  const store = createStore();
  const actor = await resolveActor(store, USERS.reviewerX);

  assert.deepEqual(await surfaceFor(actor, ORG_A), {
    listed: true, capabilities: "ok", gkWorkspace: true,
    recordEvidenceReview: true, recordClaimReview: true, extractEvidence: true, proposeClaim: true, acceptCoverageLimitation: true,
    projectManagement: false, teamAccess: false, sourceReview: true, sensitivityReview: true, promoteSource: true,
  });
  assert.deepEqual(await enforcementFor(actor, ORG_A), {
    recordEvidenceReview: true, extractEvidence: true, assessEvidenceCoverage: true, proposeClaim: true, generateClaimGapFollowups: true,
    createSourceCandidate: true, createSensitivityReviewItem: true, readClaimLibrary: true,
  });

  // B: the global role meets the derived client_admin's active access (the
  // established J3 mixed-role rule). It never becomes stored GK authority:
  // no P1-08 promotion and no direct organization-GK operation. The derived
  // client_admin itself admits P2-01 extraction, P2-03 proposal, and P2-04
  // gap follow-ups (owner decision 2026-10-18); P2-02 coverage stays GK-only.
  // P1-08 promotion is admitted through the binding-derived administrator
  // half (second owner decision 2026-10-18), never through the global role.
  assert.deepEqual(await surfaceFor(actor, ORG_B), {
    listed: true, capabilities: "ok", gkWorkspace: true,
    recordEvidenceReview: true, recordClaimReview: true, extractEvidence: true, proposeClaim: true, acceptCoverageLimitation: false,
    projectManagement: true, teamAccess: true, sourceReview: true, sensitivityReview: true, promoteSource: true,
  });
  assert.equal(authorizeSourcePromotionDecision(actor, ORG_B).organizationAdminAuthorized, true);
  assert.deepEqual(await enforcementFor(actor, ORG_B), {
    recordEvidenceReview: true, extractEvidence: true, assessEvidenceCoverage: false, proposeClaim: true, generateClaimGapFollowups: true,
    createSourceCandidate: true, createSensitivityReviewItem: true, readClaimLibrary: true,
  });

  // C: a global GK role is never a bypass of the organization boundary.
  assert.deepEqual(await surfaceFor(actor, ORG_C), NOTHING);
  assert.deepEqual(await enforcementFor(actor, ORG_C), NO_ENFORCED);
});

test("configuration 2: global gk_operator with an organization operator in A and a client role in B has no reviewer authority anywhere", async () => {
  const store = createStore();
  const actor = await resolveActor(store, USERS.operator);
  assert.deepEqual(await surfaceFor(actor, ORG_A), {
    listed: true, capabilities: "ok", gkWorkspace: true,
    recordEvidenceReview: false, recordClaimReview: false, extractEvidence: true, proposeClaim: true, acceptCoverageLimitation: false,
    projectManagement: true, teamAccess: false, sourceReview: true, sensitivityReview: true, promoteSource: true,
  });
  assert.deepEqual(await enforcementFor(actor, ORG_A), {
    recordEvidenceReview: false, extractEvidence: true, assessEvidenceCoverage: true, proposeClaim: true, generateClaimGapFollowups: true,
    createSourceCandidate: true, createSensitivityReviewItem: true, readClaimLibrary: true,
  });
  assert.deepEqual(await surfaceFor(actor, ORG_B), {
    listed: true, capabilities: "ok", gkWorkspace: true,
    recordEvidenceReview: false, recordClaimReview: false, extractEvidence: false, proposeClaim: false, acceptCoverageLimitation: false,
    projectManagement: false, teamAccess: false, sourceReview: true, sensitivityReview: true, promoteSource: false,
  });
  assert.deepEqual(await enforcementFor(actor, ORG_B), {
    recordEvidenceReview: false, extractEvidence: false, assessEvidenceCoverage: false, proposeClaim: false, generateClaimGapFollowups: false,
    createSourceCandidate: true, createSensitivityReviewItem: true, readClaimLibrary: true,
  });
  assert.deepEqual(await surfaceFor(actor, ORG_C), NOTHING);
  assert.deepEqual(await enforcementFor(actor, ORG_C), NO_ENFORCED);
});

test("configuration 3: one account holding operator and reviewer capability has both in A only, and its review is attributed to the exact organization role", async () => {
  const store = createStore();
  const actor = await resolveActor(store, USERS.dual);
  assert.deepEqual(await surfaceFor(actor, ORG_A), {
    listed: true, capabilities: "ok", gkWorkspace: true,
    recordEvidenceReview: true, recordClaimReview: true, extractEvidence: true, proposeClaim: true, acceptCoverageLimitation: true,
    projectManagement: true, teamAccess: false, sourceReview: true, sensitivityReview: true, promoteSource: true,
  });
  const review = await OPERATIONS.recordEvidenceReview(actor, ORG_A);
  assert.equal(review.calls[0].actorRole, "gk_reviewer");
  for (const organizationId of [ORG_B, ORG_C]) {
    assert.deepEqual(await surfaceFor(actor, organizationId), NOTHING);
    assert.deepEqual(await enforcementFor(actor, organizationId), NO_ENFORCED);
  }
});

test("capability readback agrees with service enforcement for every configured actor in every organization", async () => {
  const store = createStore();
  for (const user of [USERS.reviewerX, USERS.operator, USERS.dual, USERS.delegatedAdmin, USERS.clientAdminA, USERS.plain, USERS.newcomer]) {
    const actor = await resolveActor(store, user);
    for (const [label, organizationId] of Object.entries(ORGS)) {
      const surface = await surfaceFor(actor, organizationId);
      const enforced = await enforcementFor(actor, organizationId);
      const where = `${user.email} in ${label}`;
      assert.equal(surface.recordEvidenceReview, enforced.recordEvidenceReview, where);
      assert.equal(surface.extractEvidence, enforced.extractEvidence, where);
      assert.equal(surface.proposeClaim, enforced.proposeClaim, where);
      const capabilities = await getOrganizationAccessCapabilities({ organizationId, actorContext: actor }, { env: ENV });
      assert.equal(capabilities.ok && capabilities.data.workflowOperations.assessEvidenceCoverage === true, enforced.assessEvidenceCoverage, where);
      // The Claim Library admits the GK workspace and the organization's
      // own client_admin (who also holds extraction), and no one else.
      assert.equal(surface.gkWorkspace || surface.extractEvidence, enforced.readClaimLibrary, where);
    }
  }
});

test("requirement assessment records the role that authorized it in the exact organization, never one held elsewhere, inactive, or global", async () => {
  // Authorized by an active organization gk_admin in A; also a gk_reviewer
  // somewhere that does not authorize this operation in A.
  const variants = [
    ["gk_reviewer in another organization", [row(ORG_B, USERS.delegatedAdmin, "gk_reviewer")], []],
    ["inactive gk_reviewer in the same organization", [row(ORG_A, USERS.delegatedAdmin, "gk_reviewer", "inactive")], []],
    ["global gk_reviewer", [], ["gk_reviewer"]],
  ];
  for (const [label, extraMemberships, globalRoles] of variants) {
    const actorContext = {
      actorType: "human", actorUserId: USERS.delegatedAdmin.user_id, kaiUserStatus: "active", kaiRoles: globalRoles,
      organizationMemberships: [row(ORG_A, USERS.delegatedAdmin, "gk_admin"), ...extraMemberships],
    };
    const p = probe("assessOrganizationRequirement");
    const result = await assessOrganizationRequirement(
      { organizationId: ORG_A, requirementId: REQUIREMENT, actorContext, now: NOW },
      { env: ENV, requirementAssessmentRepository: p.repository, metadataOnlyAudit: { prepareMetadataOnlyAudit: () => ({ ok: true }) } },
    );
    assert.equal(result.ok, true, label);
    assert.equal(p.calls[0].actorRole, "gk_admin", label);
  }
  // The role recorded for an active organization gk_reviewer is that role.
  const reviewer = { actorType: "human", actorUserId: USERS.reviewerX.user_id, kaiRoles: [], organizationMemberships: [row(ORG_A, USERS.reviewerX, "gk_reviewer")] };
  const p = probe("assessOrganizationRequirement");
  await assessOrganizationRequirement({ organizationId: ORG_A, requirementId: REQUIREMENT, actorContext: reviewer, now: NOW }, { env: ENV, requirementAssessmentRepository: p.repository, metadataOnlyAudit: {} });
  assert.equal(p.calls[0].actorRole, "gk_reviewer");
});

// --------------------------------------------------------------------------
// Configuration 4 and the governed provisioning lifecycle
// --------------------------------------------------------------------------

test("lifecycle: initiation, assignment, activation on the next request, targeted and global revocation, and attributable metadata-only audit", async () => {
  const store = createStore();
  const superuser = await resolveActor(store, USERS.superuser, { superuser: true });
  const delegated = await resolveActor(store, USERS.delegatedAdmin);
  const next = () => resolveActor(store, USERS.newcomer);

  // Before any grant the newcomer is authorized for nothing anywhere.
  for (const organizationId of Object.values(ORGS)) assert.deepEqual(await enforcementFor(await next(), organizationId), NO_ENFORCED);

  // Initiation: only the platform superuser grants a global role. A global
  // role alone admits no organization.
  await withRouter(store, superuser, async (call) => {
    const assigned = await call("PUT", globalRole(USERS.newcomer), { role_name: "gk_reviewer", action: "assign" });
    assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
  });
  for (const organizationId of Object.values(ORGS)) assert.deepEqual(await enforcementFor(await next(), organizationId), NO_ENFORCED);

  // Assignment: the delegated GK administrator adds organization gk_operator
  // in A only; it never reaches B or C.
  await withRouter(store, delegated, async (call) => {
    const granted = await call("POST", ...grant(ORG_A, USERS.newcomer), { role_name: "gk_operator" });
    assert.equal(granted.status, 200, JSON.stringify(granted.body));
    assert.equal(granted.body.data.organization_access_admitted, true);
  });
  assert.deepEqual(
    store.state.memberships.filter((entry) => entry.user_id === USERS.newcomer.user_id),
    [row(ORG_A, USERS.newcomer, "gk_operator")],
  );

  // Activation on the next request: the global reviewer meets active access
  // in A; B and C stay closed.
  let actor = await next();
  assert.deepEqual(await enforcementFor(actor, ORG_A), {
    recordEvidenceReview: true, extractEvidence: true, assessEvidenceCoverage: true, proposeClaim: true, generateClaimGapFollowups: true,
    createSourceCandidate: true, createSensitivityReviewItem: true, readClaimLibrary: true,
  });
  assert.equal((await surfaceFor(actor, ORG_A)).promoteSource, true);
  for (const organizationId of [ORG_B, ORG_C]) assert.deepEqual(await enforcementFor(actor, organizationId), NO_ENFORCED);

  // Additive second grant (superuser, organization gk_reviewer), then
  // targeted revocation of gk_operator by the delegated administrator:
  // only that assignment ends.
  await withRouter(store, superuser, async (call) => {
    assert.equal((await call("POST", ...grant(ORG_A, USERS.newcomer), { role_name: "gk_reviewer" })).status, 200);
  });
  await withRouter(store, delegated, async (call) => {
    const revoked = await call("POST", revoke(ORG_A, USERS.newcomer, "gk_operator"));
    assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
    assert.deepEqual(revoked.body.data.remaining_active_role_names, ["gk_reviewer"]);
  });
  actor = await next();
  assert.equal((await surfaceFor(actor, ORG_A)).promoteSource, true, "the organization gk_reviewer still satisfies P1-08");
  assert.equal((await enforcementFor(actor, ORG_A)).recordEvidenceReview, true);

  // Revoking the organization gk_reviewer leaves no active access in A, so
  // the retained global role authorizes nothing on the next request.
  await withRouter(store, superuser, async (call) => {
    assert.equal((await call("POST", revoke(ORG_A, USERS.newcomer, "gk_reviewer"))).status, 200);
  });
  actor = await next();
  assert.deepEqual(actor.kaiRoles, ["gk_reviewer"]);
  assert.deepEqual(await enforcementFor(actor, ORG_A), NO_ENFORCED);
  assert.equal((await surfaceFor(actor, ORG_A)).capabilities, "authorization_denied/missing_active_organization_membership");

  // Restoring organization access with the global role revoked: only the
  // stored role remains effective.
  await withRouter(store, superuser, async (call) => {
    assert.equal((await call("POST", ...grant(ORG_A, USERS.newcomer), { role_name: "client_contributor" })).status, 200);
    assert.equal((await call("PUT", globalRole(USERS.newcomer), { role_name: "gk_reviewer", action: "revoke" })).status, 200);
  });
  actor = await next();
  assert.deepEqual(actor.kaiRoles, []);
  assert.deepEqual(await enforcementFor(actor, ORG_A), NO_ENFORCED);
  assert.equal((await surfaceFor(actor, ORG_A)).gkWorkspace, false);

  // Audit: one row per effective change, attributable to the granting actor
  // with the authority it used, and free of email, names, and legacy ids.
  const audits = store.state.auditRows.map((entry) => [entry.operation, entry.actor_user_id, entry.target_user_id, entry.organization_id, entry.role_name, entry.authority_source]);
  assert.deepEqual(audits, [
    ["global_kai_role_assigned", USERS.superuser.user_id, USERS.newcomer.user_id, null, "gk_reviewer", "platform_superuser"],
    ["organization_role_granted_access_admitted", USERS.delegatedAdmin.user_id, USERS.newcomer.user_id, ORG_A, "gk_operator", "delegated_gk_admin"],
    ["organization_role_granted", USERS.superuser.user_id, USERS.newcomer.user_id, ORG_A, "gk_reviewer", "platform_superuser"],
    ["organization_role_revoked", USERS.delegatedAdmin.user_id, USERS.newcomer.user_id, ORG_A, "gk_operator", "delegated_gk_admin"],
    ["organization_role_revoked", USERS.superuser.user_id, USERS.newcomer.user_id, ORG_A, "gk_reviewer", "platform_superuser"],
    ["organization_role_granted_access_admitted", USERS.superuser.user_id, USERS.newcomer.user_id, ORG_A, "client_contributor", "platform_superuser"],
    ["global_kai_role_revoked", USERS.superuser.user_id, USERS.newcomer.user_id, null, "gk_reviewer", "platform_superuser"],
  ]);
  for (const entry of store.state.auditRows) {
    const serialized = JSON.stringify(entry);
    assert.doesNotMatch(serialized, /@|synthetic\.test|email|firstname|lastname|legacy_public_userdata_id/);
    const legacyIds = new Set(Object.values(USERS).flatMap((user) => [user.legacy, String(user.legacy)]));
    assert.equal(Object.values(entry).some((value) => legacyIds.has(value)), false, serialized);
    assert.equal(entry.metadata_only, true);
    assert.equal(entry.contains_client_pii, false);
    assert.equal(entry.contains_storage_credentials, false);
  }
});

test("configuration 4: denied grants by the delegated administrator, client administrator, ordinary user, and self-elevation are structured, write nothing, and audit nothing", async () => {
  const store = createStore();
  const delegated = await resolveActor(store, USERS.delegatedAdmin);
  const clientAdmin = await resolveActor(store, USERS.clientAdminA);
  const plain = await resolveActor(store, USERS.plain);
  const reviewerX = await resolveActor(store, USERS.reviewerX);
  const attempts = [
    // Delegated GK administrator: only gk_operator/gk_reviewer, only in A.
    [delegated, "POST", grant(ORG_A, USERS.newcomer)[0], { role_name: "gk_admin" }, 403, "organization_role_not_administrable"],
    [delegated, "POST", grant(ORG_A, USERS.newcomer)[0], { role_name: "client_reviewer" }, 403, "organization_role_not_administrable"],
    [delegated, "PUT", put(ORG_A, USERS.plain), { role_name: "gk_operator", membership_status: "active" }, 403, "organization_role_not_administrable"],
    [delegated, "POST", grant(ORG_B, USERS.newcomer)[0], { role_name: "gk_operator" }, 403, "missing_active_organization_membership"],
    [delegated, "POST", grant(ORG_C, USERS.newcomer)[0], { role_name: "gk_reviewer" }, 403, "missing_active_organization_membership"],
    [delegated, "PUT", globalRole(USERS.newcomer), { role_name: "gk_reviewer", action: "assign" }, 403, "platform_superuser_required"],
    [delegated, "POST", grant(ORG_A, USERS.delegatedAdmin)[0], { role_name: "gk_reviewer" }, 403, "self_role_elevation_not_allowed"],
    // Client administrator: client roles only; the PUT and the additive POST
    // give the same structured refusal for a Get Kinder role.
    [clientAdmin, "POST", grant(ORG_A, USERS.newcomer)[0], { role_name: "gk_reviewer" }, 403, "non_client_membership_not_client_managed"],
    [clientAdmin, "PUT", put(ORG_A, USERS.newcomer), { role_name: "gk_reviewer", membership_status: "active" }, 403, "non_client_membership_not_client_managed"],
    [clientAdmin, "PUT", put(ORG_A, USERS.newcomer), { role_name: "gk_operator", membership_status: "active" }, 403, "non_client_membership_not_client_managed"],
    [clientAdmin, "PUT", globalRole(USERS.newcomer), { role_name: "gk_reviewer", action: "assign" }, 403, "platform_superuser_required"],
    [clientAdmin, "POST", grant(ORG_B, USERS.newcomer)[0], { role_name: "client_reviewer" }, 403, "missing_active_organization_membership"],
    // A derived client administrator of B manages client roles in B only, never its own.
    [reviewerX, "POST", grant(ORG_B, USERS.newcomer)[0], { role_name: "gk_reviewer" }, 403, "non_client_membership_not_client_managed"],
    [reviewerX, "POST", grant(ORG_B, USERS.reviewerX)[0], { role_name: "client_reviewer" }, 403, "self_role_elevation_not_allowed"],
    [reviewerX, "POST", grant(ORG_A, USERS.newcomer)[0], { role_name: "client_reviewer" }, 403, "role_not_allowed"],
    // An ordinary member and an unknown role.
    [plain, "POST", grant(ORG_A, USERS.newcomer)[0], { role_name: "client_contributor" }, 403, "role_not_allowed"],
    [plain, "POST", grant(ORG_A, USERS.plain)[0], { role_name: "client_admin" }, 403, "role_not_allowed"],
    [clientAdmin, "PUT", put(ORG_A, USERS.newcomer), { role_name: "platform_superuser", membership_status: "active" }, 422, null],
  ];
  for (const [actor, method, path, body, status, reason] of attempts) {
    const outcome = await withRouter(store, actor, (call) => call(method, path, body));
    const where = `${actor.email} ${method} ${path} ${JSON.stringify(body)}`;
    assert.equal(outcome.status, status, `${where}: ${JSON.stringify(outcome.body)}`);
    assert.equal(outcome.code, status === 422 ? "validation_blocker" : "authorization_denied", where);
    assert.equal(outcome.reason, reason, where);
  }
  assert.deepEqual(store.state.writes, []);
  assert.deepEqual(store.state.auditRows, []);

  // The binding-derived client_admin is not a stored assignment to revoke.
  const superuser = await resolveActor(store, USERS.superuser, { superuser: true });
  const derivedRevoke = await withRouter(store, superuser, (call) => call("POST", revoke(ORG_B, USERS.reviewerX, "client_admin")));
  assert.deepEqual([derivedRevoke.status, derivedRevoke.code], [404, "not_found"]);
});

test("configuration 4: the platform superuser administers global and organization roles in any organization, including one it has no membership in", async () => {
  const store = createStore();
  const superuser = await resolveActor(store, USERS.superuser, { superuser: true });
  await withRouter(store, superuser, async (call) => {
    for (const roleName of ["gk_admin", "gk_operator", "gk_reviewer", "client_admin"]) {
      assert.equal((await call("POST", ...grant(ORG_C, USERS.newcomer), { role_name: roleName })).status, 200, roleName);
    }
    const roster = await call("GET", `/organizations/${ORG_C}/access`);
    assert.equal(roster.status, 200);
    assert.deepEqual(roster.body.data.access.find((entry) => entry.kai_user_id === USERS.newcomer.user_id).effective_role_names.sort(), ["client_admin", "gk_admin", "gk_operator", "gk_reviewer"]);
  });
  // Grants in C reached no other organization.
  assert.equal(store.state.memberships.some((entry) => entry.user_id === USERS.newcomer.user_id && entry.organization_id !== ORG_C), false);
  // Organization gk_admin without the global gk_admin role is not delegated
  // administration of C: its client_admin manages client roles only.
  const newcomer = await resolveActor(store, USERS.newcomer);
  const attempt = await withRouter(store, newcomer, (call) => call("POST", ...grant(ORG_C, USERS.plain), { role_name: "gk_reviewer" }));
  assert.deepEqual([attempt.status, attempt.reason], [403, "non_client_membership_not_client_managed"]);
});

test("no review, intake, or workflow path writes a role: the access-administration queries are the only kai.organization_memberships / kai.user_roles writer", () => {
  const root = new URL("../Backend/", import.meta.url).pathname;
  const writers = [];
  const visit = (directory) => {
    for (const name of readdirSync(directory)) {
      if (name === "node_modules") continue;
      const path = join(directory, name);
      if (statSync(path).isDirectory()) visit(path);
      else if (name.endsWith(".js") && /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+kai\.(organization_memberships|user_roles)\b/i.test(readFileSync(path, "utf8"))) {
        writers.push(path.slice(root.length));
      }
    }
  };
  visit(root);
  assert.deepEqual(writers, ["kai/db/kaiAccessAdministrationQueries.js"]);
});


// --------------------------------------------------------------------------
// Prompt 4: Team & Access as the KAI permissions administration interface
// --------------------------------------------------------------------------

test("administration context: only a platform superuser gets the organizations to administer; everyone else is told it is unavailable (200), and the flag disables it", async () => {
  const store = createStore();
  const superuser = await resolveActor(store, USERS.superuser, { superuser: true });
  await withRouter(store, superuser, async (call) => {
    const context = await call("GET", "/administration-context");
    assert.equal(context.status, 200);
    assert.deepEqual(context.body.data, {
      platform_administration: true,
      organizations: [{ organization_id: ORG_A, name: "Synthetic A" }, { organization_id: ORG_B, name: "Synthetic B" }, { organization_id: ORG_C, name: "Synthetic C" }],
      assignable_global_roles: ["gk_admin", "gk_operator", "gk_reviewer"],
    });
    assert.equal((await call("GET", "/administration-context?organization_id=x")).status, 422, "no query fields");
    // The administration scope opens the roster of an organization with no membership.
    assert.equal((await call("GET", `/organizations/${ORG_C}/access`)).status, 200);
  });
  for (const user of [USERS.delegatedAdmin, USERS.clientAdminA, USERS.reviewerX, USERS.plain]) {
    const actor = await resolveActor(store, user);
    await withRouter(store, actor, async (call) => {
      const context = await call("GET", "/administration-context");
      assert.deepEqual([context.status, context.body.data], [200, { platform_administration: false, organizations: [], assignable_global_roles: [] }], user.email);
      assert.equal((await call("GET", `/organizations/${ORG_C}/access`)).status, 403, `${user.email}: no other organization's roster`);
    });
  }
  assert.equal((await getAccessAdministrationContext({ actorContext: superuser }, { ...store.dependencies, env: { KAI_SPRINT2_ENABLED: "false" } })).error.code, "feature_disabled");
  assert.equal((await getAccessAdministrationContext({ actorContext: { ...superuser, actorType: "ai" } }, store.dependencies)).error.code, "authorization_denied");
  assert.deepEqual(projectTeamAccessAdministrationContext({ platform_administration: false, organizations: [{ organization_id: ORG_A }] }).organizations, []);
});

test("operation readiness is exactly each operation's own enforced predicate, for every configured actor in every organization", async () => {
  const store = createStore();
  const { __reviewCockpitServiceContract: cockpit } = await import("../Backend/kai/services/kaiReviewCockpitService.js");
  for (const user of [USERS.reviewerX, USERS.operator, USERS.dual, USERS.delegatedAdmin, USERS.clientAdminA, USERS.plain, USERS.newcomer]) {
    const actor = await resolveActor(store, user);
    for (const organizationId of Object.values(ORGS)) {
      const readiness = Object.fromEntries(computeOrganizationOperationReadiness(actor, organizationId).map((item) => [item.key, item]));
      const capabilities = await getOrganizationAccessCapabilities({ organizationId, actorContext: actor }, { env: ENV });
      const ops = capabilities.ok ? capabilities.data.workflowOperations : {};
      const where = `${user.email} in ${organizationId}`;
      const expected = {
        gk_workspace: validateActorCanAccessKnowledgeWorkspace(actor, organizationId).ok === true,
        generated_content_read: ops.readGeneratedDrafts === true,
        evidence_processing: ops.extractEvidence === true,
        draft_generation: ops.generateDrafts === true,
        source_review: validateActorCanPerformOperation(actor, "read_intake", organizationId, { allowedRoles: cockpit.REVIEW_COCKPIT_READ_ROLES, globalRolesOnly: true }).ok === true
          && authorizeSourcePromotionDecision(actor, organizationId).ok === true,
        sensitivity_review: validateActorCanPerformSensitivityReview(actor, "record_sensitivity_allowed_use_decision", organizationId, cockpit.REVIEW_COCKPIT_READ_ROLES, { globalRolesOnly: true }).ok === true,
        evidence_review: ops.recordEvidenceReview === true,
        claim_review: ops.recordClaimReview === true,
        coverage_acceptance: ops.acceptCoverageLimitation === true,
        generated_content_review: ops.reviewGeneratedDrafts === true,
        export_release: validateActorCanPerformOperation(actor, "complete_export_review", organizationId, { allowedRoles: new Set(["gk_admin"]) }).ok === true,
        delegated_administration: [...(resolveOrganizationRoleAdministration(actor, "manage_organization_membership", organizationId).authorityByRole?.values() || [])].includes("delegated_gk_admin"),
      };
      assert.deepEqual(Object.fromEntries(Object.entries(readiness).map(([key, item]) => [key, item.ready])), expected, where);
      // Reading drafts and both reporting packets is one predicate.
      if (capabilities.ok) {
        assert.equal(readiness.generated_content_read.ready, ops.readGrantResponsePacket === true && ops.readBoardReportingPacket === true, where);
      }
      for (const item of Object.values(readiness)) {
        if (item.ready) assert.deepEqual(item.missing, [], `${where}: ${item.key} ready has nothing missing`);
        else if (item.key !== "sensitivity_review") assert.ok(item.missing.length > 0, `${where}: ${item.key} names what is missing`);
      }
    }
  }
});

test("roster readback: readiness for administrators of Get Kinder roles only, raw global roles for the platform superuser only, and an incomplete operator names the missing global role and its grantor", async () => {
  const store = createStore();
  store.state.memberships.push(row(ORG_A, USERS.newcomer, "gk_operator"));
  const viewers = [
    ["superuser", await resolveActor(store, USERS.superuser, { superuser: true }), { readiness: true, globals: true }],
    ["delegated GK administrator", await resolveActor(store, USERS.delegatedAdmin), { readiness: true, globals: false }],
    ["client administrator", await resolveActor(store, USERS.clientAdminA), { readiness: false, globals: false }],
  ];
  for (const [label, actor, expected] of viewers) {
    const roster = await viewEffectiveKaiAccess({ actorContext: actor, organizationId: ORG_A }, store.dependencies);
    assert.equal(roster.ok, true, label);
    const newcomer = roster.data.access.find((entry) => entry.kai_user_id === USERS.newcomer.user_id);
    assert.equal(Array.isArray(newcomer.operation_readiness), expected.readiness, `${label}: readiness`);
    assert.equal(Array.isArray(newcomer.global_kai_roles), expected.globals, `${label}: global roles`);
    assert.deepEqual(roster.data.assignable_global_roles, expected.globals ? ["gk_admin", "gk_operator", "gk_reviewer"] : [], label);
    if (!expected.readiness) continue;
    const member = projectTeamAccessRoster(roster.data).find((candidate) => candidate.key === `legacy:${USERS.newcomer.legacy}`);
    const source = member.operationReadiness.find((item) => item.key === "source_review");
    // Repair 1: the missing global operator/reviewer role is also supplied by
    // delegated staff onboarding when it affects no other organization.
    assert.deepEqual([source.ready, source.missing.map((gap) => [gap.scope, gap.roles.join("|"), gap.grantedBy.join("|")])],
      [false, [["global", "gk_admin|gk_operator|gk_reviewer", "platform_superuser|delegated_gk_admin_staff_onboarding"]]], label);
    assert.match(describeReadinessGap(source.missing[0]), /global .*operator.*platform administrator or a Get Kinder administrator of this organization through staff onboarding/i);
    // The newcomer has no access outside Org A, so onboarding can be completed here.
    assert.deepEqual(member.staffOnboarding, [{ roleName: "gk_operator", globalRole: "gk_operator", status: "pending_completion" }], label);
    assert.deepEqual(roster.data.staff_onboarding_roles, label === "delegated GK administrator" ? ["gk_operator", "gk_reviewer"] : [], label);
    assert.match(teamAccessHandoffNotice(member), /^Organization role assigned\. A platform administrator must also assign a global .* role before this person can .*review and promote sources/);
    assert.equal(member.operationReadiness.find((item) => item.key === "evidence_processing").ready, true, "the organization role's own operations are ready");
  }
  // Supplying the global role completes it; nothing is inferred client-side.
  store.state.globalRoles[USERS.newcomer.user_id] = ["gk_operator"];
  const completed = await viewEffectiveKaiAccess({ actorContext: await resolveActor(store, USERS.delegatedAdmin), organizationId: ORG_A }, store.dependencies);
  const member = projectTeamAccessRoster(completed.data).find((candidate) => candidate.key === `legacy:${USERS.newcomer.legacy}`);
  assert.equal(member.operationReadiness.find((item) => item.key === "source_review").ready, true);
  assert.equal(teamAccessHandoffNotice(member), "");
  // A binding-derived client_admin is reported as derived, never a stored Get Kinder assignment.
  const orgB = await viewEffectiveKaiAccess({ actorContext: await resolveActor(store, USERS.superuser, { superuser: true }), organizationId: ORG_B }, store.dependencies);
  const derived = orgB.data.access.find((entry) => entry.kai_user_id === USERS.reviewerX.user_id);
  assert.deepEqual([derived.authority_source, derived.derived_membership.source, derived.stored_memberships], ["derived", "gk_organization_binding", []]);
  assert.deepEqual(derived.global_kai_roles, ["gk_reviewer"]);
});

test("Team & Access global-role controls: only the server's assignable roles, only a matching assign/revoke, and every non-superuser is refused by the server", async () => {
  const member = { legacyUserId: 7, globalRoles: ["gk_reviewer"] };
  const assignable = ["gk_admin", "gk_operator", "gk_reviewer"];
  assert.deepEqual(teamAccessGlobalRoleRequest(member, "gk_admin", "assign", assignable), { path: "/api/kai/sprint2/access-administration/global-roles/7", body: { role_name: "gk_admin", action: "assign" } });
  assert.deepEqual(teamAccessGlobalRoleRequest(member, "gk_reviewer", "revoke", assignable).body, { role_name: "gk_reviewer", action: "revoke" });
  for (const [label, args] of [
    ["not offered (non-superuser roster)", [member, "gk_admin", "assign", []]],
    ["already held", [member, "gk_reviewer", "assign", assignable]],
    ["not held", [member, "gk_admin", "revoke", assignable]],
    ["unknown action", [member, "gk_admin", "grant", assignable]],
    ["no global roles visible", [{ legacyUserId: 7, globalRoles: null }, "gk_admin", "assign", assignable]],
    ["unknown role", [member, "platform_superuser", "assign", ["platform_superuser"]]],
  ]) {
    assert.throws(() => teamAccessGlobalRoleRequest(...args), /unsupported/, label);
  }
  assert.deepEqual(projectTeamAccessGlobalAdministration({ global_roles_visible: false, assignable_global_roles: ["gk_admin"] }), { globalRolesVisible: false, assignableGlobalRoles: [] });
  assert.match(GLOBAL_ROLE_EXPLANATIONS.gk_admin, /^High-risk/);
  assert.match(GLOBAL_ROLE_EXPLANATIONS.gk_admin, /export, final release and funder\/public-ready/);
  const store = createStore();
  for (const user of [USERS.delegatedAdmin, USERS.clientAdminA, USERS.plain]) {
    const actor = await resolveActor(store, user);
    const refused = await withRouter(store, actor, (call) => call("PUT", globalRole(USERS.newcomer), { role_name: "gk_admin", action: "assign" }));
    assert.deepEqual([refused.status, refused.reason], [403, "platform_superuser_required"], user.email);
  }
  assert.deepEqual(store.state.writes, []);
  assert.deepEqual(store.state.auditRows, []);
});

// ---------------------------------------------------------------------------
// Repair 1: delegated GK staff onboarding and offboarding (router + service
// over the three-organization store). The real-PostgreSQL proof is
// __tests__/kai-sprint2-gk-staff-onboarding.integration.spec.js.
// ---------------------------------------------------------------------------

const staffPath = (organizationId, user) => `/organizations/${organizationId}/gk-staff${user ? `/${user.legacy}` : ""}`;
const staffRevokePath = (organizationId, user, roleName) => `${staffPath(organizationId, user)}/roles/${roleName}/revoke`;

test("Repair 1: a delegated GK administrator completes operator and reviewer onboarding - organization role plus the global role - and the recipient's next request carries it, in that organization only", async () => {
  const store = createStore();
  const delegated = await resolveActor(store, USERS.delegatedAdmin);
  await withRouter(store, delegated, async (call) => {
    const byEmail = await call("POST", staffPath(ORG_A), { email: ` ${USERS.newcomer.email.toUpperCase()}`, role_name: "gk_reviewer" });
    assert.equal(byEmail.status, 200, JSON.stringify(byEmail.body));
    assert.deepEqual([byEmail.body.data.onboarding_status, byEmail.body.data.global_role, byEmail.body.data.organization_role.organization_access_admitted],
      ["complete", { role_name: "gk_reviewer", status: "assigned" }, true]);
    const byId = await call("POST", staffPath(ORG_A, USERS.plain), { role_name: "gk_operator" });
    assert.deepEqual([byId.status, byId.body.data.onboarding_status], [200, "complete"]);
  });
  assert.deepEqual(store.state.writes, [
    { kind: "grant", organizationId: ORG_A, userId: USERS.newcomer.user_id, roleName: "gk_reviewer" },
    { kind: "global_assign", userId: USERS.newcomer.user_id, roleName: "gk_reviewer" },
    { kind: "grant", organizationId: ORG_A, userId: USERS.plain.user_id, roleName: "gk_operator" },
    { kind: "global_assign", userId: USERS.plain.user_id, roleName: "gk_operator" },
  ]);
  assert.deepEqual(store.state.auditRows.map((row) => [row.operation, row.role_name, row.authority_source, row.organization_id, row.actor_user_id]), [
    ["organization_role_granted_access_admitted", "gk_reviewer", "delegated_gk_admin", ORG_A, USERS.delegatedAdmin.user_id],
    ["global_kai_role_assigned", "gk_reviewer", "delegated_gk_admin", ORG_A, USERS.delegatedAdmin.user_id],
    ["organization_role_granted", "gk_operator", "delegated_gk_admin", ORG_A, USERS.delegatedAdmin.user_id],
    ["global_kai_role_assigned", "gk_operator", "delegated_gk_admin", ORG_A, USERS.delegatedAdmin.user_id],
  ]);
  const operator = await resolveActor(store, USERS.plain);
  const reviewer = await resolveActor(store, USERS.newcomer);
  for (const [label, actor, sourceReview, intake, evidenceReview] of [["operator", operator, true, true, false], ["reviewer", reviewer, true, false, true]]) {
    const cockpit = await getReviewCockpitCapabilities({ organizationId: ORG_A, actorContext: actor }, { env: ENV });
    const capabilities = await getOrganizationAccessCapabilities({ organizationId: ORG_A, actorContext: actor }, { env: ENV });
    assert.deepEqual([cockpit.data.can_review_source_candidates, validateActorCanPerformOperation(actor, "create_intake_batch", ORG_A).ok,
      capabilities.data.workflowOperations.recordEvidenceReview, capabilities.data.organizationAccessManagement], [sourceReview, intake, evidenceReview, false], label);
    for (const organizationId of [ORG_B, ORG_C]) {
      assert.equal(validateActorCanAccessKnowledgeWorkspace(actor, organizationId).ok, false, `${label}: nothing in ${organizationId}`);
    }
  }
});

test("Repair 1: binding-derived or stored access elsewhere keeps the global role on the platform path - the organization role is the pending state, and the blocker names no other organization", async () => {
  const store = createStore();
  const delegated = await resolveActor(store, USERS.delegatedAdmin);
  store.state.memberships.push(row(ORG_C, USERS.newcomer, "client_contributor"));
  await withRouter(store, delegated, async (call) => {
    // reviewerX: Get Kinder organization admin of Org B's bound organization (derived client_admin there).
    for (const [user, roleName] of [[USERS.reviewerX, "gk_operator"], [USERS.newcomer, "gk_reviewer"]]) {
      const pending = await call("POST", staffPath(ORG_A, user), { role_name: roleName });
      assert.equal(pending.status, 200, JSON.stringify(pending.body));
      const [blocker] = pending.body.data.pending_blockers;
      assert.deepEqual([pending.body.data.onboarding_status, blocker.blocking_reason, blocker.evidence],
        ["pending_platform_approval", "cross_organization_global_role_side_effect",
          { bypass_allowed: false, global_role: roleName, organization_role: roleName, approval_path: "platform_superuser_global_role" }]);
      assert.doesNotMatch(JSON.stringify(pending.body), new RegExp(`${ORG_B}|${ORG_C}|${GK_ORG_B}`), "no other organization is disclosed");
    }
    const roster = await call("GET", `/organizations/${ORG_A}/access`);
    const statusOf = (user) => roster.body.data.access.find((entry) => entry.kai_user_id === user.user_id).staff_onboarding;
    assert.deepEqual(statusOf(USERS.reviewerX), [
      { role_name: "gk_operator", global_role: "gk_operator", status: "pending_platform_approval" },
      { role_name: "gk_reviewer", global_role: "gk_reviewer", status: "complete" },
    ]);
    assert.deepEqual(statusOf(USERS.newcomer), [{ role_name: "gk_reviewer", global_role: "gk_reviewer", status: "pending_platform_approval" }]);
    assert.deepEqual(roster.body.data.staff_onboarding_roles, ["gk_operator", "gk_reviewer"]);
  });
  assert.deepEqual(store.state.writes.map((write) => write.kind), ["grant", "grant"], "no global role was written");
  assert.deepEqual(store.state.globalRoles[USERS.newcomer.user_id], undefined);
  const superuserRoster = await viewEffectiveKaiAccess({ actorContext: await resolveActor(store, USERS.superuser, { superuser: true }), organizationId: ORG_A }, store.dependencies);
  assert.deepEqual(superuserRoster.data.staff_onboarding_roles, [], "a platform superuser keeps the explicit organization and global controls");
});

test("Repair 1: offboarding revokes the global role only when it can take effect nowhere else, and keeps it (with a blocker) when the person has access elsewhere", async () => {
  const store = createStore();
  const delegated = await resolveActor(store, USERS.delegatedAdmin);
  await withRouter(store, delegated, async (call) => {
    const confined = await call("POST", staffRevokePath(ORG_A, USERS.dual, "gk_operator"));
    assert.deepEqual([confined.status, confined.body.data.global_role, confined.body.data.remaining_active_role_names],
      [200, { role_name: "gk_operator", status: "revoked", reason: null }, ["gk_reviewer"]]);
    const elsewhere = await call("POST", staffRevokePath(ORG_A, USERS.operator, "gk_operator"));
    assert.deepEqual([elsewhere.body.data.global_role.status, elsewhere.body.data.global_role.reason, elsewhere.body.data.pending_blockers[0].blocking_reason],
      ["retained", "access_in_another_organization", "cross_organization_global_role_side_effect"]);
    const bound = await call("POST", staffRevokePath(ORG_A, USERS.reviewerX, "gk_reviewer"));
    assert.deepEqual([bound.body.data.global_role.status, bound.body.data.global_role.reason], ["retained", "access_in_another_organization"]);
    // Refusals: a client role, gk_admin, a body, an unknown assignment.
    assert.deepEqual([(await call("POST", staffRevokePath(ORG_A, USERS.clientAdminA, "client_admin"))).reason], ["staff_onboarding_role_not_permitted"]);
    assert.deepEqual([(await call("POST", staffRevokePath(ORG_A, USERS.delegatedAdmin, "gk_admin"))).reason], ["staff_onboarding_role_not_permitted"]);
    assert.equal((await call("POST", staffRevokePath(ORG_A, USERS.plain, "gk_operator"), { role_name: "gk_operator" })).status, 422);
    assert.equal((await call("POST", staffRevokePath(ORG_A, USERS.plain, "gk_operator"))).status, 404);
  });
  assert.deepEqual(store.state.globalRoles[USERS.dual.user_id], ["gk_reviewer"], "the unrelated global reviewer role stays");
  assert.deepEqual(store.state.globalRoles[USERS.operator.user_id], ["gk_operator"]);
  assert.deepEqual(store.state.globalRoles[USERS.reviewerX.user_id], ["gk_reviewer"]);
  assert.ok(store.state.memberships.some((entry) => entry.organization_id === ORG_B && entry.user_id === USERS.operator.user_id && entry.membership_status === "active"),
    "the client role in Org B is untouched");
  assert.deepEqual(store.state.auditRows.map((entry) => [entry.operation, entry.role_name]), [
    ["organization_role_revoked", "gk_operator"], ["global_kai_role_revoked", "gk_operator"],
    ["organization_role_revoked", "gk_operator"], ["organization_role_revoked", "gk_reviewer"],
  ]);
});

test("Repair 1: refusals are structured and write nothing - identity, role, self, tenant, client administrators, request shape, and the feature flag", async () => {
  const store = createStore();
  store.state.accounts[USERS.newcomer.legacy] = { email_verified: false };
  store.state.accounts[USERS.plain.legacy] = { is_suspended: true };
  const delegated = await resolveActor(store, USERS.delegatedAdmin);
  await withRouter(store, delegated, async (call) => {
    for (const [label, path, body, status, reason] of [
      ["unverified account", staffPath(ORG_A, USERS.newcomer), { role_name: "gk_operator" }, 422, "target_account_not_verified"],
      ["suspended account", staffPath(ORG_A, USERS.plain), { role_name: "gk_reviewer" }, 422, "target_account_suspended"],
      ["unknown email", staffPath(ORG_A), { email: "nobody@cross-org.synthetic.test", role_name: "gk_operator" }, 404, "target_account_not_found"],
      ["gk_admin", staffPath(ORG_A, USERS.clientAdminA), { role_name: "gk_admin" }, 403, "staff_onboarding_role_not_permitted"],
      ["self", staffPath(ORG_A, USERS.delegatedAdmin), { role_name: "gk_reviewer" }, 403, "self_role_elevation_not_allowed"],
      ["self by email", staffPath(ORG_A), { email: USERS.delegatedAdmin.email, role_name: "gk_reviewer" }, 403, "self_role_elevation_not_allowed"],
      ["another organization", staffPath(ORG_B, USERS.clientAdminA), { role_name: "gk_reviewer" }, 403, "missing_active_organization_membership"],
      ["both identifiers", staffPath(ORG_A, USERS.clientAdminA), { email: USERS.clientAdminA.email, role_name: "gk_reviewer" }, 422, null],
      ["no role", staffPath(ORG_A), { email: USERS.clientAdminA.email }, 422, null],
      ["array body", staffPath(ORG_A, USERS.clientAdminA), ["gk_reviewer"], 422, null],
      ["organization-only grant to an unverified account", `/organizations/${ORG_A}/memberships/${USERS.newcomer.legacy}/roles`, { role_name: "gk_reviewer" }, 422, "target_account_not_verified"],
    ]) {
      const refused = await call("POST", path, body);
      assert.deepEqual([refused.status, refused.reason], [status, reason], `${label}: ${JSON.stringify(refused.body)}`);
    }
  });
  for (const user of [USERS.clientAdminA, USERS.reviewerX]) {
    // A stored client administrator of A; a binding-derived client administrator of B.
    const organizationId = user === USERS.clientAdminA ? ORG_A : ORG_B;
    const refused = await withRouter(store, await resolveActor(store, user), (call) => call("POST", staffPath(organizationId, USERS.newcomer), { role_name: "gk_reviewer" }));
    assert.deepEqual([refused.status, refused.reason], [403, "non_client_membership_not_client_managed"], user.email);
  }
  assert.equal((await onboardGkStaffMember({ actorContext: delegated, organizationId: ORG_A, targetLegacyPublicUserdataId: USERS.clientAdminA.legacy, roleName: "gk_reviewer", now: NOW },
    { ...store.dependencies, env: { KAI_SPRINT2_ENABLED: "false" } })).error.code, "feature_disabled");
  assert.equal((await offboardGkStaffRole({ actorContext: { ...delegated, actorType: "ai" }, organizationId: ORG_A, targetLegacyPublicUserdataId: USERS.reviewerX.legacy, roleName: "gk_reviewer", now: NOW },
    store.dependencies)).error.code, "authorization_denied");
  assert.deepEqual(store.state.writes, []);
  assert.deepEqual(store.state.auditRows, []);
});

test("Repair 1 Team & Access: staff onboarding requests carry only what the server offered, and every outcome and refusal is stated in words", () => {
  const roles = projectTeamAccessStaffOnboardingRoles({ staff_onboarding_roles: ["gk_reviewer", "gk_admin", "gk_operator"] });
  assert.deepEqual(roles, ["gk_operator", "gk_reviewer"]);
  assert.deepEqual(projectTeamAccessStaffOnboardingRoles({}), []);
  assert.deepEqual(teamAccessStaffOnboardingByEmailRequest(ORG_A, "  New.Staff@Example.TEST ", "gk_operator", roles), {
    path: `${BASE}/organizations/${ORG_A}/gk-staff`, body: { email: "new.staff@example.test", role_name: "gk_operator" },
  });
  assert.throws(() => teamAccessStaffOnboardingByEmailRequest(ORG_A, "not-an-email", "gk_operator", roles), /invalid_email/);
  assert.throws(() => teamAccessStaffOnboardingByEmailRequest(ORG_A, "a@b.test", "gk_admin", roles), /unsupported/);
  assert.throws(() => teamAccessStaffOnboardingByEmailRequest(ORG_A, "a@b.test", "gk_operator", []), /unsupported/, "not offered to this administrator");
  const member = {
    legacyUserId: 7, grantableRoles: ["gk_reviewer"], assignments: [{ roleName: "gk_operator", status: "active", canRevoke: true, canRestore: false }],
    staffOnboarding: [{ roleName: "gk_operator", globalRole: "gk_operator", status: "pending_completion" }],
  };
  assert.deepEqual(teamAccessStaffOnboardingRequest(ORG_A, member, "gk_reviewer", roles), { path: `${BASE}/organizations/${ORG_A}/gk-staff/7`, body: { role_name: "gk_reviewer" } });
  assert.deepEqual(teamAccessStaffOnboardingRequest(ORG_A, member, "gk_operator", roles).body, { role_name: "gk_operator" }, "completing a pending onboarding");
  assert.throws(() => teamAccessStaffOnboardingRequest(ORG_A, { ...member, staffOnboarding: [] }, "gk_operator", roles), /unsupported/);
  assert.deepEqual(teamAccessStaffOffboardingRequest(ORG_A, member, "gk_operator", roles), { path: `${BASE}/organizations/${ORG_A}/gk-staff/7/roles/gk_operator/revoke`, body: {} });
  assert.throws(() => teamAccessStaffOffboardingRequest(ORG_A, member, "gk_reviewer", roles), /unsupported/);

  assert.match(staffOnboardingResultMessage({ role_name: "gk_operator", global_role: { role_name: "gk_operator" }, onboarding_status: "complete" }, "a@b.test"),
    /^a@b\.test is now a Get Kinder operator here with the global Get Kinder operator role, and can sign in and start now\.$/);
  assert.match(staffOnboardingResultMessage({ role_name: "gk_reviewer", global_role: { role_name: "gk_reviewer" }, onboarding_status: "pending_platform_approval" }, "a@b.test"),
    /was not granted: they also have KAI access in another organization, so a platform administrator must approve it\.$/);
  assert.match(staffOffboardingResultMessage({ role_name: "gk_operator", global_role: { role_name: "gk_operator", status: "revoked" } }, "x"), /global Get Kinder operator role was removed/);
  assert.match(staffOffboardingResultMessage({ role_name: "gk_operator", global_role: { role_name: "gk_operator", status: "retained", reason: "required_by_another_assignment" } }, "x"), /another of their assignments needs it/);
  assert.match(staffOffboardingResultMessage({ role_name: "gk_operator", global_role: { role_name: "gk_operator", status: "retained", reason: "access_in_another_organization" } }, "x"), /platform administrator decides/);
  assert.match(staffOnboardingStatusText({ globalRole: "gk_operator", status: "pending_completion" }), /^Onboarding not finished/);
  assert.match(staffOnboardingStatusText({ globalRole: "gk_reviewer", status: "pending_platform_approval" }), /^Waiting for a platform administrator/);
  for (const [reason, expected] of [
    ["target_account_not_found", /register at Get Kinder and verify their email/],
    ["target_account_not_verified", /not verified their Get Kinder email/],
    ["target_account_suspended", /suspended/],
    ["target_account_ambiguous", /More than one Get Kinder account/],
    ["target_kai_account_inactive", /deactivated/],
    ["self_role_elevation_not_allowed", /cannot add to or raise your own roles/],
  ]) {
    assert.match(describeStaffOnboardingError({ status: 422, code: "validation_blocker", blockingReason: reason }), expected, reason);
  }
});
