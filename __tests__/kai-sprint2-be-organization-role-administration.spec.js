import test from "node:test";
import assert from "node:assert/strict";
import express from "express";

import accessAdministrationRouter, { __testables } from "../Backend/kai/routes/kaiAccessAdministrationApi.js";
import {
  viewEffectiveKaiAccess,
  manageOrganizationMembership,
  grantOrganizationRole,
  revokeOrganizationRole,
  manageGlobalKaiRole,
  resolveOrganizationRoleAdministration,
} from "../Backend/kai/services/kaiAccessAdministrationService.js";
import {
  grantOrganizationMembershipRole,
  revokeOrganizationMembershipRole,
  upsertOrganizationMembershipRoleStatus,
} from "../Backend/kai/db/kaiAccessAdministrationQueries.js";
import {
  KAI_PLATFORM_SUPERUSER_ASSIGNABLE_ORGANIZATION_ROLES,
  KAI_DELEGATED_GK_ADMIN_ASSIGNABLE_ORGANIZATION_ROLES,
  KAI_ASSIGNABLE_ORGANIZATION_ROLES,
} from "../Backend/kai/config/kaiAccessAdministrationContract.js";
import { resolveKaiActorContext } from "../Backend/kai/auth/kaiActorContext.js";
import { validateActorCanPerformOperation, validateActorCanAccessKnowledgeWorkspace } from "../Backend/kai/auth/kaiAuthorizationService.js";
import { authorizeSourcePromotionDecision } from "../Backend/kai/services/kaiSourcePromotionService.js";
import { getOrganizationAccessCapabilities } from "../Backend/kai/services/kaiOrganizationAccessCapabilitiesService.js";
import { listAuthorizedOrganizations } from "../Backend/kai/services/kaiOrganizationContextService.js";
import {
  projectTeamAccessRoster,
  teamAccessRoleChangeRequest,
  teamAccessRoleGrantRequest,
  teamAccessRoleRevokeRequest,
} from "../frontend/teamAccess/teamAccessLogic.js";

/**
 * Owner decision B/E (C04 independent grants, C05 explicit replacement, C06
 * targeted revocation, and the accepted administration authority), proven
 * through the real access-administration router and services, the real
 * shared validator, the real actor-context resolver, and the real P1-08
 * predicate. Only kai.* repository reads/writes are an in-memory synthetic
 * store; tests/kai-sprint2-p2-access-administration.integration.spec.js and
 * the browser campaign prove the same rules against PostgreSQL.
 */

const ENV = { KAI_SPRINT2_ENABLED: "true" };
const NOW = "2026-10-15T00:00:00.000Z";
const BASE = "/api/kai/sprint2/access-administration";
const ORG_A = "00000000-0000-4000-8000-0000000000a1";
const ORG_B = "00000000-0000-4000-8000-0000000000b1";
const GK_ORG_A = 5101;

const USERS = Object.freeze({
  superuser: { user_id: "91000000-0000-4000-8000-000000000001", legacy: 1, email: "super@synthetic.test" },
  gkAdmin: { user_id: "91000000-0000-4000-8000-000000000002", legacy: 2, email: "gk-admin@synthetic.test" },
  clientAdmin: { user_id: "91000000-0000-4000-8000-000000000003", legacy: 3, email: "client-admin@synthetic.test" },
  operator: { user_id: "91000000-0000-4000-8000-000000000004", legacy: 4, email: "operator@synthetic.test" },
  mixed: { user_id: "91000000-0000-4000-8000-000000000005", legacy: 5, email: "mixed@synthetic.test" },
  derivedAdmin: { user_id: "91000000-0000-4000-8000-000000000006", legacy: 6, email: "derived-admin@synthetic.test" },
  newcomer: { user_id: "91000000-0000-4000-8000-000000000007", legacy: 7, email: "newcomer@synthetic.test" },
  orgOnlyGkAdmin: { user_id: "91000000-0000-4000-8000-000000000008", legacy: 8, email: "org-only-gk-admin@synthetic.test" },
  globalOnlyGkAdmin: { user_id: "91000000-0000-4000-8000-000000000009", legacy: 9, email: "global-only-gk-admin@synthetic.test" },
  otherOrgAdmin: { user_id: "91000000-0000-4000-8000-000000000010", legacy: 10, email: "other-admin@synthetic.test" },
  secondClientAdmin: { user_id: "91000000-0000-4000-8000-000000000011", legacy: 11, email: "second-admin@synthetic.test" },
});

const row = (organizationId, user, roleName, membershipStatus = "active") => ({
  organization_id: organizationId,
  user_id: user.user_id,
  role_name: roleName,
  membership_status: membershipStatus,
});

/**
 * In-memory kai.organization_memberships / kai.user_roles / audit store
 * with the same per-assignment semantics as the real queries (the real
 * query SQL is asserted separately below).
 */
function createStore({ memberships = [], globalRoles = {}, derivedAdmins = [] } = {}) {
  const state = {
    memberships: memberships.map((entry) => ({ ...entry })),
    globalRoles: Object.fromEntries(Object.entries(globalRoles).map(([userId, roles]) => [userId, [...roles]])),
    audits: [],
    writes: [],
  };
  const userByLegacy = (legacy) => Object.values(USERS).find((user) => user.legacy === legacy) || null;
  const userById = (userId) => Object.values(USERS).find((user) => user.user_id === userId) || null;
  const rowsFor = (organizationId, userId) => state.memberships.filter((entry) => entry.organization_id === organizationId && entry.user_id === userId);
  const kaiUserOf = (user) => (user
    ? { user_id: user.user_id, legacy_identity_source: "public.userdata", legacy_public_userdata_id: user.legacy, email: user.email, status: "active" }
    : null);

  const dependencies = {
    env: ENV,
    runInTransaction: async (callback) => callback({ query: async () => ({ rows: [] }) }),
    listOrganizationMembershipRowsForOrganization: async (organizationId) => state.memberships
      .filter((entry) => entry.organization_id === organizationId)
      .map((entry) => {
        const kaiUser = kaiUserOf(userById(entry.user_id));
        return { ...entry, legacy_identity_source: "public.userdata", legacy_public_userdata_id: kaiUser.legacy_public_userdata_id, email: kaiUser.email, kai_user_status: "active" };
      }),
    listOrganizationMembershipRowsForUserInOrganization: async (organizationId, userId) => rowsFor(organizationId, userId).map((entry) => ({ ...entry })),
    countActiveStoredClientAdminMemberships: async (organizationId, _tx, { excludingUserId = null } = {}) => new Set(state.memberships
      .filter((entry) => entry.organization_id === organizationId && entry.role_name === "client_admin" && entry.membership_status === "active" && entry.user_id !== excludingUserId)
      .map((entry) => entry.user_id)).size,
    hasActiveDerivedClientAdminForOrganization: async (organizationId) => organizationId === ORG_A && derivedAdmins.length > 0,
    getActiveGkOrganizationIdForKaiOrganization: async (organizationId) => (organizationId === ORG_A ? GK_ORG_A : null),
    listActiveGkOrganizationAdminLegacyUserIds: async () => derivedAdmins.map((user) => user.legacy),
    findKaiUserByLegacyPublicUserdataId: async (legacy) => kaiUserOf(userByLegacy(legacy)),
    findOrCreateKaiUserByLegacyPublicUserdataId: async ({ legacyPublicUserdataId }) => kaiUserOf(userByLegacy(legacyPublicUserdataId)),
    listKaiRolesForUser: async (userId) => [...(state.globalRoles[userId] || [])],
    upsertOrganizationMembershipRoleStatus: async ({ organizationId, userId, roleName, membershipStatus, previousRoleName = null }) => {
      const existing = rowsFor(organizationId, userId);
      if (previousRoleName === null && existing.length > 1) return { conflict: true, mutated: false };
      const target = previousRoleName === null ? existing[0] : existing.find((entry) => entry.role_name === previousRoleName);
      if (previousRoleName !== null && !target) return { conflict: true, mutated: false };
      if (target && target.role_name !== roleName && existing.some((entry) => entry.role_name === roleName)) return { conflict: true, mutated: false };
      const previousRow = target ? { ...target } : null;
      if (previousRow && previousRow.role_name === roleName && previousRow.membership_status === membershipStatus) {
        return { previousRow, newRow: previousRow, mutated: false, replay: true };
      }
      state.writes.push({ kind: "upsert", organizationId, userId, roleName, membershipStatus, previousRoleName });
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
    createProductionMetadataOnlyAuditForAccessAdministration: ({ organizationId, actorContext }) => ({
      prepareMetadataOnlyAudit: ({ payload }) => ({
        ok: true,
        publish: async () => {
          state.audits.push({ organizationId, actor_user_id: actorContext?.actorUserId, ...payload });
          return { ok: true };
        },
      }),
    }),
  };
  return { state, dependencies };
}

// The real resolveKaiActorContext over the store: stored memberships, global
// roles, and (for USERS.derivedAdmin) the binding-derived client_admin.
async function resolveActor(store, user, { superuser = false } = {}) {
  const resolved = await resolveKaiActorContext({ id: user.legacy, email: user.email, is_admin: superuser, isAdmin: superuser }, {
    findOrCreateKaiUserByLegacyPublicUserdataId: async () => ({
      user_id: user.user_id, legacy_identity_source: "public.userdata", legacy_public_userdata_id: user.legacy, status: "active", email: user.email,
    }),
    listKaiRolesForUser: async (userId) => [...(store.state.globalRoles[userId] || [])],
    listOrganizationMembershipsForUser: async (userId) => store.state.memberships.filter((entry) => entry.user_id === userId).map((entry) => ({ ...entry })),
    resolveOrgScopeForUserId: async () => ({
      memberships: user === USERS.derivedAdmin ? [{ orgId: GK_ORG_A, role: "admin", is_active: true }] : [],
    }),
    listActiveGkOrganizationBindingsForGkOrganizationIds: async () => [{ gk_organization_id: GK_ORG_A, kai_organization_id: ORG_A, status: "active" }],
  });
  assert.equal(resolved.ok, true, JSON.stringify(resolved));
  const actorContext = { ...resolved.actorContext, legacyPublicUserdataId: user.legacy };
  if (superuser) Object.assign(actorContext, { platformSuperuser: true, platformSuperuserAuthority: "get_kinder_site_admin" });
  return actorContext;
}

async function withRouter(actorContext, store, work) {
  const previous = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "true";
  const { dependencies } = store;
  const restore = __testables.setAccessAdministrationServiceForTest({
    viewEffectiveKaiAccess: (input) => viewEffectiveKaiAccess(input, dependencies),
    manageOrganizationMembership: (input) => manageOrganizationMembership(input, dependencies),
    grantOrganizationRole: (input) => grantOrganizationRole(input, dependencies),
    revokeOrganizationRole: (input) => revokeOrganizationRole(input, dependencies),
    manageGlobalKaiRole: (input) => manageGlobalKaiRole(input, dependencies),
  });
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
  const { port } = server.address();
  const call = async (method, path, body) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { statusCode: response.status, body: await response.json().catch(() => null) };
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

const grantPath = (organizationId, user) => `${BASE}/organizations/${organizationId}/memberships/${user.legacy}/roles`;
const revokePath = (organizationId, user, roleName) => `${grantPath(organizationId, user)}/${roleName}/revoke`;
const putPath = (organizationId, user) => `${BASE}/organizations/${organizationId}/memberships/${user.legacy}`;
const activeRolesOf = (store, organizationId, user) => store.state.memberships
  .filter((entry) => entry.organization_id === organizationId && entry.user_id === user.user_id && entry.membership_status === "active")
  .map((entry) => entry.role_name)
  .sort();
const blockingReason = (result) => result.body?.blockers?.[0]?.blocking_reason;

// The standard organization: a stored client administrator, a delegated GK
// administrator (global + organization gk_admin), and a mixed member who
// holds a client role and a Get Kinder role at once.
function standardStore(extra = {}) {
  return createStore({
    memberships: [
      row(ORG_A, USERS.clientAdmin, "client_admin"),
      row(ORG_A, USERS.secondClientAdmin, "client_admin"),
      row(ORG_A, USERS.gkAdmin, "gk_admin"),
      row(ORG_A, USERS.mixed, "client_contributor"),
      row(ORG_A, USERS.mixed, "gk_reviewer"),
      row(ORG_A, USERS.orgOnlyGkAdmin, "gk_admin"),
      row(ORG_B, USERS.otherOrgAdmin, "client_admin"),
      ...(extra.memberships || []),
    ],
    globalRoles: { [USERS.gkAdmin.user_id]: ["gk_admin"], [USERS.globalOnlyGkAdmin.user_id]: ["gk_admin"], ...(extra.globalRoles || {}) },
    derivedAdmins: extra.derivedAdmins || [],
  });
}

// --------------------------------------------------------------------------
// Contract
// --------------------------------------------------------------------------

test("contract: superuser administers every client and GK organization role; a delegated GK administrator only gk_operator and gk_reviewer", () => {
  assert.deepEqual([...KAI_PLATFORM_SUPERUSER_ASSIGNABLE_ORGANIZATION_ROLES], [...KAI_ASSIGNABLE_ORGANIZATION_ROLES, "gk_reviewer", "gk_operator", "gk_admin"]);
  assert.deepEqual([...KAI_DELEGATED_GK_ADMIN_ASSIGNABLE_ORGANIZATION_ROLES], ["gk_operator", "gk_reviewer"]);
});

// --------------------------------------------------------------------------
// C04 independent grants
// --------------------------------------------------------------------------

test("C04: an additive grant preserves every existing role and global capability, is audited with the actor's authority, and a replay writes nothing", async () => {
  const store = standardStore({ globalRoles: { [USERS.mixed.user_id]: ["gk_reviewer"] } });
  const gkAdmin = await resolveActor(store, USERS.gkAdmin);
  await withRouter(gkAdmin, store, async (call) => {
    const granted = await call("POST", grantPath(ORG_A, USERS.mixed), { role_name: "gk_operator" });
    assert.equal(granted.statusCode, 200, JSON.stringify(granted.body));
    assert.deepEqual([granted.body.data.replayed, granted.body.data.organization_access_admitted], [false, false]);
    assert.deepEqual(activeRolesOf(store, ORG_A, USERS.mixed), ["client_contributor", "gk_operator", "gk_reviewer"]);
    assert.deepEqual(store.state.globalRoles[USERS.mixed.user_id], ["gk_reviewer"], "no global role is created or changed");

    const replay = await call("POST", grantPath(ORG_A, USERS.mixed), { role_name: "gk_operator" });
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.body.data.replayed, true);
  });
  assert.deepEqual(store.state.writes, [{ kind: "grant", organizationId: ORG_A, userId: USERS.mixed.user_id, roleName: "gk_operator" }]);
  assert.deepEqual(store.state.audits.map((audit) => [audit.attempted_operation, audit.role_name, audit.previous_membership_status, audit.resulting_membership_status, audit.authority_source, audit.actor_user_id, audit.organizationId]), [
    ["organization_role_granted", "gk_operator", null, "active", "delegated_gk_admin", USERS.gkAdmin.user_id, ORG_A],
  ]);
});

test("C04: a first active assignment is also the person's organization admission, and is audited as such", async () => {
  const store = standardStore();
  const superuser = await resolveActor(store, USERS.superuser, { superuser: true });
  await withRouter(superuser, store, async (call) => {
    const granted = await call("POST", grantPath(ORG_A, USERS.newcomer), { role_name: "gk_operator" });
    assert.equal(granted.statusCode, 200);
    assert.equal(granted.body.data.organization_access_admitted, true);
  });
  assert.deepEqual(store.state.audits.map((audit) => [audit.attempted_operation, audit.authority_source]), [
    ["organization_role_granted_access_admitted", "platform_superuser"],
  ]);
  const newcomer = await resolveActor(store, USERS.newcomer);
  assert.deepEqual(newcomer.kaiRoles, [], "an organization grant never creates a global GK role");
  assert.equal(validateActorCanPerformOperation(newcomer, "read_intake", ORG_B).ok, false, "nor access to another organization");
});

test("C04: restoring an inactive assignment reactivates only that assignment; other inactive assignments stay inactive", async () => {
  const store = standardStore({ memberships: [row(ORG_A, USERS.operator, "gk_operator", "inactive"), row(ORG_A, USERS.operator, "gk_reviewer", "inactive")] });
  const gkAdmin = await resolveActor(store, USERS.gkAdmin);
  await withRouter(gkAdmin, store, async (call) => {
    const restored = await call("POST", grantPath(ORG_A, USERS.operator), { role_name: "gk_operator" });
    assert.equal(restored.statusCode, 200);
    assert.equal(restored.body.data.organization_access_admitted, true);
  });
  assert.deepEqual(activeRolesOf(store, ORG_A, USERS.operator), ["gk_operator"]);
  assert.equal(store.state.audits[0].previous_membership_status, "inactive");
});

// --------------------------------------------------------------------------
// C05 explicit replacement
// --------------------------------------------------------------------------

test("C05: explicit replacement removes only the identified assignment and records prior and replacement authority", async () => {
  const store = standardStore();
  const gkAdmin = await resolveActor(store, USERS.gkAdmin);
  await withRouter(gkAdmin, store, async (call) => {
    const replaced = await call("PUT", putPath(ORG_A, USERS.mixed), { role_name: "gk_operator", membership_status: "active", previous_role_name: "gk_reviewer" });
    assert.equal(replaced.statusCode, 200, JSON.stringify(replaced.body));
  });
  assert.deepEqual(activeRolesOf(store, ORG_A, USERS.mixed), ["client_contributor", "gk_operator"]);
  assert.deepEqual(store.state.audits.map((audit) => [audit.attempted_operation, audit.previous_role_name, audit.resulting_role_name, audit.previous_membership_status, audit.resulting_membership_status, audit.authority_source]), [
    ["organization_role_replaced", "gk_reviewer", "gk_operator", "active", "active", "delegated_gk_admin"],
  ]);
});

test("C05: a replacement that names no assignment while several exist, names a missing one, or targets a role already held fails closed with no write", async () => {
  const store = standardStore();
  const superuser = await resolveActor(store, USERS.superuser, { superuser: true });
  await withRouter(superuser, store, async (call) => {
    const ambiguous = await call("PUT", putPath(ORG_A, USERS.mixed), { role_name: "gk_operator", membership_status: "active" });
    assert.deepEqual([ambiguous.statusCode, ambiguous.body.error.code], [409, "membership_state_conflict"]);
    const missing = await call("PUT", putPath(ORG_A, USERS.mixed), { role_name: "gk_operator", membership_status: "active", previous_role_name: "client_reviewer" });
    assert.deepEqual([missing.statusCode, missing.body.error.code], [409, "membership_state_conflict"]);
    const intoHeld = await call("PUT", putPath(ORG_A, USERS.mixed), { role_name: "gk_reviewer", membership_status: "active", previous_role_name: "client_contributor" });
    assert.deepEqual([intoHeld.statusCode, intoHeld.body.error.code], [409, "membership_state_conflict"]);
    const blankPrevious = await call("PUT", putPath(ORG_A, USERS.mixed), { role_name: "gk_operator", membership_status: "active", previous_role_name: "" });
    assert.equal(blankPrevious.statusCode, 422);
  });
  assert.deepEqual([store.state.writes, store.state.audits], [[], []]);
  assert.deepEqual(activeRolesOf(store, ORG_A, USERS.mixed), ["client_contributor", "gk_reviewer"]);
});

test("C05: the replacing actor must administer both the removed and the resulting role", async () => {
  const store = standardStore();
  const gkAdmin = await resolveActor(store, USERS.gkAdmin);
  const clientAdmin = await resolveActor(store, USERS.clientAdmin);
  await withRouter(gkAdmin, store, async (call) => {
    // The delegated GK administrator does not manage the client role it would remove.
    const fromClient = await call("PUT", putPath(ORG_A, USERS.mixed), { role_name: "gk_operator", membership_status: "active", previous_role_name: "client_contributor" });
    assert.deepEqual([fromClient.statusCode, blockingReason(fromClient)], [403, "organization_role_not_administrable"]);
    // Nor may it create organization gk_admin.
    const toAdmin = await call("PUT", putPath(ORG_A, USERS.mixed), { role_name: "gk_admin", membership_status: "active", previous_role_name: "gk_reviewer" });
    assert.deepEqual([toAdmin.statusCode, toAdmin.body?.error?.code, blockingReason(toAdmin)], [403, "authorization_denied", "organization_role_not_administrable"]);
  });
  await withRouter(clientAdmin, store, async (call) => {
    const fromGk = await call("PUT", putPath(ORG_A, USERS.mixed), { role_name: "client_reviewer", membership_status: "active", previous_role_name: "gk_reviewer" });
    assert.deepEqual([fromGk.statusCode, blockingReason(fromGk)], [403, "non_client_membership_not_client_managed"]);
    // Its own client role on the same person is still its to replace.
    const own = await call("PUT", putPath(ORG_A, USERS.mixed), { role_name: "client_reviewer", membership_status: "active", previous_role_name: "client_contributor" });
    assert.equal(own.statusCode, 200);
  });
  assert.deepEqual(activeRolesOf(store, ORG_A, USERS.mixed), ["client_reviewer", "gk_reviewer"]);
  assert.equal(store.state.audits.length, 1);
});

// --------------------------------------------------------------------------
// C06 targeted revocation
// --------------------------------------------------------------------------

test("C06: revoking one assignment preserves unrelated roles, ends that role's backend authority, and a replay cannot restore it", async () => {
  const store = standardStore({ globalRoles: { [USERS.mixed.user_id]: ["gk_reviewer"] } });
  const before = await resolveActor(store, USERS.mixed);
  assert.equal(validateActorCanAccessKnowledgeWorkspace(before, ORG_A).ok, true);

  const gkAdmin = await resolveActor(store, USERS.gkAdmin);
  await withRouter(gkAdmin, store, async (call) => {
    const revoked = await call("POST", revokePath(ORG_A, USERS.mixed, "gk_reviewer"), {});
    assert.equal(revoked.statusCode, 200, JSON.stringify(revoked.body));
    assert.deepEqual([revoked.body.data.membership_status, revoked.body.data.remaining_active_role_names, revoked.body.data.replayed], ["inactive", ["client_contributor"], false]);
    const replay = await call("POST", revokePath(ORG_A, USERS.mixed, "gk_reviewer"), {});
    assert.deepEqual([replay.statusCode, replay.body.data.replayed, replay.body.data.membership_status], [200, true, "inactive"]);
  });
  assert.deepEqual(activeRolesOf(store, ORG_A, USERS.mixed), ["client_contributor"]);
  assert.deepEqual(store.state.globalRoles[USERS.mixed.user_id], ["gk_reviewer"], "the global role is untouched");
  assert.deepEqual(store.state.audits.map((audit) => [audit.attempted_operation, audit.role_name, audit.previous_membership_status, audit.resulting_membership_status, audit.authority_source]), [
    ["organization_role_revoked", "gk_reviewer", "active", "inactive", "delegated_gk_admin"],
  ]);

  // A freshly resolved actor no longer passes any organization gk_reviewer
  // check (the revoked row is inactive), while membership access remains
  // through the client role and the global role still combines where an
  // operation allows it.
  const after = await resolveActor(store, USERS.mixed);
  assert.equal(validateActorCanPerformOperation(after, "record_evidence_review", ORG_A, { allowedRoles: new Set(["gk_reviewer"]) }).ok, false);
  assert.equal(validateActorCanPerformOperation(after, "read_intake", ORG_A, { allowedRoles: new Set(["client_contributor"]) }).ok, true);
  assert.equal(validateActorCanAccessKnowledgeWorkspace(after, ORG_A).ok, true, "global gk_reviewer + active exact-org access still admits the workspace");
});

test("C06: revoking a missing assignment is not_found and creates nothing; binding-derived client_admin is not a revocable stored assignment", async () => {
  const store = standardStore({ derivedAdmins: [USERS.derivedAdmin] });
  const superuser = await resolveActor(store, USERS.superuser, { superuser: true });
  await withRouter(superuser, store, async (call) => {
    const missing = await call("POST", revokePath(ORG_A, USERS.newcomer, "gk_operator"), {});
    assert.deepEqual([missing.statusCode, missing.body.error.code], [404, "not_found"]);
    const derived = await call("POST", revokePath(ORG_A, USERS.derivedAdmin, "client_admin"), {});
    assert.deepEqual([derived.statusCode, derived.body.error.code], [404, "not_found"]);
    const unknownRole = await call("POST", revokePath(ORG_A, USERS.mixed, "platform_superuser"), {});
    assert.equal(unknownRole.statusCode, 422);
    const withBody = await call("POST", revokePath(ORG_A, USERS.mixed, "gk_reviewer"), { reason: "x" });
    assert.equal(withBody.statusCode, 422);
  });
  assert.deepEqual([store.state.writes, store.state.audits], [[], []]);
  const derivedActor = await resolveActor(store, USERS.derivedAdmin);
  assert.equal(validateActorCanPerformOperation(derivedActor, "manage_organization_membership", ORG_A, { allowedRoles: new Set(["client_admin"]) }).ok, true);
});

test("C06: last-administrator protection refuses revoking the only effective client_admin; a binding-derived administrator satisfies it", async () => {
  const lone = createStore({ memberships: [row(ORG_A, USERS.clientAdmin, "client_admin"), row(ORG_A, USERS.mixed, "client_contributor")] });
  const clientAdmin = await resolveActor(lone, USERS.clientAdmin);
  await withRouter(clientAdmin, lone, async (call) => {
    const refused = await call("POST", revokePath(ORG_A, USERS.clientAdmin, "client_admin"), {});
    assert.deepEqual([refused.statusCode, refused.body.error.code], [409, "last_admin_protection"]);
  });
  assert.deepEqual(lone.state.writes, []);

  const bound = createStore({ memberships: [row(ORG_A, USERS.clientAdmin, "client_admin")], derivedAdmins: [USERS.derivedAdmin] });
  await withRouter(await resolveActor(bound, USERS.clientAdmin), bound, async (call) => {
    const allowed = await call("POST", revokePath(ORG_A, USERS.clientAdmin, "client_admin"), {});
    assert.equal(allowed.statusCode, 200, "an expressly authorized self-demotion succeeds while another administrator remains");
  });
});

// --------------------------------------------------------------------------
// Administration authority and self-management
// --------------------------------------------------------------------------

test("authority: a delegated GK administrator needs BOTH global gk_admin and an active organization gk_admin membership of the exact organization", async () => {
  const store = standardStore();
  const delegated = resolveOrganizationRoleAdministration(await resolveActor(store, USERS.gkAdmin), "manage_organization_membership", ORG_A);
  assert.deepEqual([...delegated.authorityByRole.entries()], [["gk_operator", "delegated_gk_admin"], ["gk_reviewer", "delegated_gk_admin"]]);

  const orgOnly = resolveOrganizationRoleAdministration(await resolveActor(store, USERS.orgOnlyGkAdmin), "manage_organization_membership", ORG_A);
  assert.deepEqual([orgOnly.ok, orgOnly.error_code, orgOnly.blockers[0].blocking_reason], [false, "authorization_denied", "role_not_allowed"]);
  const globalOnly = resolveOrganizationRoleAdministration(await resolveActor(store, USERS.globalOnlyGkAdmin), "manage_organization_membership", ORG_A);
  assert.deepEqual([globalOnly.ok, globalOnly.blockers[0].blocking_reason], [false, "missing_active_organization_membership"]);
  const otherOrg = resolveOrganizationRoleAdministration(await resolveActor(store, USERS.gkAdmin), "manage_organization_membership", ORG_B);
  assert.deepEqual([otherOrg.ok, otherOrg.blockers[0].blocking_reason], [false, "missing_active_organization_membership"]);

  // An inactive organization gk_admin assignment administers nothing.
  const inactive = createStore({ memberships: [row(ORG_A, USERS.gkAdmin, "gk_admin", "inactive")], globalRoles: { [USERS.gkAdmin.user_id]: ["gk_admin"] } });
  assert.equal(resolveOrganizationRoleAdministration(await resolveActor(inactive, USERS.gkAdmin), "manage_organization_membership", ORG_A).ok, false);
});

test("authority: a delegated GK administrator may not grant organization gk_admin, client roles, global roles, or another organization's roles", async () => {
  const store = standardStore();
  const gkAdmin = await resolveActor(store, USERS.gkAdmin);
  await withRouter(gkAdmin, store, async (call) => {
    for (const roleName of ["gk_admin", "client_admin", "client_contributor"]) {
      const result = await call("POST", grantPath(ORG_A, USERS.newcomer), { role_name: roleName });
      assert.deepEqual([result.statusCode, blockingReason(result)], [403, "organization_role_not_administrable"], roleName);
    }
    const revokeAdmin = await call("POST", revokePath(ORG_A, USERS.orgOnlyGkAdmin, "gk_admin"), {});
    assert.equal(revokeAdmin.statusCode, 403);
    const global = await call("PUT", `${BASE}/global-roles/${USERS.newcomer.legacy}`, { role_name: "gk_operator", action: "assign" });
    assert.deepEqual([global.statusCode, blockingReason(global)], [403, "platform_superuser_required"]);
    const otherOrg = await call("POST", grantPath(ORG_B, USERS.newcomer), { role_name: "gk_operator" });
    assert.deepEqual([otherOrg.statusCode, blockingReason(otherOrg)], [403, "missing_active_organization_membership"]);
    const extraField = await call("POST", grantPath(ORG_A, USERS.newcomer), { role_name: "gk_operator", membership_status: "active" });
    assert.equal(extraField.statusCode, 422);
  });
  assert.deepEqual([store.state.writes, store.state.audits], [[], []]);
});

test("authority: a client administrator manages client roles only; GK and global roles are refused without a write", async () => {
  const store = standardStore();
  const clientAdmin = await resolveActor(store, USERS.clientAdmin);
  await withRouter(clientAdmin, store, async (call) => {
    for (const roleName of ["gk_reviewer", "gk_operator", "gk_admin"]) {
      const result = await call("POST", grantPath(ORG_A, USERS.newcomer), { role_name: roleName });
      assert.deepEqual([result.statusCode, blockingReason(result)], [403, "non_client_membership_not_client_managed"], roleName);
    }
    const revokeGk = await call("POST", revokePath(ORG_A, USERS.mixed, "gk_reviewer"), {});
    assert.deepEqual([revokeGk.statusCode, blockingReason(revokeGk)], [403, "non_client_membership_not_client_managed"]);
    const global = await call("PUT", `${BASE}/global-roles/${USERS.newcomer.legacy}`, { role_name: "gk_reviewer", action: "assign" });
    assert.equal(global.statusCode, 403);
    const client = await call("POST", grantPath(ORG_A, USERS.mixed), { role_name: "client_reviewer" });
    assert.equal(client.statusCode, 200);
  });
  assert.deepEqual(activeRolesOf(store, ORG_A, USERS.mixed), ["client_contributor", "client_reviewer", "gk_reviewer"]);
  assert.deepEqual(store.state.audits.map((audit) => audit.authority_source), ["organization_client_admin"]);
});

test("authority: the platform superuser grants, replaces, and revokes organization gk_operator and gk_admin, and keeps its self-management", async () => {
  const store = standardStore();
  const superuser = await resolveActor(store, USERS.superuser, { superuser: true });
  await withRouter(superuser, store, async (call) => {
    assert.equal((await call("POST", grantPath(ORG_A, USERS.operator), { role_name: "gk_admin" })).statusCode, 200);
    assert.equal((await call("PUT", putPath(ORG_A, USERS.operator), { role_name: "gk_operator", membership_status: "active", previous_role_name: "gk_admin" })).statusCode, 200);
    assert.equal((await call("POST", revokePath(ORG_A, USERS.operator, "gk_operator"), {})).statusCode, 200);
    assert.equal((await call("POST", grantPath(ORG_A, USERS.superuser), { role_name: "gk_reviewer" })).statusCode, 200, "existing superuser self-management");
  });
  assert.deepEqual(store.state.audits.map((audit) => [audit.attempted_operation, audit.authority_source]), [
    ["organization_role_granted_access_admitted", "platform_superuser"],
    ["organization_role_replaced", "platform_superuser"],
    ["organization_role_revoked", "platform_superuser"],
    ["organization_role_granted_access_admitted", "platform_superuser"],
  ]);
});

test("self-management: no non-superuser administrator may grant, raise, or restore their own role; a self-demotion is allowed", async () => {
  const store = standardStore({ memberships: [row(ORG_A, USERS.gkAdmin, "gk_reviewer", "inactive")] });
  const gkAdmin = await resolveActor(store, USERS.gkAdmin);
  const clientAdmin = await resolveActor(store, USERS.clientAdmin);
  await withRouter(gkAdmin, store, async (call) => {
    const selfGrant = await call("POST", grantPath(ORG_A, USERS.gkAdmin), { role_name: "gk_operator" });
    assert.deepEqual([selfGrant.statusCode, blockingReason(selfGrant)], [403, "self_role_elevation_not_allowed"]);
    const selfRestore = await call("POST", grantPath(ORG_A, USERS.gkAdmin), { role_name: "gk_reviewer" });
    assert.deepEqual([selfRestore.statusCode, blockingReason(selfRestore)], [403, "self_role_elevation_not_allowed"]);
    const selfReplace = await call("PUT", putPath(ORG_A, USERS.gkAdmin), { role_name: "gk_operator", membership_status: "active", previous_role_name: "gk_reviewer" });
    assert.deepEqual([selfReplace.statusCode, blockingReason(selfReplace)], [403, "self_role_elevation_not_allowed"]);
  });
  await withRouter(clientAdmin, store, async (call) => {
    const selfAdd = await call("POST", grantPath(ORG_A, USERS.clientAdmin), { role_name: "client_reviewer" });
    assert.deepEqual([selfAdd.statusCode, blockingReason(selfAdd)], [403, "self_role_elevation_not_allowed"]);
  });
  assert.deepEqual([store.state.writes, store.state.audits], [[], []]);

  await withRouter(clientAdmin, store, async (call) => {
    const demote = await call("PUT", putPath(ORG_A, USERS.clientAdmin), { role_name: "client_reviewer", membership_status: "active", previous_role_name: "client_admin" });
    assert.equal(demote.statusCode, 200, "self-demotion while another administrator remains");
  });
  assert.deepEqual(activeRolesOf(store, ORG_A, USERS.clientAdmin), ["client_reviewer"]);
});

test("unauthorized and non-human actors are refused before any write; the feature flag disables every operation", async () => {
  const store = standardStore({ memberships: [row(ORG_A, USERS.operator, "gk_operator")], globalRoles: { [USERS.operator.user_id]: ["gk_operator"] } });
  const operator = await resolveActor(store, USERS.operator);
  await withRouter(operator, store, async (call) => {
    const result = await call("POST", grantPath(ORG_A, USERS.newcomer), { role_name: "gk_reviewer" });
    assert.deepEqual([result.statusCode, blockingReason(result)], [403, "role_not_allowed"]);
    assert.equal((await call("GET", `${BASE}/organizations/${ORG_A}/access`)).statusCode, 403);
  });
  const otherOrgAdmin = await resolveActor(store, USERS.otherOrgAdmin);
  await withRouter(otherOrgAdmin, store, async (call) => {
    const crossTenant = await call("POST", revokePath(ORG_A, USERS.mixed, "gk_reviewer"), {});
    assert.deepEqual([crossTenant.statusCode, blockingReason(crossTenant)], [403, "missing_active_organization_membership"]);
  });
  for (const actorType of ["ai", "system"]) {
    const nonHuman = { ...(await resolveActor(store, USERS.gkAdmin)), actorType };
    for (const operation of [grantOrganizationRole, revokeOrganizationRole]) {
      const result = await operation({ actorContext: nonHuman, organizationId: ORG_A, targetLegacyPublicUserdataId: USERS.mixed.legacy, roleName: "gk_reviewer", now: NOW }, store.dependencies);
      assert.equal(result.error.code, "authorization_denied", actorType);
    }
  }
  const gkAdmin = await resolveActor(store, USERS.gkAdmin);
  for (const operation of [grantOrganizationRole, revokeOrganizationRole]) {
    const result = await operation({ actorContext: gkAdmin, organizationId: ORG_A, targetLegacyPublicUserdataId: USERS.mixed.legacy, roleName: "gk_reviewer", now: NOW }, { ...store.dependencies, env: { KAI_SPRINT2_ENABLED: "false" } });
    assert.equal(result.error.code, "feature_disabled");
  }
  assert.deepEqual([store.state.writes, store.state.audits], [[], []]);
});

// --------------------------------------------------------------------------
// Effective-role readers
// --------------------------------------------------------------------------

test("readers: mixed active/inactive assignments - only active assignments authorize, across workspace, intake listing, capabilities, and P1-08", async () => {
  const store = createStore({
    memberships: [row(ORG_A, USERS.mixed, "client_admin"), row(ORG_A, USERS.mixed, "gk_operator", "inactive")],
    globalRoles: { [USERS.mixed.user_id]: ["gk_operator"] },
  });
  const mixed = await resolveActor(store, USERS.mixed);
  assert.deepEqual(mixed.organizationMemberships.map((membership) => [membership.role_name, membership.membership_status]), [["client_admin", "active"], ["gk_operator", "inactive"]]);
  assert.equal(validateActorCanPerformOperation(mixed, "manage_organization_membership", ORG_A, { allowedRoles: new Set(["client_admin"]) }).ok, true);
  assert.equal(authorizeSourcePromotionDecision(mixed, ORG_A).ok, false, "an inactive gk_operator assignment never authorizes P1-08");
  assert.deepEqual((await listAuthorizedOrganizations({ actorContext: mixed }, { env: ENV })).data.items, [{ organization_id: ORG_A }]);
  const capabilities = await getOrganizationAccessCapabilities({ organizationId: ORG_A, actorContext: mixed }, { env: ENV });
  assert.equal(capabilities.data.organizationAccessManagement, true);
});

test("readers: the retained J3-2 denial - global gk_reviewer with organization client_admin is not P1-08 promotion authority", async () => {
  const store = createStore({ memberships: [row(ORG_A, USERS.mixed, "client_admin")], globalRoles: { [USERS.mixed.user_id]: ["gk_reviewer"] } });
  const mixed = await resolveActor(store, USERS.mixed);
  const denied = authorizeSourcePromotionDecision(mixed, ORG_A);
  assert.deepEqual([denied.ok, denied.error.error.code, denied.error.blockers[0].blocking_reason], [false, "authorization_denied", "role_not_allowed"]);
});

test("readers: the governed path - superuser grants global gk_operator, a delegated GK administrator grants organization gk_operator, P1-08 admits the operator, and targeted revocation removes it", async () => {
  const store = standardStore();
  const superuser = await resolveActor(store, USERS.superuser, { superuser: true });
  const gkAdmin = await resolveActor(store, USERS.gkAdmin);
  assert.equal(authorizeSourcePromotionDecision(await resolveActor(store, USERS.operator), ORG_A).ok, false);

  await withRouter(superuser, store, async (call) => {
    assert.equal((await call("PUT", `${BASE}/global-roles/${USERS.operator.legacy}`, { role_name: "gk_operator", action: "assign" })).statusCode, 200);
  });
  const globalOnly = await resolveActor(store, USERS.operator);
  assert.equal(authorizeSourcePromotionDecision(globalOnly, ORG_A).ok, false, "the global role alone is not organization access");

  await withRouter(gkAdmin, store, async (call) => {
    assert.equal((await call("POST", grantPath(ORG_A, USERS.operator), { role_name: "gk_operator" })).statusCode, 200);
  });
  const operator = await resolveActor(store, USERS.operator);
  assert.equal(authorizeSourcePromotionDecision(operator, ORG_A).ok, true);
  assert.equal(validateActorCanPerformOperation(operator, "read_intake", ORG_A, { allowedRoles: new Set(["gk_admin", "gk_operator", "gk_reviewer"]), globalRolesOnly: true }).ok, true, "the P1-09 cockpit gate admits the operator");
  assert.equal(authorizeSourcePromotionDecision(operator, ORG_B).ok, false, "never another organization");

  await withRouter(gkAdmin, store, async (call) => {
    assert.equal((await call("POST", revokePath(ORG_A, USERS.operator, "gk_operator"), {})).statusCode, 200);
  });
  const revoked = await resolveActor(store, USERS.operator);
  assert.equal(authorizeSourcePromotionDecision(revoked, ORG_A).ok, false);
  assert.deepEqual(revoked.kaiRoles, ["gk_operator"], "organization revocation leaves the global role to its own governed operation");
});

test("readers: capabilities report organizationAccessManagement for a delegated GK administrator, and never for an organization- or global-only gk_admin", async () => {
  const store = standardStore();
  const answer = async (user) => {
    const result = await getOrganizationAccessCapabilities({ organizationId: ORG_A, actorContext: await resolveActor(store, user) }, { env: ENV });
    return result.ok ? result.data.organizationAccessManagement : result.error.code;
  };
  assert.equal(await answer(USERS.gkAdmin), true);
  assert.equal(await answer(USERS.clientAdmin), true);
  assert.equal(await answer(USERS.orgOnlyGkAdmin), false);
  assert.equal(await answer(USERS.globalOnlyGkAdmin), "authorization_denied");
});

test("roster readback: every assignment per person with its own status and this actor's permitted changes", async () => {
  const store = standardStore({ memberships: [row(ORG_A, USERS.operator, "gk_operator", "inactive")], derivedAdmins: [USERS.derivedAdmin] });
  const read = async (actor) => (await viewEffectiveKaiAccess({ actorContext: actor, organizationId: ORG_A }, store.dependencies)).data;

  const asGkAdmin = await read(await resolveActor(store, USERS.gkAdmin));
  assert.deepEqual(asGkAdmin.administrable_roles, ["gk_operator", "gk_reviewer"]);
  const mixed = asGkAdmin.access.find((entry) => entry.email === USERS.mixed.email);
  assert.equal(mixed.stored_membership, null, "no single stored membership for a person with several");
  assert.deepEqual(mixed.effective_role_names, ["client_contributor", "gk_reviewer"]);
  assert.deepEqual(mixed.stored_memberships.map((assignment) => [assignment.role_name, assignment.membership_status, assignment.replacement_roles, assignment.can_revoke]), [
    ["client_contributor", "active", [], false],
    ["gk_reviewer", "active", ["gk_operator"], true],
  ]);
  assert.deepEqual(mixed.grantable_roles, ["gk_operator"]);
  const operator = asGkAdmin.access.find((entry) => entry.email === USERS.operator.email);
  assert.deepEqual([operator.effective_membership_status, operator.effective_role_names, operator.stored_memberships[0].can_restore], ["inactive", [], true]);
  const self = asGkAdmin.access.find((entry) => entry.email === USERS.gkAdmin.email);
  assert.deepEqual([self.is_actor, self.grantable_roles, self.stored_memberships[0].can_revoke], [true, [], false]);
  const derived = asGkAdmin.access.find((entry) => entry.legacy_public_userdata_id === USERS.derivedAdmin.legacy);
  assert.deepEqual([derived.stored_memberships, derived.effective_role_names, derived.authority_source], [[], ["client_admin"], "derived"]);
  assert.equal(asGkAdmin.global_roles_visible, false);

  const asClientAdmin = await read(await resolveActor(store, USERS.clientAdmin));
  const mixedForClient = asClientAdmin.access.find((entry) => entry.email === USERS.mixed.email);
  assert.deepEqual(mixedForClient.stored_memberships.map((assignment) => [assignment.role_name, assignment.replacement_roles, assignment.can_revoke]), [
    ["client_contributor", ["client_admin", "client_reviewer"], true],
    ["gk_reviewer", [], false],
  ]);
  assert.deepEqual(mixedForClient.grantable_roles, ["client_admin", "client_reviewer"]);
  assert.deepEqual(projectTeamAccessRoster(asClientAdmin).find((member) => member.email === USERS.mixed.email).grantableRoles, [],
    "Team & Access adds Get Kinder staff roles only; client roles keep the one-role change control");

  // The Team & Access projection and request builders follow these answers.
  const members = projectTeamAccessRoster(asGkAdmin);
  const mixedMember = members.find((member) => member.email === USERS.mixed.email);
  assert.deepEqual([mixedMember.storedRole, mixedMember.roleOptions, mixedMember.canChangeRole], ["gk_reviewer", ["gk_reviewer", "gk_operator"], true]);
  assert.deepEqual(teamAccessRoleChangeRequest(ORG_A, mixedMember, "gk_operator").body, { role_name: "gk_operator", membership_status: "active", previous_role_name: "gk_reviewer" });
  assert.throws(() => teamAccessRoleChangeRequest(ORG_A, mixedMember, "client_admin"), /unsupported KAI organization role/);
  assert.equal(teamAccessRoleRevokeRequest(ORG_A, mixedMember, "gk_reviewer").path, revokePath(ORG_A, USERS.mixed, "gk_reviewer"));
  assert.throws(() => teamAccessRoleRevokeRequest(ORG_A, mixedMember, "client_contributor"), /unsupported KAI organization role/);
  assert.deepEqual(teamAccessRoleGrantRequest(ORG_A, mixedMember, "gk_operator"), { path: grantPath(ORG_A, USERS.mixed), body: { role_name: "gk_operator" } });
  assert.throws(() => teamAccessRoleGrantRequest(ORG_A, mixedMember, "gk_admin"), /unsupported KAI organization role/);
  const operatorMember = members.find((member) => member.email === USERS.operator.email);
  assert.deepEqual(teamAccessRoleGrantRequest(ORG_A, operatorMember, "gk_operator").body, { role_name: "gk_operator" }, "restoring an inactive assignment");
});

// --------------------------------------------------------------------------
// Repository SQL: each write addresses exactly one assignment.
// --------------------------------------------------------------------------

function recordingClient(existingRows) {
  const calls = [];
  return {
    calls,
    release: () => {},
    async query(text, params = []) {
      calls.push({ text: text.replace(/\s+/g, " ").trim(), params });
      if (/^SELECT organization_id, user_id, role_name, membership_status FROM kai\.organization_memberships/.test(calls.at(-1).text)) return { rows: existingRows };
      if (/RETURNING/.test(text)) return { rows: [{ organization_id: params[0], user_id: params[1], role_name: params[2], membership_status: "x" }] };
      return { rows: [] };
    },
  };
}

const writeCalls = (client) => client.calls.filter((call) => /^(INSERT|UPDATE)/.test(call.text));

test("SQL: a grant inserts or reactivates exactly that role's row and never another; an active row is a replay", async () => {
  const absent = recordingClient([{ organization_id: ORG_A, user_id: "u", role_name: "client_admin", membership_status: "active" }]);
  const inserted = await grantOrganizationMembershipRole({ organizationId: ORG_A, userId: "u", roleName: "gk_operator" }, absent);
  assert.deepEqual([inserted.mutated, inserted.hadActiveAccess], [true, true]);
  assert.match(writeCalls(absent)[0].text, /^INSERT INTO kai\.organization_memberships \(organization_id, user_id, role_name, membership_status\) VALUES \(\$1, \$2, \$3, 'active'\)/);
  assert.deepEqual(writeCalls(absent)[0].params, [ORG_A, "u", "gk_operator"]);

  const inactive = recordingClient([{ organization_id: ORG_A, user_id: "u", role_name: "gk_operator", membership_status: "inactive" }]);
  const reactivated = await grantOrganizationMembershipRole({ organizationId: ORG_A, userId: "u", roleName: "gk_operator" }, inactive);
  assert.deepEqual([reactivated.mutated, reactivated.hadActiveAccess], [true, false]);
  assert.match(writeCalls(inactive)[0].text, /^UPDATE kai\.organization_memberships SET membership_status = 'active' WHERE organization_id = \$1 AND user_id = \$2 AND role_name = \$3/);

  const active = recordingClient([{ organization_id: ORG_A, user_id: "u", role_name: "gk_operator", membership_status: "active" }]);
  assert.equal((await grantOrganizationMembershipRole({ organizationId: ORG_A, userId: "u", roleName: "gk_operator" }, active)).replay, true);
  assert.deepEqual(writeCalls(active), []);
  for (const client of [absent, inactive, active]) {
    assert.match(client.calls[0].text, /^SELECT pg_advisory_xact_lock/);
    assert.deepEqual(client.calls[0].params, [`kai_org_membership:${ORG_A}:u`]);
  }
});

test("SQL: a revocation soft-updates only the active row of that role (never DELETE), replays an inactive one, and reports an absent one", async () => {
  const both = recordingClient([
    { organization_id: ORG_A, user_id: "u", role_name: "client_contributor", membership_status: "active" },
    { organization_id: ORG_A, user_id: "u", role_name: "gk_reviewer", membership_status: "active" },
  ]);
  const revoked = await revokeOrganizationMembershipRole({ organizationId: ORG_A, userId: "u", roleName: "gk_reviewer" }, both);
  assert.deepEqual([revoked.mutated, revoked.remainingActiveRoleNames], [true, ["client_contributor"]]);
  assert.match(writeCalls(both)[0].text, /^UPDATE kai\.organization_memberships SET membership_status = 'inactive' WHERE organization_id = \$1 AND user_id = \$2 AND role_name = \$3 AND membership_status = 'active'/);
  assert.ok(both.calls.every((call) => !/DELETE/.test(call.text)));

  const inactive = recordingClient([{ organization_id: ORG_A, user_id: "u", role_name: "gk_reviewer", membership_status: "inactive" }]);
  assert.equal((await revokeOrganizationMembershipRole({ organizationId: ORG_A, userId: "u", roleName: "gk_reviewer" }, inactive)).replay, true);
  assert.deepEqual(writeCalls(inactive), []);
  const absent = recordingClient([]);
  assert.equal((await revokeOrganizationMembershipRole({ organizationId: ORG_A, userId: "u", roleName: "gk_reviewer" }, absent)).notFound, true);
  assert.deepEqual(writeCalls(absent), []);
});

test("SQL: a named replacement updates only the named row; a missing name, an ambiguous target, or a role already held is a conflict", async () => {
  const rows = [
    { organization_id: ORG_A, user_id: "u", role_name: "client_contributor", membership_status: "active" },
    { organization_id: ORG_A, user_id: "u", role_name: "gk_reviewer", membership_status: "active" },
  ];
  const named = recordingClient(rows);
  const result = await upsertOrganizationMembershipRoleStatus({ organizationId: ORG_A, userId: "u", roleName: "gk_operator", membershipStatus: "active", previousRoleName: "gk_reviewer" }, named);
  assert.equal(result.mutated, true);
  assert.deepEqual(writeCalls(named)[0].params, [ORG_A, "u", "gk_operator", "active", "gk_reviewer"]);
  for (const [input, label] of [
    [{ roleName: "gk_operator", membershipStatus: "active" }, "ambiguous"],
    [{ roleName: "gk_operator", membershipStatus: "active", previousRoleName: "client_admin" }, "missing"],
    [{ roleName: "client_contributor", membershipStatus: "active", previousRoleName: "gk_reviewer" }, "held"],
  ]) {
    const client = recordingClient(rows);
    const conflict = await upsertOrganizationMembershipRoleStatus({ organizationId: ORG_A, userId: "u", ...input }, client);
    assert.equal(conflict.conflict, true, label);
    assert.deepEqual(writeCalls(client), [], label);
  }
});
