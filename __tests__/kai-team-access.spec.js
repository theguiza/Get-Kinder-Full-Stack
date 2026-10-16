import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { readFileSync } from "node:fs";

import accessAdministrationRouter, { __testables } from "../Backend/kai/routes/kaiAccessAdministrationApi.js";
import {
  viewEffectiveKaiAccess,
  manageOrganizationMembership,
  grantOrganizationRole,
  revokeOrganizationRole,
  manageGlobalKaiRole,
} from "../Backend/kai/services/kaiAccessAdministrationService.js";
import {
  approveOrganizationJoinRequest,
  declineOrganizationJoinRequest,
  listPendingOrganizationJoinRequestsForReviewer,
} from "../Backend/kai/services/kaiOrganizationJoinRequestReviewService.js";
import { getOrganizationAccessCapabilities } from "../Backend/kai/services/kaiOrganizationAccessCapabilitiesService.js";
import { resolveKaiActorContext } from "../Backend/kai/auth/kaiActorContext.js";
import { projectOrganizationAccessCapabilities } from "../frontend/impactEvidenceLibraryLogic.js";
import {
  TEAM_ACCESS_ROLE_OPTIONS,
  TEAM_ACCESS_SECTION_KEY,
  describeMemberAuthority,
  describeRoleChangeError,
  describeTeamAccessReadError,
  effectiveAdministratorCount,
  memberDisplayName,
  projectTeamAccessRoster,
  roleChangeBlockedAsLastAdministrator,
  roleChangeRemovesAdministrator,
  teamAccessAccountStatusLabel,
  teamAccessErrorFromResult,
  teamAccessRoleChangeRequest,
  teamAccessRoleLabel,
  teamAccessRosterPath,
} from "../frontend/teamAccess/teamAccessLogic.js";
import { kaiOrganizationJoinRequestDecisionPath } from "../frontend/kaiOrganizationJoinLogic.js";

/**
 * Team & Access (Impact Library). The real access-administration router,
 * the real kaiAccessAdministrationService / JOIN-3 review service, the real
 * validateActorCanPerformOperation, and the real access-capabilities service
 * decide every answer here. Only the repository reads/writes are an
 * in-memory synthetic store. The Impact Library's own Team & Access helpers
 * interpret those real HTTP responses exactly as useTeamAccess does.
 */

const ENV = { KAI_SPRINT2_ENABLED: "true" };
const NOW = "2026-10-12T00:00:00.000Z";
const BASE = "/api/kai/sprint2/access-administration";
const ORG_A = "00000000-0000-4000-8000-0000000000aa";
const ORG_B = "00000000-0000-4000-8000-0000000000bb";
const GK_ORG_A = 4201;
const REQUEST_ID = "00000000-0000-4000-8000-000000000301";

const appSource = readFileSync("frontend/ImpactLibraryApp.jsx", "utf8");
const shellSource = readFileSync("frontend/impactLibraryShell.jsx", "utf8");
const viewSource = readFileSync("frontend/teamAccess/TeamAccessView.jsx", "utf8");
const hookSource = readFileSync("frontend/teamAccess/useTeamAccess.js", "utf8");
const adminSource = readFileSync("frontend/adminDashboard.jsx", "utf8");

const USERS = Object.freeze({
  legacyAdmin: { user_id: "90000000-0000-4000-8000-000000000101", legacy: 101, email: "legacy-admin@synthetic.test" },
  storedAdmin: { user_id: "90000000-0000-4000-8000-000000000102", legacy: 102, email: "stored-admin@synthetic.test" },
  reviewer: { user_id: "90000000-0000-4000-8000-000000000103", legacy: 103, email: "reviewer@synthetic.test" },
  contributor: { user_id: "90000000-0000-4000-8000-000000000104", legacy: 104, email: "contributor@synthetic.test" },
  otherOrgAdmin: { user_id: "90000000-0000-4000-8000-000000000105", legacy: 105, email: "other-admin@synthetic.test" },
  gkStaff: { user_id: "90000000-0000-4000-8000-000000000106", legacy: 106, email: "gk-staff@synthetic.test" },
  requester: { user_id: "90000000-0000-4000-8000-000000000107", legacy: 107, email: "requester@synthetic.test" },
  bothAdmin: { user_id: "90000000-0000-4000-8000-000000000108", legacy: 108, email: "both-admin@synthetic.test" },
  secondAdmin: { user_id: "90000000-0000-4000-8000-000000000109", legacy: 109, email: "second-admin@synthetic.test" },
});

const actor = (user, organizationMemberships, extra = {}) => ({
  actorType: "human",
  actorUserId: user.user_id,
  legacyPublicUserdataId: user.legacy,
  kaiRoles: [],
  organizationMemberships,
  platformSuperuser: false,
  ...extra,
});
const member = (organizationId, roleName, extra = {}) => ({ organization_id: organizationId, role_name: roleName, membership_status: "active", ...extra });
const derivedAdmin = (organizationId) => member(organizationId, "client_admin", { source: "gk_organization_binding", gk_organization_id: GK_ORG_A });

const ACTORS = Object.freeze({
  legacyAdmin: actor(USERS.legacyAdmin, [derivedAdmin(ORG_A)]),
  storedAdmin: actor(USERS.storedAdmin, [member(ORG_A, "client_admin")]),
  reviewer: actor(USERS.reviewer, [member(ORG_A, "client_reviewer")]),
  contributor: actor(USERS.contributor, [member(ORG_A, "client_contributor")]),
  otherOrgAdmin: actor(USERS.otherOrgAdmin, [member(ORG_B, "client_admin")]),
  // Administrator of Org A, contributor of Org B.
  multiOrg: actor(USERS.storedAdmin, [member(ORG_A, "client_admin"), member(ORG_B, "client_contributor")]),
  siteAdmin: actor(USERS.gkStaff, [], { platformSuperuser: true, platformSuperuserAuthority: "get_kinder_site_admin" }),
  globalGkAdminOnly: actor(USERS.gkStaff, [], { kaiRoles: ["gk_admin"] }),
});

/**
 * In-memory synthetic repository behind the real services. Stored
 * memberships, GK->KAI bindings, GK organization admins, kai.users account
 * status (`accounts`: legacy id -> status, or null for never provisioned;
 * everyone else active), and audits. The last-admin helpers count only an
 * active account, as the real ones do.
 */
function createStore({ memberships = [], bindings = { [ORG_A]: GK_ORG_A }, gkAdmins = { [GK_ORG_A]: [USERS.legacyAdmin.legacy] }, accounts = {} } = {}) {
  const state = {
    accounts: { ...accounts },
    memberships: memberships.map((row) => ({ ...row })),
    audits: [],
    upserts: [],
    globalRoleWrites: [],
    joinDecisions: [],
  };
  const userByLegacy = (legacy) => Object.values(USERS).find((user) => user.legacy === legacy) || null;
  const userById = (userId) => Object.values(USERS).find((user) => user.user_id === userId) || null;
  const rowsFor = (organizationId, userId) => state.memberships.filter((row) => row.organization_id === organizationId && row.user_id === userId);
  const kaiUserOf = (user) => {
    if (!user || state.accounts[user.legacy] === null) return null;
    const status = state.accounts[user.legacy] ?? "active";
    return { user_id: user.user_id, legacy_identity_source: "public.userdata", legacy_public_userdata_id: user.legacy, email: user.email, status };
  };
  const accountActive = (user) => kaiUserOf(user)?.status === "active";

  const dependencies = {
    env: ENV,
    runInTransaction: async (callback) => callback({ query: async () => ({ rows: [] }) }),
    listOrganizationMembershipRowsForOrganization: async (organizationId) => state.memberships
      .filter((row) => row.organization_id === organizationId)
      .map((row) => {
        const kaiUser = kaiUserOf(userById(row.user_id));
        return {
          ...row,
          legacy_identity_source: kaiUser?.legacy_identity_source ?? null,
          legacy_public_userdata_id: kaiUser?.legacy_public_userdata_id ?? null,
          email: kaiUser?.email ?? null,
          kai_user_status: kaiUser?.status ?? null,
        };
      }),
    listOrganizationMembershipRowsForUserInOrganization: async (organizationId, userId) => rowsFor(organizationId, userId).map((row) => ({ ...row })),
    countActiveStoredClientAdminMemberships: async (organizationId, _tx, { excludingUserId = null } = {}) => state.memberships
      .filter((row) => row.organization_id === organizationId && row.role_name === "client_admin" && row.membership_status === "active" && row.user_id !== excludingUserId)
      .filter((row) => accountActive(userById(row.user_id)))
      .length,
    getActiveGkOrganizationIdForKaiOrganization: async (organizationId) => bindings[organizationId] ?? null,
    listActiveGkOrganizationAdminLegacyUserIds: async (gkOrganizationId) => gkAdmins[gkOrganizationId] || [],
    hasActiveDerivedClientAdminForOrganization: async (organizationId) => Boolean(bindings[organizationId]) &&
      (gkAdmins[bindings[organizationId]] || []).some((legacy) => accountActive(userByLegacy(legacy))),
    findKaiUserByLegacyPublicUserdataId: async (legacy) => kaiUserOf(userByLegacy(legacy)),
    findOrCreateKaiUserByLegacyPublicUserdataId: async ({ legacyPublicUserdataId }) => {
      const user = userByLegacy(legacyPublicUserdataId);
      return user ? { user_id: user.user_id, legacy_public_userdata_id: user.legacy, status: "active" } : null;
    },
    listKaiRolesForUser: async (userId) => (userId === USERS.gkStaff.user_id ? ["gk_reviewer"] : []),
    upsertOrganizationMembershipRoleStatus: async ({ organizationId, userId, roleName, membershipStatus, previousRoleName = null }) => {
      state.upserts.push({ organizationId, userId, roleName, membershipStatus, ...(previousRoleName === null ? {} : { previousRoleName }) });
      const existing = rowsFor(organizationId, userId);
      if (previousRoleName === null && existing.length > 1) return { conflict: true, mutated: false };
      const target = previousRoleName === null ? existing[0] : existing.find((row) => row.role_name === previousRoleName);
      if (previousRoleName !== null && !target) return { conflict: true, mutated: false };
      if (target && target.role_name !== roleName && existing.some((row) => row.role_name === roleName)) return { conflict: true, mutated: false };
      const previousRow = target ? { ...target } : null;
      if (previousRow && previousRow.role_name === roleName && previousRow.membership_status === membershipStatus) {
        return { previousRow, newRow: previousRow, mutated: false, replay: true };
      }
      if (target) Object.assign(target, { role_name: roleName, membership_status: membershipStatus });
      else state.memberships.push({ organization_id: organizationId, user_id: userId, role_name: roleName, membership_status: membershipStatus });
      return { previousRow, newRow: { organization_id: organizationId, user_id: userId, role_name: roleName, membership_status: membershipStatus }, mutated: true };
    },
    grantOrganizationMembershipRole: async ({ organizationId, userId, roleName }) => {
      state.upserts.push({ organizationId, userId, roleName, grant: true });
      const existing = rowsFor(organizationId, userId);
      const hadActiveAccess = existing.some((row) => row.membership_status === "active");
      const target = existing.find((row) => row.role_name === roleName);
      const previousRow = target ? { ...target } : null;
      if (target?.membership_status === "active") return { previousRow, newRow: previousRow, mutated: false, replay: true, hadActiveAccess };
      if (target) target.membership_status = "active";
      else state.memberships.push({ organization_id: organizationId, user_id: userId, role_name: roleName, membership_status: "active" });
      return { previousRow, newRow: { organization_id: organizationId, user_id: userId, role_name: roleName, membership_status: "active" }, mutated: true, replay: false, hadActiveAccess };
    },
    revokeOrganizationMembershipRole: async ({ organizationId, userId, roleName }) => {
      state.upserts.push({ organizationId, userId, roleName, revoke: true });
      const existing = rowsFor(organizationId, userId);
      const target = existing.find((row) => row.role_name === roleName);
      const remainingActiveRoleNames = existing.filter((row) => row !== target && row.membership_status === "active").map((row) => row.role_name);
      if (!target) return { notFound: true, mutated: false, remainingActiveRoleNames };
      const previousRow = { ...target };
      if (target.membership_status !== "active") return { previousRow, newRow: previousRow, mutated: false, replay: true, remainingActiveRoleNames };
      target.membership_status = "inactive";
      return { previousRow, newRow: { ...target }, mutated: true, replay: false, remainingActiveRoleNames };
    },
    createProductionMetadataOnlyAuditForAccessAdministration: ({ organizationId }) => ({
      prepareMetadataOnlyAudit: ({ payload }) => ({
        ok: true,
        publish: async () => {
          state.audits.push({ organizationId, ...payload });
          return { ok: true };
        },
      }),
    }),
    listGlobalRoleAssignmentRows: async () => [],
    assignGlobalRole: async (input) => {
      state.globalRoleWrites.push(input);
      return { mutated: true };
    },
    revokeGlobalRole: async (input) => {
      state.globalRoleWrites.push(input);
      return { mutated: true };
    },
    // JOIN-3 review seams.
    listPendingOrganizationJoinRequestsForReview: async ({ organizationId }) => (organizationId === ORG_A
      ? [{ organization_join_request_id: REQUEST_ID, organization_id: ORG_A, requester_user_id: USERS.requester.user_id, requester_email: USERS.requester.email, status: "pending", created_at: NOW }]
      : []),
    getOrganizationJoinRequestForDecisionForUpdate: async ({ organizationJoinRequestId }) => (organizationJoinRequestId === REQUEST_ID
      ? {
        organization_join_request_id: REQUEST_ID,
        organization_id: ORG_A,
        requester_user_id: USERS.requester.user_id,
        requester_legacy_public_userdata_id: USERS.requester.legacy,
        requester_kai_user_status: "active",
        status: "pending",
      }
      : null),
    recordOrganizationJoinRequestDecision: async (input) => {
      state.joinDecisions.push(input);
      return { ok: true, joinRequest: { organization_join_request_id: REQUEST_ID, organization_id: ORG_A, status: input.decision, reviewed_at: NOW } };
    },
    insertRequiredSuccessfulAuditEvent: async (payload) => {
      state.audits.push(payload);
      return { ok: true };
    },
  };
  return { state, dependencies };
}

function standardMemberships() {
  return [
    member(ORG_A, "client_admin", { user_id: USERS.storedAdmin.user_id }),
    member(ORG_A, "client_reviewer", { user_id: USERS.reviewer.user_id }),
    member(ORG_A, "client_contributor", { user_id: USERS.contributor.user_id }),
    member(ORG_A, "gk_reviewer", { user_id: USERS.gkStaff.user_id }),
    member(ORG_B, "client_admin", { user_id: USERS.otherOrgAdmin.user_id }),
    member(ORG_B, "client_contributor", { user_id: USERS.reviewer.user_id }),
  ];
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
    listPendingOrganizationJoinRequestsForReviewer: (input) => listPendingOrganizationJoinRequestsForReviewer(input, dependencies),
    approveOrganizationJoinRequest: (input) => approveOrganizationJoinRequest(input, dependencies),
    declineOrganizationJoinRequest: (input) => declineOrganizationJoinRequest(input, dependencies),
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
  // Same { statusCode, body } shape as the Impact Library's getJson/putJson.
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

async function capabilitiesFor(actorContext, organizationId) {
  const result = await getOrganizationAccessCapabilities({ organizationId, actorContext }, { env: ENV });
  return result.ok ? projectOrganizationAccessCapabilities(result.data) : result;
}

async function roster(call, organizationId = ORG_A) {
  const result = await call("GET", teamAccessRosterPath(organizationId));
  assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  return projectTeamAccessRoster(result.body.data);
}

const byEmail = (members, email) => members.find((entry) => entry.email === email);

async function changeRole(call, members, email, roleName, organizationId = ORG_A) {
  const request = teamAccessRoleChangeRequest(organizationId, byEmail(members, email), roleName);
  return call("PUT", request.path, request.body);
}

// --------------------------------------------------------------------------
// 1-4. Who may manage access.
// --------------------------------------------------------------------------

test("1. an initial legacy NPO administrator with an active KAI binding resolves to client_admin and can manage access", async () => {
  const resolved = await resolveKaiActorContext({ id: USERS.legacyAdmin.legacy, email: USERS.legacyAdmin.email }, {
    findOrCreateKaiUserByLegacyPublicUserdataId: async () => ({
      user_id: USERS.legacyAdmin.user_id, legacy_identity_source: "public.userdata", legacy_public_userdata_id: USERS.legacyAdmin.legacy, status: "active",
    }),
    listKaiRolesForUser: async () => [],
    listOrganizationMembershipsForUser: async () => [],
    resolveOrgScopeForUserId: async () => ({ memberships: [{ orgId: GK_ORG_A, role: "admin", is_active: true }] }),
    listActiveGkOrganizationBindingsForGkOrganizationIds: async () => [{ gk_organization_id: GK_ORG_A, kai_organization_id: ORG_A, status: "active" }],
  });
  assert.equal(resolved.ok, true);
  const actorContext = resolved.actorContext;
  assert.equal(actorContext.platformSuperuser, false);
  assert.deepEqual(actorContext.organizationMemberships.map((m) => [m.organization_id, m.role_name, m.source]), [[ORG_A, "client_admin", "gk_organization_binding"]]);
  assert.equal((await capabilitiesFor(actorContext, ORG_A)).organizationAccessManagement, true);

  const store = createStore({ memberships: standardMemberships() });
  await withRouter(actorContext, store, async (call) => {
    const members = await roster(call);
    const self = byEmail(members, USERS.legacyAdmin.email);
    assert.equal(self.effectiveRole, "client_admin");
    assert.equal(self.authoritySource, "derived");
    const result = await changeRole(call, members, USERS.contributor.email, "client_reviewer");
    assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  });

  // The same Get Kinder admin whose binding is inactive gets nothing.
  const unbound = await resolveKaiActorContext({ id: USERS.legacyAdmin.legacy, email: USERS.legacyAdmin.email }, {
    findOrCreateKaiUserByLegacyPublicUserdataId: async () => ({
      user_id: USERS.legacyAdmin.user_id, legacy_identity_source: "public.userdata", legacy_public_userdata_id: USERS.legacyAdmin.legacy, status: "active",
    }),
    listKaiRolesForUser: async () => [],
    listOrganizationMembershipsForUser: async () => [],
    resolveOrgScopeForUserId: async () => ({ memberships: [{ orgId: GK_ORG_A, role: "admin", is_active: true }] }),
    listActiveGkOrganizationBindingsForGkOrganizationIds: async () => [{ gk_organization_id: GK_ORG_A, kai_organization_id: ORG_A, status: "inactive" }],
  });
  assert.deepEqual(unbound.actorContext.organizationMemberships, []);
  assert.equal((await capabilitiesFor(unbound.actorContext, ORG_A)).error.code, "authorization_denied");
});

test("2. a stored client_admin is offered Team & Access and can read the roster and change roles", async () => {
  assert.equal((await capabilitiesFor(ACTORS.storedAdmin, ORG_A)).organizationAccessManagement, true);
  const store = createStore({ memberships: standardMemberships() });
  await withRouter(ACTORS.storedAdmin, store, async (call) => {
    const members = await roster(call);
    assert.deepEqual(members.map((m) => [m.email, m.effectiveRole]), [
      [USERS.legacyAdmin.email, "client_admin"],
      [USERS.storedAdmin.email, "client_admin"],
      [USERS.reviewer.email, "client_reviewer"],
      [USERS.contributor.email, "client_contributor"],
      [USERS.gkStaff.email, "gk_reviewer"],
    ]);
    assert.equal(effectiveAdministratorCount(members), 2);
    // Global KAI roles are never in an organization administrator's roster.
    const raw = await call("GET", teamAccessRosterPath(ORG_A));
    assert.equal(raw.body.data.global_roles_visible, false);
    assert.ok(raw.body.data.access.every((row) => row.global_kai_roles === undefined));
  });
});

test("3-4. client_reviewer and client_contributor are not offered Team & Access and the API refuses them", async () => {
  for (const name of ["reviewer", "contributor"]) {
    const capabilities = await capabilitiesFor(ACTORS[name], ORG_A);
    assert.equal(capabilities.organizationAccessManagement, false, name);
    const store = createStore({ memberships: standardMemberships() });
    await withRouter(ACTORS[name], store, async (call) => {
      const read = await call("GET", teamAccessRosterPath(ORG_A));
      assert.equal(read.statusCode, 403, name);
      assert.equal(read.body.data, null, `${name} receives no roster data`);
      assert.doesNotMatch(JSON.stringify(read.body), /kai_account_status|effective_admin_authority|last_admin_protected/, `${name}: no administrator status`);
      assert.match(describeTeamAccessReadError(teamAccessErrorFromResult(read)), /do not have permission/);
      const write = await call("PUT", `${BASE}/organizations/${ORG_A}/memberships/${USERS.contributor.legacy}`, { role_name: "client_admin", membership_status: "active" });
      assert.equal(write.statusCode, 403, name);
      assert.match(describeRoleChangeError(teamAccessErrorFromResult(write)), /do not have permission/);
      const join = await call("POST", kaiOrganizationJoinRequestDecisionPath(ORG_A, REQUEST_ID, "approve"), {});
      assert.equal(join.statusCode, 403, name);
    });
    assert.deepEqual(store.state.upserts, [], `${name}: nothing written`);
    assert.deepEqual(store.state.audits, []);
  }
});

// --------------------------------------------------------------------------
// 5-6. Role changes.
// --------------------------------------------------------------------------

test("5. an administrator assigns client_reviewer to an eligible member through the existing membership route, with its audit", async () => {
  const store = createStore({ memberships: standardMemberships() });
  await withRouter(ACTORS.storedAdmin, store, async (call) => {
    const before = await roster(call);
    const contributor = byEmail(before, USERS.contributor.email);
    assert.equal(contributor.canChangeRole, true);
    const request = teamAccessRoleChangeRequest(ORG_A, contributor, "client_reviewer");
    assert.equal(request.path, `${BASE}/organizations/${ORG_A}/memberships/${USERS.contributor.legacy}`);
    assert.deepEqual(request.body, { role_name: "client_reviewer", membership_status: "active", previous_role_name: "client_contributor" });
    const result = await call("PUT", request.path, request.body);
    assert.equal(result.statusCode, 200);
    assert.equal(byEmail(await roster(call), USERS.contributor.email).effectiveRole, "client_reviewer");
  });
  assert.deepEqual(store.state.audits.map((a) => [a.attempted_operation, a.previous_role_name, a.resulting_role_name, a.organizationId, a.authority_source]), [
    ["organization_role_replaced", "client_contributor", "client_reviewer", ORG_A, "organization_client_admin"],
  ]);
});

test("6. an administrator appoints an additional client_admin, and that new administrator can then manage access", async () => {
  const store = createStore({ memberships: standardMemberships() });
  await withRouter(ACTORS.storedAdmin, store, async (call) => {
    const result = await changeRole(call, await roster(call), USERS.reviewer.email, "client_admin");
    assert.equal(result.statusCode, 200);
    const members = await roster(call);
    assert.equal(byEmail(members, USERS.reviewer.email).effectiveRole, "client_admin");
    assert.equal(effectiveAdministratorCount(members), 3);
  });
  const promoted = actor(USERS.reviewer, [member(ORG_A, "client_admin")]);
  assert.equal((await capabilitiesFor(promoted, ORG_A)).organizationAccessManagement, true);
  await withRouter(promoted, store, async (call) => {
    assert.equal((await call("GET", teamAccessRosterPath(ORG_A))).statusCode, 200);
  });
});

test("only the three client roles can be chosen or sent; anything else is refused before any write", async () => {
  assert.deepEqual([...TEAM_ACCESS_ROLE_OPTIONS], ["client_admin", "client_reviewer", "client_contributor"]);
  assert.deepEqual(TEAM_ACCESS_ROLE_OPTIONS.map(teamAccessRoleLabel), ["Administrator", "Reviewer", "Contributor"]);
  const anyMember = { legacyUserId: 104 };
  for (const role of ["gk_admin", "gk_operator", "gk_reviewer", "platform_superuser", ""]) {
    assert.throws(() => teamAccessRoleChangeRequest(ORG_A, anyMember, role), /unsupported KAI organization role/);
  }
  const store = createStore({ memberships: standardMemberships() });
  await withRouter(ACTORS.storedAdmin, store, async (call) => {
    for (const role of ["gk_admin", "gk_operator", "gk_reviewer", "platform_superuser"]) {
      const result = await call("PUT", `${BASE}/organizations/${ORG_A}/memberships/${USERS.contributor.legacy}`, { role_name: role, membership_status: "active" });
      // A Get Kinder role is refused as not client-managed (as by the grant
      // route); an unknown role name is a validation blocker.
      assert.equal(result.statusCode, role === "platform_superuser" ? 422 : 403, role);
    }
  });
  assert.deepEqual(store.state.upserts, []);
});

// --------------------------------------------------------------------------
// 7. Join requests.
// --------------------------------------------------------------------------

test("7. join-request approval from Team & Access keeps the server-fixed client_contributor result", async () => {
  const store = createStore({ memberships: standardMemberships() });
  await withRouter(ACTORS.legacyAdmin, store, async (call) => {
    const queue = await call("GET", `${BASE}/organizations/${ORG_A}/join-requests`);
    assert.equal(queue.statusCode, 200);
    assert.equal(queue.body.data.items.length, 1);
    // A role in the body is refused: the browser never chooses the role.
    const withRole = await call("POST", kaiOrganizationJoinRequestDecisionPath(ORG_A, REQUEST_ID, "approve"), { role_name: "client_admin" });
    assert.equal(withRole.statusCode, 422);
    const approved = await call("POST", kaiOrganizationJoinRequestDecisionPath(ORG_A, REQUEST_ID, "approve"), {});
    assert.equal(approved.statusCode, 200, JSON.stringify(approved.body));
    const joined = byEmail(await roster(call), USERS.requester.email);
    assert.equal(joined.effectiveRole, "client_contributor");
    assert.equal(joined.authoritySource, "stored");
  });
  assert.deepEqual(store.state.upserts, [{ organizationId: ORG_A, userId: USERS.requester.user_id, roleName: "client_contributor", membershipStatus: "active" }]);
});

// --------------------------------------------------------------------------
// 8-9. Organization boundary and GK roles.
// --------------------------------------------------------------------------

test("8. another organization's administrator can neither see nor change this organization's team, and an administrator cannot reach another organization", async () => {
  const denied = await getOrganizationAccessCapabilities({ organizationId: ORG_A, actorContext: ACTORS.otherOrgAdmin }, { env: ENV });
  assert.equal(denied.ok, false);
  assert.equal(denied.blockers[0].validator_key, "VAL-AUT-003");

  const store = createStore({ memberships: standardMemberships() });
  await withRouter(ACTORS.otherOrgAdmin, store, async (call) => {
    const read = await call("GET", teamAccessRosterPath(ORG_A));
    assert.equal(read.statusCode, 403);
    assert.ok(!JSON.stringify(read.body).includes(USERS.contributor.email), "no Org A member leaks");
    const write = await call("PUT", `${BASE}/organizations/${ORG_A}/memberships/${USERS.contributor.legacy}`, { role_name: "client_admin", membership_status: "active" });
    assert.equal(write.statusCode, 403);
    assert.equal((await call("GET", `${BASE}/organizations/${ORG_A}/join-requests`)).statusCode, 403);
  });
  await withRouter(ACTORS.storedAdmin, store, async (call) => {
    assert.equal((await call("GET", teamAccessRosterPath(ORG_B))).statusCode, 403);
    const write = await call("PUT", `${BASE}/organizations/${ORG_B}/memberships/${USERS.otherOrgAdmin.legacy}`, { role_name: "client_contributor", membership_status: "active" });
    assert.equal(write.statusCode, 403);
  });
  assert.deepEqual(store.state.upserts, []);
  assert.deepEqual(store.state.audits, []);
  assert.deepEqual(store.state.memberships, standardMemberships());
});

test("9. client administrators cannot grant GK global roles or rewrite a stored Get Kinder staff membership; the platform superuser still can", async () => {
  const store = createStore({ memberships: standardMemberships() });
  for (const name of ["storedAdmin", "legacyAdmin"]) {
    await withRouter(ACTORS[name], store, async (call) => {
      for (const roleName of ["gk_admin", "gk_operator", "gk_reviewer"]) {
        const result = await call("PUT", `${BASE}/global-roles/${USERS.contributor.legacy}`, { role_name: roleName, action: "assign" });
        assert.equal(result.statusCode, 403, `${name} ${roleName}`);
      }
      const members = await roster(call);
      const staff = byEmail(members, USERS.gkStaff.email);
      assert.equal(staff.canChangeRole, false, "a stored GK staff membership is not offered for change");
      assert.equal(teamAccessRoleLabel(staff.effectiveRole), "Get Kinder reviewer");
      assert.deepEqual([staff.grantableRoles.includes("gk_reviewer"), staff.assignments[0].canRevoke], [false, false], "no GK role is offered to a client administrator");
      assert.equal(staff.effectiveAdmin, false);
      assert.equal(staff.lastAdminProtected, false);
      // Direct API attempt: refused by the service, no write.
      const rewrite = await call("PUT", `${BASE}/organizations/${ORG_A}/memberships/${USERS.gkStaff.legacy}`, { role_name: "client_contributor", membership_status: "active" });
      assert.equal(rewrite.statusCode, 403, name);
      assert.equal(rewrite.body.blockers[0].blocking_reason, "non_client_membership_not_client_managed");
      assert.match(describeRoleChangeError(teamAccessErrorFromResult(rewrite)), /Get Kinder manages this person's access/);
    });
  }
  assert.deepEqual(store.state.upserts, []);
  assert.deepEqual(store.state.globalRoleWrites, []);

  // The existing Get Kinder superuser administration is unchanged.
  await withRouter(ACTORS.siteAdmin, store, async (call) => {
    const raw = await call("GET", teamAccessRosterPath(ORG_A));
    assert.equal(raw.body.data.global_roles_visible, true);
    assert.equal(raw.body.data.access.find((row) => row.email === USERS.gkStaff.email).editable, true);
    const rewrite = await call("PUT", `${BASE}/organizations/${ORG_A}/memberships/${USERS.gkStaff.legacy}`, { role_name: "client_contributor", membership_status: "active" });
    assert.equal(rewrite.statusCode, 200);
    const global = await call("PUT", `${BASE}/global-roles/${USERS.contributor.legacy}`, { role_name: "gk_reviewer", action: "assign" });
    assert.equal(global.statusCode, 200);
  });
  assert.equal(store.state.globalRoleWrites.length, 1);
});

// --------------------------------------------------------------------------
// 10-11. Last administrator and derived authority.
// --------------------------------------------------------------------------

test("10. the last effective administrator cannot be removed, by the UI or by a direct request", async () => {
  // No GK binding: the stored admin is the organization's only administrator.
  const store = createStore({ memberships: standardMemberships(), bindings: {}, gkAdmins: {} });
  await withRouter(ACTORS.storedAdmin, store, async (call) => {
    const members = await roster(call);
    const self = byEmail(members, USERS.storedAdmin.email);
    assert.equal(effectiveAdministratorCount(members), 1);
    assert.equal(self.lastAdminProtected, true);
    assert.equal(roleChangeBlockedAsLastAdministrator(self, "client_contributor"), true);
    assert.equal(roleChangeRemovesAdministrator(self, "client_contributor"), true);
    const result = await changeRole(call, members, USERS.storedAdmin.email, "client_contributor");
    assert.equal(result.statusCode, 409);
    assert.equal(result.body.error.code, "last_admin_protection");
    assert.match(describeRoleChangeError(teamAccessErrorFromResult(result)), /not made\. No other administrator can currently manage this organization/);
    const deactivate = await call("PUT", `${BASE}/organizations/${ORG_A}/memberships/${USERS.storedAdmin.legacy}`, { role_name: "client_admin", membership_status: "inactive" });
    assert.equal(deactivate.statusCode, 409);
  });
  assert.equal(store.state.audits.length, 0);
  assert.equal(store.state.memberships.find((row) => row.user_id === USERS.storedAdmin.user_id).role_name, "client_admin");

  // With a second administrator appointed first, the change is allowed.
  await withRouter(ACTORS.storedAdmin, store, async (call) => {
    assert.equal((await changeRole(call, await roster(call), USERS.reviewer.email, "client_admin")).statusCode, 200);
    assert.equal((await changeRole(call, await roster(call), USERS.storedAdmin.email, "client_contributor")).statusCode, 200);
    assert.equal(effectiveAdministratorCount(await roster(call)), 1);
  });

  // The view disables the save from the server's last-administrator answer
  // (never its own count) and asks for confirmation before removing any
  // administrator.
  assert.match(viewSource, /const blockedAsSoleAdmin = roleChangeBlockedAsLastAdministrator\(member, draftRole\);/);
  assert.match(viewSource, /disabled=\{Boolean\(savingKey\) \|\| unchanged \|\| blockedAsSoleAdmin\}/);
  assert.match(viewSource, /if \(removesAdmin && !confirming\) \{\s*setConfirming\(true\);\s*return;/);
  assert.doesNotMatch(viewSource, /effectiveAdministratorCount|soleAdministrator/);
});

test("11. derived Get Kinder administrator authority is shown as such and never offered as a revocable KAI membership", async () => {
  const memberships = [...standardMemberships(), member(ORG_A, "client_admin", { user_id: USERS.bothAdmin.user_id })];
  const store = createStore({ memberships, gkAdmins: { [GK_ORG_A]: [USERS.legacyAdmin.legacy, USERS.bothAdmin.legacy] } });
  await withRouter(ACTORS.storedAdmin, store, async (call) => {
    const members = await roster(call);
    const derivedOnly = byEmail(members, USERS.legacyAdmin.email);
    assert.equal(derivedOnly.authoritySource, "derived");
    assert.equal(derivedOnly.inheritedAdmin, true);
    assert.equal(derivedOnly.canChangeRole, false, "derived-only authority has no editable KAI membership");
    assert.match(describeMemberAuthority(derivedOnly), /cannot be changed here/);

    const both = byEmail(members, USERS.bothAdmin.email);
    assert.equal(both.authoritySource, "both");
    assert.equal(both.canChangeRole, true, "the stored KAI role itself stays editable");
    assert.equal(roleChangeRemovesAdministrator(both, "client_contributor"), false, "inherited authority is not removed by a stored-role change");
    assert.match(describeMemberAuthority(both), /does not remove that/);

    // Changing the stored role leaves the inherited administrator in place.
    assert.equal((await changeRole(call, members, USERS.bothAdmin.email, "client_contributor")).statusCode, 200);
    const after = byEmail(await roster(call), USERS.bothAdmin.email);
    assert.equal(after.storedRole, "client_contributor");
    assert.equal(after.effectiveRole, "client_admin");
    assert.equal(after.authoritySource, "both");
  });
  assert.match(viewSource, /return member\.canChangeRole \? \(/);
  assert.match(viewSource, /Get Kinder organization admin/);
});

// --------------------------------------------------------------------------
// 11a. Assigned role versus effective administrator authority. The roster's
// account status, effective authority, and last-administrator answer come
// from viewEffectiveKaiAccess; every case also asks the real guard.
// --------------------------------------------------------------------------

const unboundStore = (extraMemberships, accounts = {}) => createStore({
  memberships: [...standardMemberships(), ...extraMemberships],
  bindings: {},
  gkAdmins: {},
  accounts,
});

test("11a-1/5. one active and one deactivated administrator: the deactivated one keeps the role but is not counted, so the active one is protected", async () => {
  const store = unboundStore([member(ORG_A, "client_admin", { user_id: USERS.secondAdmin.user_id })], { [USERS.secondAdmin.legacy]: "inactive" });
  await withRouter(ACTORS.storedAdmin, store, async (call) => {
    const members = await roster(call);
    const deactivated = byEmail(members, USERS.secondAdmin.email);
    assert.equal(deactivated.effectiveRole, "client_admin", "the assigned role is still shown");
    assert.deepEqual([deactivated.storedRole, deactivated.storedStatus], ["client_admin", "active"]);
    assert.equal(deactivated.accountStatus, "inactive");
    assert.equal(teamAccessAccountStatusLabel(deactivated), "KAI account inactive");
    assert.equal(deactivated.effectiveAdmin, false);
    assert.equal(deactivated.lastAdminProtected, false);

    const self = byEmail(members, USERS.storedAdmin.email);
    assert.equal(self.effectiveAdmin, true);
    assert.equal(teamAccessAccountStatusLabel(self), "");
    assert.equal(effectiveAdministratorCount(members), 1);
    assert.equal(self.lastAdminProtected, true);
    assert.equal(roleChangeBlockedAsLastAdministrator(self, "client_contributor"), true);
    assert.equal(roleChangeBlockedAsLastAdministrator(self, "client_admin"), false);

    // The server agrees with the roster.
    const refused = await changeRole(call, members, USERS.storedAdmin.email, "client_contributor");
    assert.equal(refused.statusCode, 409);
    assert.equal(refused.body.error.code, "last_admin_protection");
    // The deactivated administrator's stored role may still be changed.
    assert.equal((await changeRole(call, members, USERS.secondAdmin.email, "client_contributor")).statusCode, 200);
    const after = byEmail(await roster(call), USERS.secondAdmin.email);
    assert.deepEqual([after.effectiveRole, after.accountStatus], ["client_contributor", "inactive"]);
  });
  assert.deepEqual(store.state.audits.map((a) => [a.target_user_id, a.resulting_role_name]), [[USERS.secondAdmin.user_id, "client_contributor"]]);
  assert.equal(store.state.memberships.find((row) => row.user_id === USERS.storedAdmin.user_id).role_name, "client_admin");
});

test("11a-2. two effective administrators: neither is protected and the permitted change succeeds", async () => {
  const store = unboundStore([member(ORG_A, "client_admin", { user_id: USERS.secondAdmin.user_id })]);
  await withRouter(ACTORS.storedAdmin, store, async (call) => {
    const members = await roster(call);
    assert.equal(effectiveAdministratorCount(members), 2);
    for (const email of [USERS.storedAdmin.email, USERS.secondAdmin.email]) {
      assert.equal(byEmail(members, email).lastAdminProtected, false, email);
      assert.equal(roleChangeBlockedAsLastAdministrator(byEmail(members, email), "client_contributor"), false, email);
    }
    assert.equal((await changeRole(call, members, USERS.storedAdmin.email, "client_contributor")).statusCode, 200);
    assert.equal(byEmail(await roster(call), USERS.secondAdmin.email).lastAdminProtected, true, "now the only one left");
  });
});

test("11a-3/4. a legacy-derived administrator counts only with an active KAI identity", async () => {
  for (const [account, expected] of [
    ["active", { accountStatus: "active", label: "", effectiveAdmin: true, protectedSelf: false, demotion: 200 }],
    ["inactive", { accountStatus: "inactive", label: "KAI account inactive", effectiveAdmin: false, protectedSelf: true, demotion: 409 }],
    [null, { accountStatus: "not_activated", label: "KAI access not yet activated", effectiveAdmin: false, protectedSelf: true, demotion: 409 }],
  ]) {
    const accounts = account === "active" ? {} : { [USERS.legacyAdmin.legacy]: account };
    const store = createStore({ memberships: standardMemberships(), accounts });
    await withRouter(ACTORS.storedAdmin, store, async (call) => {
      const members = await roster(call);
      const derived = members.find((entry) => entry.authoritySource === "derived");
      assert.equal(memberDisplayName(derived), account === null ? `Get Kinder user #${USERS.legacyAdmin.legacy}` : USERS.legacyAdmin.email);
      assert.equal(derived.effectiveRole, "client_admin", `${account}: still shown as an administrator through Get Kinder`);
      assert.equal(derived.inheritedAdmin, true);
      assert.equal(derived.accountStatus, expected.accountStatus);
      assert.equal(teamAccessAccountStatusLabel(derived), expected.label);
      assert.equal(derived.effectiveAdmin, expected.effectiveAdmin, String(account));
      const self = byEmail(members, USERS.storedAdmin.email);
      assert.equal(self.lastAdminProtected, expected.protectedSelf, String(account));
      assert.equal((await changeRole(call, members, USERS.storedAdmin.email, "client_contributor")).statusCode, expected.demotion, String(account));
    });
  }
});

test("11a-6. derived plus stored authority is one administrator, counted once, and neither source counts once the account is deactivated", async () => {
  const memberships = [...standardMemberships(), member(ORG_A, "client_admin", { user_id: USERS.bothAdmin.user_id })];
  const gkAdmins = { [GK_ORG_A]: [USERS.bothAdmin.legacy] };
  let store = createStore({ memberships, gkAdmins });
  await withRouter(ACTORS.storedAdmin, store, async (call) => {
    const raw = await call("GET", teamAccessRosterPath(ORG_A));
    assert.equal(raw.body.data.access.filter((row) => row.legacy_public_userdata_id === USERS.bothAdmin.legacy).length, 1);
    assert.equal(raw.body.data.access.filter((row) => row.effective_admin_authority === true).length, 2);
    const members = projectTeamAccessRoster(raw.body.data);
    const both = byEmail(members, USERS.bothAdmin.email);
    assert.deepEqual([both.authoritySource, both.effectiveAdmin, both.lastAdminProtected], ["both", true, false]);
    assert.equal(effectiveAdministratorCount(members), 2);
    assert.equal(byEmail(members, USERS.storedAdmin.email).lastAdminProtected, false, "an effective derived administrator remains");
  });

  store = createStore({ memberships, gkAdmins, accounts: { [USERS.bothAdmin.legacy]: "inactive" } });
  await withRouter(ACTORS.storedAdmin, store, async (call) => {
    const members = await roster(call);
    const both = byEmail(members, USERS.bothAdmin.email);
    assert.deepEqual([both.authoritySource, both.storedRole, both.effectiveRole], ["both", "client_admin", "client_admin"]);
    assert.deepEqual([both.accountStatus, both.effectiveAdmin], ["inactive", false]);
    assert.equal(effectiveAdministratorCount(members), 1);
    assert.equal(byEmail(members, USERS.storedAdmin.email).lastAdminProtected, true);
    assert.equal((await changeRole(call, members, USERS.storedAdmin.email, "client_contributor")).statusCode, 409);
  });
});

test("11a-7. a stale roster: the server refuses, nothing changes, and the re-read roster carries the protection", async () => {
  const store = unboundStore([member(ORG_A, "client_admin", { user_id: USERS.secondAdmin.user_id })]);
  await withRouter(ACTORS.storedAdmin, store, async (call) => {
    const stale = await roster(call);
    assert.equal(byEmail(stale, USERS.storedAdmin.email).lastAdminProtected, false);
    // The other administrator's account is deactivated after the page loaded.
    store.state.accounts[USERS.secondAdmin.legacy] = "inactive";
    const result = await changeRole(call, stale, USERS.storedAdmin.email, "client_contributor");
    assert.equal(result.statusCode, 409);
    assert.equal(result.body.ok, false);
    assert.match(describeRoleChangeError(teamAccessErrorFromResult(result)), /^This change was not made\. No other administrator/);
    const fresh = await roster(call);
    assert.equal(byEmail(fresh, USERS.storedAdmin.email).lastAdminProtected, true);
    assert.equal(byEmail(fresh, USERS.secondAdmin.email).accountStatus, "inactive");
  });
  assert.equal(store.state.audits.length, 0);
  assert.deepEqual(store.state.upserts, []);
  // The hook shows a success notice only for a 200, and re-reads the roster
  // on a conflict.
  assert.match(hookSource, /if \(result\.statusCode === 200 && result\.body\?\.ok\) \{\s*const members = await load\(targetOrganizationId\);[\s\S]{0,200}?setNotice\(\{ tone: "success"/);
  // Organization-role changes describe their refusal with describeRoleChangeError (the default).
  assert.match(hookSource, /const mutate = useCallback\(async \(member, buildRequest, method, successText, describeError = describeRoleChangeError\) => \{/);
  assert.match(hookSource, /setNotice\(\{ tone: "error", text: describeError\(failure\) \}\);\s*if \(failure\.status === 409/);
});

test("11a-8. administrator eligibility is per organization: each roster read answers for its own organization only", async () => {
  const memberships = [...standardMemberships(), member(ORG_B, "client_admin", { user_id: USERS.storedAdmin.user_id })];
  const store = createStore({ memberships, bindings: {}, gkAdmins: {} });
  const adminOfBoth = actor(USERS.storedAdmin, [member(ORG_A, "client_admin"), member(ORG_B, "client_admin")]);
  await withRouter(adminOfBoth, store, async (call) => {
    const orgA = await roster(call, ORG_A);
    const orgB = await roster(call, ORG_B);
    assert.equal(byEmail(orgA, USERS.storedAdmin.email).lastAdminProtected, true, "sole administrator of Org A");
    assert.equal(byEmail(orgB, USERS.storedAdmin.email).lastAdminProtected, false, "Org B has another administrator");
    assert.equal(byEmail(orgA, USERS.otherOrgAdmin.email), undefined);
    assert.equal(byEmail(orgB, USERS.contributor.email), undefined);
  });
});

// --------------------------------------------------------------------------
// 12. Organization switching.
// --------------------------------------------------------------------------

test("12. per-organization capability: an Org A administrator who contributes to Org B is offered Team & Access for A only", async () => {
  assert.equal((await capabilitiesFor(ACTORS.multiOrg, ORG_A)).organizationAccessManagement, true);
  assert.equal((await capabilitiesFor(ACTORS.multiOrg, ORG_B)).organizationAccessManagement, false);
  const store = createStore({ memberships: standardMemberships() });
  await withRouter(ACTORS.multiOrg, store, async (call) => {
    assert.equal((await call("GET", teamAccessRosterPath(ORG_A))).statusCode, 200);
    assert.equal((await call("GET", teamAccessRosterPath(ORG_B))).statusCode, 403);
  });
});

test("12. frontend: Team & Access entry points, roster reads, and the section follow the selected organization's capability answer", () => {
  // Capability flag, never a role string in the client.
  assert.match(appSource, /const canManageTeamAccess = capabilitiesResolved && accessCapabilities\.data\?\.organizationAccessManagement === true;/);
  assert.doesNotMatch(appSource, /"client_admin"/);
  // Both entry points exist only with the capability.
  // Prompt 4: also offered to a platform superuser through the server's administration context.
  assert.match(appSource, /onManageTeamAccess=\{platformAdministration \|\| \(hasAuthorizedOrganizations && canManageTeamAccess\) \? openTeamAccess : undefined\}/);
  assert.match(appSource, /const platformAdministration = administrationContext\.platformAdministration === true;/);
  assert.match(shellSource, /const canManageTeamAccess = typeof onManageTeamAccess === "function";/);
  assert.match(shellSource, /const navSections = canManageTeamAccess\s*\? \[\.\.\.IMPACT_LIBRARY_NAV_SECTIONS, IMPACT_LIBRARY_TEAM_ACCESS_SECTION\]\s*: IMPACT_LIBRARY_NAV_SECTIONS;/);
  assert.match(shellSource, /\{canManageTeamAccess \? \([\s\S]*?onManageTeamAccess\(\);[\s\S]*?Manage team & access/);
  // Both open the same section and the same view.
  assert.match(appSource, /const openTeamAccess = useCallback\(\(\) => setActiveSection\(TEAM_ACCESS_SECTION_KEY\), \[\]\);/);
  assert.equal(TEAM_ACCESS_SECTION_KEY, "teamAccess");
  assert.match(shellSource, /key: "teamAccess",/);
  assert.equal([...appSource.matchAll(/<TeamAccessView\b/g)].length, 1);
  // The roster is read only while open with the capability, keyed to the organization.
  assert.match(appSource, /const teamAccessOrganizationId = platformAdministration \? administrationOrganizationId : selectedOrganizationId;/);
  assert.match(appSource, /const teamAccessAvailable = platformAdministration \? Boolean\(administrationOrganizationId\) : canManageTeamAccess;/);
  assert.match(appSource, /useTeamAccess\(\s*teamAccessOrganizationId,\s*teamAccessAvailable && activeSection === TEAM_ACCESS_SECTION_KEY,\s*\)/);
  assert.match(hookSource, /if \(requestRef\.current !== token\) return;/);
  assert.match(hookSource, /if \(currentOrganizationRef\.current !== targetOrganizationId\) return \{ ok: false, stale: true \};/);
  assert.match(hookSource, /roster\.organizationId === organizationId \? roster :/);
  // Losing the capability (another organization, a lost role) leaves the section.
  assert.match(appSource, /if \(activeSection === TEAM_ACCESS_SECTION_KEY && !platformAdministration && administrationContext\.status === "success"\s*&& capabilitiesResolved && !canManageTeamAccess\) setActiveSection\("home"\);/);
  assert.match(appSource, /sectionContent = teamAccessAvailable \? teamAccessView : \(/);
  assert.match(appSource, /const teamAccessView = \(\s*<TeamAccessView/);
  // An administrator's own role change re-reads the capability answer.
  // An administrator's own role change, or a server conflict, re-reads the
  // capability answer; the hook re-reads the roster on a conflict.
  assert.match(appSource, /if \(\(result\.ok && \(member\.effectiveAdmin \|\| member\.isActor\)\) \|\| result\.failure\?\.status === 409\) await refreshAccessCapabilities\(\);/);
  for (const handler of ["changeRole", "grantRole", "revokeRole"]) {
    assert.match(appSource, new RegExp(`await afterTeamAccessChange\\(member, await teamAccess\\.${handler}\\(member, roleName\\)\\);`), handler);
  }
  assert.match(hookSource, /if \(failure\.status === 409 \|\| failure\.status === 404\) await load\(targetOrganizationId\);/);
});

// --------------------------------------------------------------------------
// 13. Existing behaviour.
// --------------------------------------------------------------------------

test("13. existing organization creation, join, switching, Home join review, and the /admin KAI Access modal are unchanged", () => {
  assert.match(shellSource, /\+ Add or join organization/);
  assert.match(shellSource, /href=\{organizationActionHref\}>\s*Request \/ create new organization/);
  assert.match(shellSource, /onJoinOrganization\(\);[\s\S]*?Join existing organization/);
  assert.match(shellSource, /typeof onReviewJoinRequests === "function" \? \([\s\S]*?Review join requests/);
  assert.match(shellSource, /organizations\.length > 1 && typeof onSelectOrganization === "function"/);
  assert.match(shellSource, /onSelectOrganization\(org\.organization_id\);/);
  assert.match(appSource, /onReviewJoinRequests=\{hasAuthorizedOrganizations && joinReview\.available \? openJoinReview : undefined\}/);
  assert.match(appSource, /<OrganizationJoinRequestsReviewPanel\s+items=\{joinReview\.items\}/);
  // Team & Access reuses the same join-review panel and decision handler.
  assert.match(viewSource, /import OrganizationJoinRequestsReviewPanel from "\.\.\/impactLibrary\/OrganizationJoinRequestsReviewPanel\.jsx";/);
  assert.match(appSource, /onDecideJoinRequest=\{decideJoinRequest\}/);
  assert.match(appSource, /if \(decision === "approve"\) refreshTeamAccessRef\.current\(\);/);
  // NPO administrators are never sent to the GK superuser dashboard.
  for (const source of [appSource, shellSource, viewSource, hookSource]) assert.doesNotMatch(source, /href="\/admin|\/admin\b(?!istration)/);
  // The /admin modal still uses the shared helpers it used before.
  assert.match(adminSource, /buildKaiOrganizationRoleGrantPayload\(roleInput, \{ includeGkRoles: globalRolesVisible \}\)/);
  assert.match(adminSource, /Derived — not editable here/);
});

test("feature flag: with KAI_SPRINT2_ENABLED off, the capability read and the roster and role services do nothing", async () => {
  const off = { KAI_SPRINT2_ENABLED: "false" };
  assert.equal((await getOrganizationAccessCapabilities({ organizationId: ORG_A, actorContext: ACTORS.storedAdmin }, { env: off })).error.code, "feature_disabled");
  const store = createStore({ memberships: standardMemberships() });
  const deps = { ...store.dependencies, env: off };
  assert.equal((await viewEffectiveKaiAccess({ actorContext: ACTORS.storedAdmin, organizationId: ORG_A }, deps)).error.code, "feature_disabled");
  const write = await manageOrganizationMembership({
    actorContext: ACTORS.storedAdmin, organizationId: ORG_A, targetLegacyPublicUserdataId: USERS.contributor.legacy,
    roleName: "client_reviewer", membershipStatus: "active", now: NOW,
  }, deps);
  assert.equal(write.error.code, "feature_disabled");
  assert.deepEqual(store.state.upserts, []);
});
