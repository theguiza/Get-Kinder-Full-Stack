import test from "node:test";
import assert from "node:assert/strict";

import {
  viewEffectiveKaiAccess,
  manageOrganizationMembership,
  manageGlobalKaiRole,
} from "../Backend/kai/services/kaiAccessAdministrationService.js";

const ORG_A = "org-aaaaaaaa";
const ORG_B = "org-bbbbbbbb";
const enabledEnv = { KAI_SPRINT2_ENABLED: "true" };
const disabledEnv = { KAI_SPRINT2_ENABLED: "false" };
const NOW = "2026-08-23T00:00:00.000Z";

function fakeTx() {
  return { query: async () => ({ rows: [] }) };
}

function fakeRunInTransaction(tx = fakeTx()) {
  return async (callback) => callback(tx);
}

function platformSuperuserActor() {
  return {
    actorType: "human",
    actorUserId: "platform-1",
    kaiRoles: [],
    organizationMemberships: [],
    platformSuperuser: true,
    platformSuperuserAuthority: "get_kinder_site_admin",
  };
}

function storedClientAdminActor(organizationId) {
  return {
    actorType: "human",
    actorUserId: "stored-admin-1",
    kaiRoles: [],
    organizationMemberships: [
      { organization_id: organizationId, user_id: "stored-admin-1", role_name: "client_admin", membership_status: "active" },
    ],
    platformSuperuser: false,
  };
}

function derivedClientAdminActor(organizationId) {
  return {
    actorType: "human",
    actorUserId: "derived-admin-1",
    kaiRoles: [],
    organizationMemberships: [
      {
        organization_id: organizationId,
        role_name: "client_admin",
        membership_status: "active",
        source: "gk_organization_binding",
        gk_organization_id: 42,
      },
    ],
    platformSuperuser: false,
  };
}

function lowerRoleActor(organizationId, roleName) {
  return {
    actorType: "human",
    actorUserId: `low-${roleName}`,
    kaiRoles: [],
    organizationMemberships: [
      { organization_id: organizationId, user_id: `low-${roleName}`, role_name: roleName, membership_status: "active" },
    ],
    platformSuperuser: false,
  };
}

function inactiveMembershipActor(organizationId) {
  return {
    actorType: "human",
    actorUserId: "inactive-admin-1",
    kaiRoles: [],
    organizationMemberships: [
      { organization_id: organizationId, user_id: "inactive-admin-1", role_name: "client_admin", membership_status: "inactive" },
    ],
    platformSuperuser: false,
  };
}

function baseTargetResolver(targetUserId = "target-kai-user-1") {
  return async ({ legacyPublicUserdataId }) => ({
    user_id: targetUserId,
    legacy_identity_source: "public.userdata",
    legacy_public_userdata_id: legacyPublicUserdataId,
    status: "active",
    email: "target@example.com",
  });
}

function trackingAudit(calls) {
  return function createProductionMetadataOnlyAuditForAccessAdministration({ targetUserId }) {
    return {
      prepareMetadataOnlyAudit({ payload }) {
        if (payload.target_user_id !== targetUserId) return { ok: false };
        return {
          ok: true,
          async publish() {
            calls.push(payload);
            return { ok: true, auditEventId: calls.length };
          },
        };
      },
    };
  };
}

function rejectingAudit() {
  return function createProductionMetadataOnlyAuditForAccessAdministration() {
    return { prepareMetadataOnlyAudit: () => ({ ok: false }) };
  };
}

// --- manageOrganizationMembership -------------------------------------------------

test("platform superuser can manage client memberships for any explicit organization", async () => {
  const auditCalls = [];
  let upsertCalls = 0;
  const result = await manageOrganizationMembership(
    {
      actorContext: platformSuperuserActor(),
      organizationId: ORG_B,
      targetLegacyPublicUserdataId: 501,
      roleName: "client_admin",
      membershipStatus: "active",
      now: NOW,
    },
    {
      env: enabledEnv,
      runInTransaction: fakeRunInTransaction(),
      findOrCreateKaiUserByLegacyPublicUserdataId: baseTargetResolver(),
      listOrganizationMembershipRowsForUserInOrganization: async () => [],
      countActiveStoredClientAdminMemberships: async () => 0,
      hasActiveDerivedClientAdminForOrganization: async () => false,
      upsertOrganizationMembershipRoleStatus: async (input) => {
        upsertCalls += 1;
        return { previousRow: null, newRow: input, mutated: true, replay: false };
      },
      createProductionMetadataOnlyAuditForAccessAdministration: trackingAudit(auditCalls),
    },
  );

  assert.equal(result.ok, true);
  assert.equal(upsertCalls, 1);
  assert.equal(auditCalls.length, 1);
  assert.equal(auditCalls[0].resulting_role_name, "client_admin");
});

test("stored client_admin can administer client roles in its own organization", async () => {
  const result = await manageOrganizationMembership(
    {
      actorContext: storedClientAdminActor(ORG_A),
      organizationId: ORG_A,
      targetLegacyPublicUserdataId: 502,
      roleName: "client_reviewer",
      membershipStatus: "active",
      now: NOW,
    },
    {
      env: enabledEnv,
      runInTransaction: fakeRunInTransaction(),
      findOrCreateKaiUserByLegacyPublicUserdataId: baseTargetResolver(),
      listOrganizationMembershipRowsForUserInOrganization: async () => [],
      countActiveStoredClientAdminMemberships: async () => 1,
      hasActiveDerivedClientAdminForOrganization: async () => false,
      upsertOrganizationMembershipRoleStatus: async (input) => ({ previousRow: null, newRow: input, mutated: true, replay: false }),
      createProductionMetadataOnlyAuditForAccessAdministration: trackingAudit([]),
    },
  );
  assert.equal(result.ok, true);
});

test("effective derived client_admin can administer client roles in its own organization", async () => {
  const result = await manageOrganizationMembership(
    {
      actorContext: derivedClientAdminActor(ORG_A),
      organizationId: ORG_A,
      targetLegacyPublicUserdataId: 503,
      roleName: "client_contributor",
      membershipStatus: "active",
      now: NOW,
    },
    {
      env: enabledEnv,
      runInTransaction: fakeRunInTransaction(),
      findOrCreateKaiUserByLegacyPublicUserdataId: baseTargetResolver(),
      listOrganizationMembershipRowsForUserInOrganization: async () => [],
      countActiveStoredClientAdminMemberships: async () => 0,
      hasActiveDerivedClientAdminForOrganization: async () => true,
      upsertOrganizationMembershipRoleStatus: async (input) => ({ previousRow: null, newRow: input, mutated: true, replay: false }),
      createProductionMetadataOnlyAuditForAccessAdministration: trackingAudit([]),
    },
  );
  assert.equal(result.ok, true);
});

test("client_admin cannot administer another organization", async () => {
  let upsertCalls = 0;
  const result = await manageOrganizationMembership(
    {
      actorContext: storedClientAdminActor(ORG_A),
      organizationId: ORG_B,
      targetLegacyPublicUserdataId: 504,
      roleName: "client_reviewer",
      membershipStatus: "active",
      now: NOW,
    },
    {
      env: enabledEnv,
      runInTransaction: fakeRunInTransaction(),
      findOrCreateKaiUserByLegacyPublicUserdataId: baseTargetResolver(),
      upsertOrganizationMembershipRoleStatus: async () => {
        upsertCalls += 1;
        throw new Error("must not be called");
      },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
  assert.equal(upsertCalls, 0);
});

test("client_reviewer and client_contributor cannot administer memberships", async () => {
  for (const roleName of ["client_reviewer", "client_contributor"]) {
    const result = await manageOrganizationMembership(
      {
        actorContext: lowerRoleActor(ORG_A, roleName),
        organizationId: ORG_A,
        targetLegacyPublicUserdataId: 505,
        roleName: "client_admin",
        membershipStatus: "active",
        now: NOW,
      },
      {
        env: enabledEnv,
        runInTransaction: fakeRunInTransaction(),
        findOrCreateKaiUserByLegacyPublicUserdataId: baseTargetResolver(),
        upsertOrganizationMembershipRoleStatus: async () => { throw new Error("must not be called"); },
      },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "authorization_denied");
  }
});

test("inactive membership fails closed for membership administration", async () => {
  const result = await manageOrganizationMembership(
    {
      actorContext: inactiveMembershipActor(ORG_A),
      organizationId: ORG_A,
      targetLegacyPublicUserdataId: 506,
      roleName: "client_reviewer",
      membershipStatus: "active",
      now: NOW,
    },
    {
      env: enabledEnv,
      runInTransaction: fakeRunInTransaction(),
      findOrCreateKaiUserByLegacyPublicUserdataId: baseTargetResolver(),
      upsertOrganizationMembershipRoleStatus: async () => { throw new Error("must not be called"); },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("last-effective-client-admin protection blocks an ordinary client_admin from self-demoting the sole admin", async () => {
  let upsertCalls = 0;
  const result = await manageOrganizationMembership(
    {
      actorContext: storedClientAdminActor(ORG_A),
      organizationId: ORG_A,
      targetLegacyPublicUserdataId: 507,
      roleName: "client_reviewer",
      membershipStatus: "active",
      now: NOW,
    },
    {
      env: enabledEnv,
      runInTransaction: fakeRunInTransaction(),
      findOrCreateKaiUserByLegacyPublicUserdataId: baseTargetResolver("stored-admin-1-mapped"),
      listOrganizationMembershipRowsForUserInOrganization: async () => [{
        organization_id: ORG_A, user_id: "stored-admin-1-mapped", role_name: "client_admin", membership_status: "active",
      }],
      countActiveStoredClientAdminMemberships: async () => 0,
      hasActiveDerivedClientAdminForOrganization: async () => false,
      upsertOrganizationMembershipRoleStatus: async () => { upsertCalls += 1; throw new Error("must not be called"); },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "last_admin_protection");
  assert.equal(upsertCalls, 0);
});

test("pre-existing multiple stored client-role rows for the same user/org fail closed with zero mutation", async () => {
  let upsertCalls = 0;
  const result = await manageOrganizationMembership(
    {
      actorContext: platformSuperuserActor(),
      organizationId: ORG_A,
      targetLegacyPublicUserdataId: 512,
      roleName: "client_reviewer",
      membershipStatus: "active",
      now: NOW,
    },
    {
      env: enabledEnv,
      runInTransaction: fakeRunInTransaction(),
      findOrCreateKaiUserByLegacyPublicUserdataId: baseTargetResolver("conflicted-user-1"),
      listOrganizationMembershipRowsForUserInOrganization: async () => [
        { organization_id: ORG_A, user_id: "conflicted-user-1", role_name: "client_admin", membership_status: "active" },
        { organization_id: ORG_A, user_id: "conflicted-user-1", role_name: "client_contributor", membership_status: "active" },
      ],
      upsertOrganizationMembershipRoleStatus: async () => { throw new Error("must not be called"); },
      createProductionMetadataOnlyAuditForAccessAdministration: trackingAudit([]),
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "membership_state_conflict");
  assert.equal(upsertCalls, 0);
});

test("platform superuser can repair an organization with no effective client_admin", async () => {
  let upsertCalls = 0;
  const result = await manageOrganizationMembership(
    {
      actorContext: platformSuperuserActor(),
      organizationId: ORG_A,
      targetLegacyPublicUserdataId: 508,
      roleName: "client_admin",
      membershipStatus: "active",
      now: NOW,
    },
    {
      env: enabledEnv,
      runInTransaction: fakeRunInTransaction(),
      findOrCreateKaiUserByLegacyPublicUserdataId: baseTargetResolver(),
      listOrganizationMembershipRowsForUserInOrganization: async () => [],
      countActiveStoredClientAdminMemberships: async () => 0,
      hasActiveDerivedClientAdminForOrganization: async () => false,
      upsertOrganizationMembershipRoleStatus: async (input) => {
        upsertCalls += 1;
        return { previousRow: null, newRow: input, mutated: true, replay: false };
      },
      createProductionMetadataOnlyAuditForAccessAdministration: trackingAudit([]),
    },
  );
  assert.equal(result.ok, true);
  assert.equal(upsertCalls, 1);
});

test("replay of an identical membership mutation creates no duplicate audit", async () => {
  const auditCalls = [];
  const deps = {
    env: enabledEnv,
    runInTransaction: fakeRunInTransaction(),
    findOrCreateKaiUserByLegacyPublicUserdataId: baseTargetResolver(),
    listOrganizationMembershipRowsForUserInOrganization: async () => [{
      organization_id: ORG_A, user_id: "target-kai-user-1", role_name: "client_reviewer", membership_status: "active",
    }],
    countActiveStoredClientAdminMemberships: async () => 1,
    hasActiveDerivedClientAdminForOrganization: async () => false,
    upsertOrganizationMembershipRoleStatus: async () => ({
      previousRow: { role_name: "client_reviewer", membership_status: "active" },
      newRow: { role_name: "client_reviewer", membership_status: "active" },
      mutated: false,
      replay: true,
    }),
    createProductionMetadataOnlyAuditForAccessAdministration: trackingAudit(auditCalls),
  };

  const result = await manageOrganizationMembership(
    {
      actorContext: storedClientAdminActor(ORG_A),
      organizationId: ORG_A,
      targetLegacyPublicUserdataId: 509,
      roleName: "client_reviewer",
      membershipStatus: "active",
      now: NOW,
    },
    deps,
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.replayed, true);
  assert.equal(auditCalls.length, 0);
});

test("required audit failure rolls back the membership write", async () => {
  const result = await manageOrganizationMembership(
    {
      actorContext: storedClientAdminActor(ORG_A),
      organizationId: ORG_A,
      targetLegacyPublicUserdataId: 510,
      roleName: "client_reviewer",
      membershipStatus: "active",
      now: NOW,
    },
    {
      env: enabledEnv,
      runInTransaction: fakeRunInTransaction(),
      findOrCreateKaiUserByLegacyPublicUserdataId: baseTargetResolver(),
      listOrganizationMembershipRowsForUserInOrganization: async () => [],
      countActiveStoredClientAdminMemberships: async () => 1,
      hasActiveDerivedClientAdminForOrganization: async () => false,
      upsertOrganizationMembershipRoleStatus: async (input) => ({ previousRow: null, newRow: input, mutated: true, replay: false }),
      createProductionMetadataOnlyAuditForAccessAdministration: rejectingAudit(),
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
});

test("KAI_SPRINT2_ENABLED disabled has zero role-administration side effects", async () => {
  let touched = false;
  const deps = {
    env: disabledEnv,
    runInTransaction: fakeRunInTransaction(),
    findOrCreateKaiUserByLegacyPublicUserdataId: async () => { touched = true; return { user_id: "x" }; },
    upsertOrganizationMembershipRoleStatus: async () => { touched = true; },
    assignGlobalRole: async () => { touched = true; },
    revokeGlobalRole: async () => { touched = true; },
  };

  const membershipResult = await manageOrganizationMembership(
    { actorContext: platformSuperuserActor(), organizationId: ORG_A, targetLegacyPublicUserdataId: 511, roleName: "client_admin", membershipStatus: "active", now: NOW },
    deps,
  );
  const globalRoleResult = await manageGlobalKaiRole(
    { actorContext: platformSuperuserActor(), targetLegacyPublicUserdataId: 511, roleName: "gk_admin", action: "assign", now: NOW },
    deps,
  );
  const viewResult = await viewEffectiveKaiAccess({ actorContext: platformSuperuserActor(), organizationId: ORG_A }, deps);

  assert.equal(membershipResult.ok, false);
  assert.equal(membershipResult.error.code, "feature_disabled");
  assert.equal(globalRoleResult.ok, false);
  assert.equal(globalRoleResult.error.code, "feature_disabled");
  assert.equal(viewResult.ok, false);
  assert.equal(viewResult.error.code, "feature_disabled");
  assert.equal(touched, false);
});

// --- manageGlobalKaiRole -----------------------------------------------------------

test("platform superuser can assign and revoke an existing global KAI role", async () => {
  const auditCalls = [];
  const assignResult = await manageGlobalKaiRole(
    { actorContext: platformSuperuserActor(), targetLegacyPublicUserdataId: 601, roleName: "gk_reviewer", action: "assign", now: NOW },
    {
      env: enabledEnv,
      runInTransaction: fakeRunInTransaction(),
      findOrCreateKaiUserByLegacyPublicUserdataId: baseTargetResolver(),
      listGlobalRoleAssignmentRows: async () => [],
      assignGlobalRole: async () => ({ ok: true, mutated: true, replay: false, roleId: 9, roleName: "gk_reviewer" }),
      createProductionMetadataOnlyAuditForAccessAdministration: trackingAudit(auditCalls),
    },
  );
  assert.equal(assignResult.ok, true);
  assert.equal(auditCalls.length, 1);
  assert.equal(auditCalls[0].attempted_operation, "global_kai_role_assigned");

  const revokeResult = await manageGlobalKaiRole(
    { actorContext: platformSuperuserActor(), targetLegacyPublicUserdataId: 601, roleName: "gk_reviewer", action: "revoke", now: NOW },
    {
      env: enabledEnv,
      runInTransaction: fakeRunInTransaction(),
      findOrCreateKaiUserByLegacyPublicUserdataId: baseTargetResolver(),
      listGlobalRoleAssignmentRows: async () => [{ role_id: 9, role_name: "gk_reviewer" }],
      revokeGlobalRole: async () => ({ ok: true, mutated: true, replay: false, roleId: 9, roleName: "gk_reviewer" }),
      createProductionMetadataOnlyAuditForAccessAdministration: trackingAudit(auditCalls),
    },
  );
  assert.equal(revokeResult.ok, true);
  assert.equal(auditCalls.length, 2);
  assert.equal(auditCalls[1].attempted_operation, "global_kai_role_revoked");
});

test("replayed global role assignment creates no duplicate audit", async () => {
  const auditCalls = [];
  const result = await manageGlobalKaiRole(
    { actorContext: platformSuperuserActor(), targetLegacyPublicUserdataId: 602, roleName: "gk_operator", action: "assign", now: NOW },
    {
      env: enabledEnv,
      runInTransaction: fakeRunInTransaction(),
      findOrCreateKaiUserByLegacyPublicUserdataId: baseTargetResolver(),
      listGlobalRoleAssignmentRows: async () => [{ role_id: 3, role_name: "gk_operator" }],
      assignGlobalRole: async () => ({ ok: true, mutated: false, replay: true, roleId: 3, roleName: "gk_operator" }),
      createProductionMetadataOnlyAuditForAccessAdministration: trackingAudit(auditCalls),
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.replayed, true);
  assert.equal(auditCalls.length, 0);
});

test("non-platform-superuser cannot administer global roles (stored client_admin)", async () => {
  let mutationCalls = 0;
  const result = await manageGlobalKaiRole(
    { actorContext: storedClientAdminActor(ORG_A), targetLegacyPublicUserdataId: 603, roleName: "gk_admin", action: "assign", now: NOW },
    {
      env: enabledEnv,
      runInTransaction: fakeRunInTransaction(),
      findOrCreateKaiUserByLegacyPublicUserdataId: baseTargetResolver(),
      assignGlobalRole: async () => { mutationCalls += 1; throw new Error("must not be called"); },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
  assert.equal(mutationCalls, 0);
});

test("derived client_admin cannot administer global roles", async () => {
  const result = await manageGlobalKaiRole(
    { actorContext: derivedClientAdminActor(ORG_A), targetLegacyPublicUserdataId: 604, roleName: "gk_admin", action: "assign", now: NOW },
    {
      env: enabledEnv,
      runInTransaction: fakeRunInTransaction(),
      findOrCreateKaiUserByLegacyPublicUserdataId: baseTargetResolver(),
      assignGlobalRole: async () => { throw new Error("must not be called"); },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("platform-superuser authority cannot be fabricated from an ordinary actor's role list", async () => {
  const actor = {
    actorType: "human",
    actorUserId: "ordinary-1",
    kaiRoles: ["platform_superuser", "get_kinder_site_admin"],
    organizationMemberships: [],
    platformSuperuser: false,
  };
  const result = await manageGlobalKaiRole(
    { actorContext: actor, targetLegacyPublicUserdataId: 605, roleName: "gk_admin", action: "assign", now: NOW },
    {
      env: enabledEnv,
      runInTransaction: fakeRunInTransaction(),
      findOrCreateKaiUserByLegacyPublicUserdataId: baseTargetResolver(),
      assignGlobalRole: async () => { throw new Error("must not be called"); },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
  assert.equal(result.blockers[0].blocking_reason, "platform_superuser_required");
});

test("assigning a non-existent global role fails closed without inventing a role", async () => {
  const result = await manageGlobalKaiRole(
    { actorContext: platformSuperuserActor(), targetLegacyPublicUserdataId: 606, roleName: "gk_reviewer", action: "assign", now: NOW },
    {
      env: enabledEnv,
      runInTransaction: fakeRunInTransaction(),
      findOrCreateKaiUserByLegacyPublicUserdataId: baseTargetResolver(),
      listGlobalRoleAssignmentRows: async () => [],
      assignGlobalRole: async () => ({ ok: false, error_code: "role_not_found" }),
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "role_not_found");
});

// --- viewEffectiveKaiAccess ---------------------------------------------------------

test("stored and derived access remain distinguishable and a lower stored role does not cancel active derived admin authority", async () => {
  const result = await viewEffectiveKaiAccess(
    { actorContext: storedClientAdminActor(ORG_A), organizationId: ORG_A },
    {
      env: enabledEnv,
      listOrganizationMembershipRowsForOrganization: async () => [
        {
          organization_id: ORG_A,
          user_id: "dual-user-1",
          role_name: "client_reviewer",
          membership_status: "active",
          legacy_public_userdata_id: 700,
          email: "dual@example.com",
        },
      ],
      getActiveGkOrganizationIdForKaiOrganization: async () => 42,
      listActiveGkOrganizationAdminLegacyUserIds: async () => [700],
      findKaiUserByLegacyPublicUserdataId: async () => ({ user_id: "dual-user-1", email: "dual@example.com" }),
      listKaiRolesForUser: async () => [],
    },
  );

  assert.equal(result.ok, true);
  const [row] = result.data.access;
  assert.equal(row.stored_membership.role_name, "client_reviewer");
  assert.equal(row.derived_membership.role_name, "client_admin");
  assert.equal(row.effective_role_name, "client_admin");
  assert.equal(row.effective_membership_status, "active");
  assert.equal(row.authority_source, "both");
});

test("global KAI roles are visible only when the caller holds platform-superuser authority", async () => {
  const deps = {
    env: enabledEnv,
    listOrganizationMembershipRowsForOrganization: async () => [
      { organization_id: ORG_A, user_id: "u1", role_name: "client_admin", membership_status: "active", legacy_public_userdata_id: 701, email: "u1@example.com" },
    ],
    getActiveGkOrganizationIdForKaiOrganization: async () => null,
    listActiveGkOrganizationAdminLegacyUserIds: async () => [],
    findKaiUserByLegacyPublicUserdataId: async () => null,
    listKaiRolesForUser: async () => ["gk_admin"],
  };

  const asSuperuser = await viewEffectiveKaiAccess({ actorContext: platformSuperuserActor(), organizationId: ORG_A }, deps);
  assert.equal(asSuperuser.data.global_roles_visible, true);
  assert.deepEqual(asSuperuser.data.access[0].global_kai_roles, ["gk_admin"]);

  const asStoredAdmin = await viewEffectiveKaiAccess({ actorContext: storedClientAdminActor(ORG_A), organizationId: ORG_A }, deps);
  assert.equal(asStoredAdmin.data.global_roles_visible, false);
  assert.equal(asStoredAdmin.data.access[0].global_kai_roles, undefined);
});

test("client_reviewer cannot view the organization access roster", async () => {
  const result = await viewEffectiveKaiAccess(
    { actorContext: lowerRoleActor(ORG_A, "client_reviewer"), organizationId: ORG_A },
    { env: enabledEnv, listOrganizationMembershipRowsForOrganization: async () => { throw new Error("must not be called"); } },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});
