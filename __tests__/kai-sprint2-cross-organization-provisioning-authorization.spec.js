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
} from "../Backend/kai/services/kaiAccessAdministrationService.js";
import { resolveKaiActorContext } from "../Backend/kai/auth/kaiActorContext.js";
import { createProductionMetadataOnlyAuditForAccessAdministration } from "../Backend/kai/services/kaiMetadataOnlyAuditComposition.js";
import { getOrganizationAccessCapabilities } from "../Backend/kai/services/kaiOrganizationAccessCapabilitiesService.js";
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
    auditRows: [],
    writes: [],
  };
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
  // no P1-08 promotion and no direct organization-GK operation.
  assert.deepEqual(await surfaceFor(actor, ORG_B), {
    listed: true, capabilities: "ok", gkWorkspace: true,
    recordEvidenceReview: true, recordClaimReview: true, extractEvidence: false, proposeClaim: false, acceptCoverageLimitation: false,
    projectManagement: true, teamAccess: true, sourceReview: true, sensitivityReview: true, promoteSource: false,
  });
  assert.deepEqual(await enforcementFor(actor, ORG_B), {
    recordEvidenceReview: true, extractEvidence: false, assessEvidenceCoverage: false, proposeClaim: false, generateClaimGapFollowups: false,
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
      assert.equal(surface.proposeClaim, enforced.assessEvidenceCoverage, where);
      assert.equal(surface.gkWorkspace, enforced.readClaimLibrary, where);
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
