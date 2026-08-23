import test from "node:test";
import assert from "node:assert/strict";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_P2_ACCESS_ADMINISTRATION_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`p2_access_administration integration suite refused a non-loopback KAI_P2_ACCESS_ADMINISTRATION_DATABASE_URL host: ${host}`);
  }
}

test("p2_access_administration PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("p2_access_administration integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runIntegrationSuite();
}

// Every subtest is registered as a child of one enclosing test (`t.test`)
// rather than dynamically at module scope: node:test cannot know how many
// subtests are coming when they are scheduled across `await` boundaries at
// the top level, and was observed (empirically, while building this
// verifier) to conclude the suite was complete - and tear down the shared
// pool - after only the first couple of dynamically-registered tests. Nesting
// under one parent test gives the runner an explicit boundary to wait for.
async function runIntegrationSuite() {
  const { Pool } = await import("pg");
  const { withTransaction } = await import("../Backend/kai/db/kaiDb.js");
  const {
    viewEffectiveKaiAccess,
    manageOrganizationMembership,
    manageGlobalKaiRole,
  } = await import("../Backend/kai/services/kaiAccessAdministrationService.js");
  const {
    listOrganizationMembershipRowsForUserInOrganization,
    listOrganizationMembershipRowsForOrganization,
    countActiveStoredClientAdminMemberships,
    upsertOrganizationMembershipRoleStatus,
    listGlobalRoleAssignmentRows,
    assignGlobalRole,
    revokeGlobalRole,
    findOrCreateKaiUserByLegacyPublicUserdataId,
  } = await import("../Backend/kai/db/kaiAccessAdministrationQueries.js");
  const { listKaiRolesForUser, findKaiUserByLegacyPublicUserdataId } = await import("../Backend/kai/db/kaiQueries.js");
  const {
    getActiveGkOrganizationIdForKaiOrganization,
    listActiveGkOrganizationAdminLegacyUserIds,
    hasActiveDerivedClientAdminForOrganization,
  } = await import("../Backend/kai/auth/gkOrganizationAdminQueries.js");
  const { createProductionMetadataOnlyAuditForAccessAdministration } = await import(
    "../Backend/kai/services/kaiMetadataOnlyAuditComposition.js"
  );

  const pool = new Pool({ connectionString: RUNNER_OWNED_DATABASE_URL, ssl: false });

  const NOW = "2026-08-23T00:00:00.000Z";
  const enabledEnv = { KAI_SPRINT2_ENABLED: "true" };

  function realDeps(overrides = {}) {
    return {
      env: enabledEnv,
      runInTransaction: (callback) => withTransaction(callback, pool),
      findOrCreateKaiUserByLegacyPublicUserdataId: (input) => findOrCreateKaiUserByLegacyPublicUserdataId(input, pool),
      findKaiUserByLegacyPublicUserdataId: (legacyId) => findKaiUserByLegacyPublicUserdataId(legacyId, pool),
      listOrganizationMembershipRowsForOrganization: (orgId) => listOrganizationMembershipRowsForOrganization(orgId, pool),
      listOrganizationMembershipRowsForUserInOrganization: (orgId, userId, db) =>
        listOrganizationMembershipRowsForUserInOrganization(orgId, userId, db || pool),
      countActiveStoredClientAdminMemberships: (orgId, db, opts) => countActiveStoredClientAdminMemberships(orgId, db || pool, opts),
      hasActiveDerivedClientAdminForOrganization: (orgId, db) => hasActiveDerivedClientAdminForOrganization(orgId, db || pool),
      getActiveGkOrganizationIdForKaiOrganization: (orgId, db) => getActiveGkOrganizationIdForKaiOrganization(orgId, db || pool),
      listActiveGkOrganizationAdminLegacyUserIds: (gkOrgId, db) => listActiveGkOrganizationAdminLegacyUserIds(gkOrgId, db || pool),
      upsertOrganizationMembershipRoleStatus: (input, db) => upsertOrganizationMembershipRoleStatus(input, db || pool),
      assignGlobalRole: (input, db) => assignGlobalRole(input, db || pool),
      revokeGlobalRole: (input, db) => revokeGlobalRole(input, db || pool),
      listGlobalRoleAssignmentRows: (userId, db) => listGlobalRoleAssignmentRows(userId, db || pool),
      listKaiRolesForUser: (userId, db) => listKaiRolesForUser(userId, db || pool),
      createProductionMetadataOnlyAuditForAccessAdministration,
      ...overrides,
    };
  }

  async function resetAllTables() {
    await pool.query(
      "TRUNCATE kai.audit_events, kai.user_roles, kai.organization_memberships, kai.gk_organization_bindings, kai.users RESTART IDENTITY CASCADE",
    );
    await pool.query("TRUNCATE public.user_org_memberships, public.organizations, public.userdata RESTART IDENTITY CASCADE");
  }

  async function seedKaiUser(legacyPublicUserdataId, email = `user${legacyPublicUserdataId}@example.com`) {
    const { rows } = await pool.query(
      `INSERT INTO kai.users (legacy_identity_source, legacy_public_userdata_id, email, status)
       VALUES ('public.userdata', $1, $2, 'active') RETURNING user_id`,
      [legacyPublicUserdataId, email],
    );
    return rows[0].user_id;
  }

  async function newOrgId() {
    const { rows } = await pool.query("SELECT gen_random_uuid() AS id");
    return rows[0].id;
  }

  async function auditCount() {
    return Number((await pool.query("SELECT count(*)::int AS n FROM kai.audit_events")).rows[0].n);
  }

  async function membershipRows(organizationId, kaiUserId) {
    return (
      await pool.query(
        "SELECT role_name, membership_status FROM kai.organization_memberships WHERE organization_id = $1 AND user_id = $2",
        [organizationId, kaiUserId],
      )
    ).rows;
  }

  async function userRolesRows(kaiUserId) {
    return (
      await pool.query(
        "SELECT role_id, organization_id, engagement_id, active, revoked_at FROM kai.user_roles WHERE user_id = $1",
        [kaiUserId],
      )
    ).rows;
  }

  function platformSuperuserActor() {
    return {
      actorType: "human",
      actorUserId: "platform-actor",
      kaiRoles: [],
      organizationMemberships: [],
      platformSuperuser: true,
      platformSuperuserAuthority: "get_kinder_site_admin",
    };
  }

  function storedClientAdminActor(organizationId) {
    return {
      actorType: "human",
      actorUserId: "stored-admin-actor",
      kaiRoles: [],
      organizationMemberships: [
        { organization_id: organizationId, role_name: "client_admin", membership_status: "active" },
      ],
      platformSuperuser: false,
    };
  }

  await test("p2_access_administration real PostgreSQL proof", async (t) => {
    try {
      // --- A. Organization membership reconciliation --------------------------

      await t.test("assign client_contributor creates exactly one stored row", async () => {
        await resetAllTables();
        const orgId = await newOrgId();
        const result = await manageOrganizationMembership(
          { actorContext: platformSuperuserActor(), organizationId: orgId, targetLegacyPublicUserdataId: 101, roleName: "client_contributor", membershipStatus: "active", now: NOW },
          realDeps(),
        );
        assert.equal(result.ok, true);
        assert.equal(result.data.replayed, false);
        const kaiUserId = result.data.user_id;
        const rows = await membershipRows(orgId, kaiUserId);
        assert.deepEqual(rows, [{ role_name: "client_contributor", membership_status: "active" }]);
        assert.equal(await auditCount(), 1);
      });

      await t.test("replay of an identical assignment mutates nothing and writes no duplicate audit", async () => {
        await resetAllTables();
        const orgId = await newOrgId();
        const deps = realDeps();
        const first = await manageOrganizationMembership(
          { actorContext: platformSuperuserActor(), organizationId: orgId, targetLegacyPublicUserdataId: 102, roleName: "client_contributor", membershipStatus: "active", now: NOW },
          deps,
        );
        const second = await manageOrganizationMembership(
          { actorContext: platformSuperuserActor(), organizationId: orgId, targetLegacyPublicUserdataId: 102, roleName: "client_contributor", membershipStatus: "active", now: NOW },
          deps,
        );
        assert.equal(second.ok, true);
        assert.equal(second.data.replayed, true);
        const rows = await membershipRows(orgId, first.data.user_id);
        assert.equal(rows.length, 1);
        assert.equal(await auditCount(), 1);
      });

      await t.test("client_contributor -> client_reviewer -> client_admin -> client_reviewer leaves exactly one stored row at each step, never the old privileged role", async () => {
        await resetAllTables();
        const orgId = await newOrgId();
        const deps = realDeps();
        const step1 = await manageOrganizationMembership(
          { actorContext: platformSuperuserActor(), organizationId: orgId, targetLegacyPublicUserdataId: 103, roleName: "client_contributor", membershipStatus: "active", now: NOW },
          deps,
        );
        const kaiUserId = step1.data.user_id;

        const step2 = await manageOrganizationMembership(
          { actorContext: platformSuperuserActor(), organizationId: orgId, targetLegacyPublicUserdataId: 103, roleName: "client_reviewer", membershipStatus: "active", now: NOW },
          deps,
        );
        assert.equal(step2.ok, true);
        assert.deepEqual(await membershipRows(orgId, kaiUserId), [{ role_name: "client_reviewer", membership_status: "active" }]);

        const step3 = await manageOrganizationMembership(
          { actorContext: platformSuperuserActor(), organizationId: orgId, targetLegacyPublicUserdataId: 103, roleName: "client_admin", membershipStatus: "active", now: NOW },
          deps,
        );
        assert.equal(step3.ok, true);
        assert.deepEqual(await membershipRows(orgId, kaiUserId), [{ role_name: "client_admin", membership_status: "active" }]);

        const step4 = await manageOrganizationMembership(
          { actorContext: platformSuperuserActor(), organizationId: orgId, targetLegacyPublicUserdataId: 103, roleName: "client_reviewer", membershipStatus: "active", now: NOW },
          deps,
        );
        assert.equal(step4.ok, true);
        const finalRows = await membershipRows(orgId, kaiUserId);
        assert.deepEqual(finalRows, [{ role_name: "client_reviewer", membership_status: "active" }]);
        assert.equal(finalRows.some((r) => r.role_name === "client_admin"), false);
        assert.equal(await auditCount(), 4);
      });

      await t.test("inactivating a membership uses the deployed status vocabulary and fails closed for a non-vocabulary status", async () => {
        await resetAllTables();
        const orgId = await newOrgId();
        const deps = realDeps();
        const assigned = await manageOrganizationMembership(
          { actorContext: platformSuperuserActor(), organizationId: orgId, targetLegacyPublicUserdataId: 104, roleName: "client_reviewer", membershipStatus: "active", now: NOW },
          deps,
        );
        const revoked = await manageOrganizationMembership(
          { actorContext: platformSuperuserActor(), organizationId: orgId, targetLegacyPublicUserdataId: 104, roleName: "client_reviewer", membershipStatus: "inactive", now: NOW },
          deps,
        );
        assert.equal(revoked.ok, true);
        assert.deepEqual(await membershipRows(orgId, assigned.data.user_id), [{ role_name: "client_reviewer", membership_status: "inactive" }]);

        const rejected = await manageOrganizationMembership(
          { actorContext: platformSuperuserActor(), organizationId: orgId, targetLegacyPublicUserdataId: 104, roleName: "client_reviewer", membershipStatus: "revoked", now: NOW },
          deps,
        );
        assert.equal(rejected.ok, false);
        assert.equal(rejected.error.code, "validation_blocker");
        assert.deepEqual(await membershipRows(orgId, assigned.data.user_id), [{ role_name: "client_reviewer", membership_status: "inactive" }]);
      });

      await t.test("pre-existing multiple stored client-role rows for one user/org fail closed with zero mutation", async () => {
        await resetAllTables();
        const orgId = await newOrgId();
        const kaiUserId = await seedKaiUser(105);
        await pool.query(
          "INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status) VALUES ($1, $2, 'client_admin', 'active'), ($1, $2, 'client_contributor', 'active')",
          [orgId, kaiUserId],
        );
        const result = await manageOrganizationMembership(
          { actorContext: platformSuperuserActor(), organizationId: orgId, targetLegacyPublicUserdataId: 105, roleName: "client_reviewer", membershipStatus: "active", now: NOW },
          realDeps(),
        );
        assert.equal(result.ok, false);
        assert.equal(result.error.code, "membership_state_conflict");
        const rows = await membershipRows(orgId, kaiUserId);
        assert.equal(rows.length, 2);
        assert.equal(await auditCount(), 0);
      });

      await t.test("last-effective-client-admin protection blocks self-demotion of the sole stored admin with zero mutation", async () => {
        await resetAllTables();
        const orgId = await newOrgId();
        const deps = realDeps();
        const assigned = await manageOrganizationMembership(
          { actorContext: platformSuperuserActor(), organizationId: orgId, targetLegacyPublicUserdataId: 106, roleName: "client_admin", membershipStatus: "active", now: NOW },
          deps,
        );
        const soleAdminActor = storedClientAdminActor(orgId);
        soleAdminActor.actorUserId = assigned.data.user_id;

        const attempt = await manageOrganizationMembership(
          { actorContext: soleAdminActor, organizationId: orgId, targetLegacyPublicUserdataId: 106, roleName: "client_reviewer", membershipStatus: "active", now: NOW },
          deps,
        );
        assert.equal(attempt.ok, false);
        assert.equal(attempt.error.code, "last_admin_protection");
        assert.deepEqual(await membershipRows(orgId, assigned.data.user_id), [{ role_name: "client_admin", membership_status: "active" }]);
        assert.equal(await auditCount(), 1);
      });

      await t.test("derived client_admin remains independent, read-only, and coexists with a lower stored role", async () => {
        await resetAllTables();
        const orgId = await newOrgId();
        const { rows: gkOrgRows } = await pool.query("INSERT INTO public.organizations (name) VALUES ('Derived Admin Org') RETURNING id");
        const gkOrganizationId = gkOrgRows[0].id;
        await pool.query(
          "INSERT INTO kai.gk_organization_bindings (gk_organization_id, kai_organization_id, status) VALUES ($1, $2, 'active')",
          [gkOrganizationId, orgId],
        );
        const { rows: gkUserRows } = await pool.query("INSERT INTO public.userdata (org_id) VALUES ($1) RETURNING id", [gkOrganizationId]);
        const gkUserId = gkUserRows[0].id;
        await pool.query(
          "INSERT INTO public.user_org_memberships (org_id, user_id, role, is_active) VALUES ($1, $2, 'admin', true)",
          [gkOrganizationId, gkUserId],
        );

        const deps = realDeps();
        await manageOrganizationMembership(
          { actorContext: platformSuperuserActor(), organizationId: orgId, targetLegacyPublicUserdataId: gkUserId, roleName: "client_reviewer", membershipStatus: "active", now: NOW },
          deps,
        );

        const view = await viewEffectiveKaiAccess({ actorContext: platformSuperuserActor(), organizationId: orgId }, deps);
        assert.equal(view.ok, true);
        const [row] = view.data.access;
        assert.equal(row.stored_membership.role_name, "client_reviewer");
        assert.equal(row.derived_membership.role_name, "client_admin");
        assert.equal(row.effective_role_name, "client_admin");
        assert.equal(row.authority_source, "both");

        // Derived authority is never persisted: still exactly one stored row,
        // and it is still client_reviewer, not client_admin.
        const kaiUserId = (await pool.query("SELECT user_id FROM kai.users WHERE legacy_public_userdata_id = $1", [gkUserId])).rows[0].user_id;
        assert.deepEqual(await membershipRows(orgId, kaiUserId), [{ role_name: "client_reviewer", membership_status: "active" }]);
      });

      await t.test("cross-tenant client_admin mutation attempt yields zero mutation", async () => {
        await resetAllTables();
        const orgA = await newOrgId();
        const orgB = await newOrgId();
        const deps = realDeps();
        const result = await manageOrganizationMembership(
          { actorContext: storedClientAdminActor(orgA), organizationId: orgB, targetLegacyPublicUserdataId: 107, roleName: "client_reviewer", membershipStatus: "active", now: NOW },
          deps,
        );
        assert.equal(result.ok, false);
        assert.equal(result.error.code, "authorization_denied");
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM kai.organization_memberships")).rows[0].n, 0);
        assert.equal(await auditCount(), 0);
      });

      // --- B. Global KAI role reconciliation -----------------------------------

      await t.test("assign, replay, revoke, and reassign an allowed global GK role is idempotent and soft-stateful (one row throughout)", async () => {
        await resetAllTables();
        const deps = realDeps();
        const assign1 = await manageGlobalKaiRole(
          { actorContext: platformSuperuserActor(), targetLegacyPublicUserdataId: 201, roleName: "gk_admin", action: "assign", now: NOW },
          deps,
        );
        assert.equal(assign1.ok, true);
        assert.equal(assign1.data.replayed, false);
        const kaiUserId = assign1.data.user_id;
        assert.deepEqual(await listKaiRolesForUser(kaiUserId, pool), ["gk_admin"]);
        assert.equal((await userRolesRows(kaiUserId)).length, 1);

        const assign2 = await manageGlobalKaiRole(
          { actorContext: platformSuperuserActor(), targetLegacyPublicUserdataId: 201, roleName: "gk_admin", action: "assign", now: NOW },
          deps,
        );
        assert.equal(assign2.data.replayed, true);
        assert.equal((await userRolesRows(kaiUserId)).length, 1);
        assert.equal(await auditCount(), 1);

        const revoke = await manageGlobalKaiRole(
          { actorContext: platformSuperuserActor(), targetLegacyPublicUserdataId: 201, roleName: "gk_admin", action: "revoke", now: NOW },
          deps,
        );
        assert.equal(revoke.ok, true);
        assert.equal(revoke.data.replayed, false);
        assert.deepEqual(await listKaiRolesForUser(kaiUserId, pool), []);
        const rowsAfterRevoke = await userRolesRows(kaiUserId);
        assert.equal(rowsAfterRevoke.length, 1);
        assert.equal(rowsAfterRevoke[0].active, false);
        assert.ok(rowsAfterRevoke[0].revoked_at);

        const reassign = await manageGlobalKaiRole(
          { actorContext: platformSuperuserActor(), targetLegacyPublicUserdataId: 201, roleName: "gk_admin", action: "assign", now: NOW },
          deps,
        );
        assert.equal(reassign.ok, true);
        assert.equal(reassign.data.replayed, false);
        assert.deepEqual(await listKaiRolesForUser(kaiUserId, pool), ["gk_admin"]);
        const rowsAfterReassign = await userRolesRows(kaiUserId);
        assert.equal(rowsAfterReassign.length, 1, "reassignment reactivates the existing row rather than inserting a second one");
        assert.equal(rowsAfterReassign[0].active, true);
        assert.equal(rowsAfterReassign[0].revoked_at, null);
        assert.equal(await auditCount(), 3);
      });

      await t.test("an org-scoped kai.user_roles row is not treated as a global capability", async () => {
        await resetAllTables();
        const orgId = await newOrgId();
        const kaiUserId = await seedKaiUser(202);
        const { rows: roleRows } = await pool.query("SELECT role_id FROM kai.roles WHERE role_name = 'gk_admin'");
        await pool.query(
          "INSERT INTO kai.user_roles (user_id, role_id, organization_id, active) VALUES ($1, $2, $3, true)",
          [kaiUserId, roleRows[0].role_id, orgId],
        );
        assert.deepEqual(await listKaiRolesForUser(kaiUserId, pool), []);
        assert.deepEqual(await listGlobalRoleAssignmentRows(kaiUserId, pool), []);
      });

      await t.test("an engagement-scoped kai.user_roles row is not treated as a global capability", async () => {
        await resetAllTables();
        const kaiUserId = await seedKaiUser(203);
        const { rows: roleRows } = await pool.query("SELECT role_id FROM kai.roles WHERE role_name = 'gk_operator'");
        const { rows: engagementIdRows } = await pool.query("SELECT gen_random_uuid() AS id");
        await pool.query(
          "INSERT INTO kai.user_roles (user_id, role_id, engagement_id, active) VALUES ($1, $2, $3, true)",
          [kaiUserId, roleRows[0].role_id, engagementIdRows[0].id],
        );
        assert.deepEqual(await listKaiRolesForUser(kaiUserId, pool), []);
        assert.deepEqual(await listGlobalRoleAssignmentRows(kaiUserId, pool), []);
      });

      await t.test("an inactive/revoked global row is not effective while a truly effective global role remains effective", async () => {
        await resetAllTables();
        const kaiUserId = await seedKaiUser(204);
        const { rows: roleRows } = await pool.query("SELECT role_id, role_name FROM kai.roles WHERE role_name IN ('gk_admin', 'gk_reviewer')");
        const gkAdmin = roleRows.find((r) => r.role_name === "gk_admin");
        const gkReviewer = roleRows.find((r) => r.role_name === "gk_reviewer");
        await pool.query(
          "INSERT INTO kai.user_roles (user_id, role_id, active, revoked_at) VALUES ($1, $2, false, now())",
          [kaiUserId, gkAdmin.role_id],
        );
        await pool.query(
          "INSERT INTO kai.user_roles (user_id, role_id, active) VALUES ($1, $2, true)",
          [kaiUserId, gkReviewer.role_id],
        );
        assert.deepEqual(await listKaiRolesForUser(kaiUserId, pool), ["gk_reviewer"]);
      });

      await t.test("non-allowlisted existing kai.roles cannot be granted through manage_global_kai_role", async () => {
        await resetAllTables();
        const deps = realDeps();
        const result = await manageGlobalKaiRole(
          { actorContext: platformSuperuserActor(), targetLegacyPublicUserdataId: 205, roleName: "client_reviewer", action: "assign", now: NOW },
          deps,
        );
        assert.equal(result.ok, false);
        assert.equal(result.error.code, "validation_blocker");
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM kai.user_roles")).rows[0].n, 0);
      });

      await t.test("two genuinely concurrent connections assigning the same global role produce exactly one effective row", async () => {
        await resetAllTables();
        const kaiUserId = await seedKaiUser(206);
        const poolA = new Pool({ connectionString: RUNNER_OWNED_DATABASE_URL, ssl: false, max: 1 });
        const poolB = new Pool({ connectionString: RUNNER_OWNED_DATABASE_URL, ssl: false, max: 1 });
        try {
          const [resultA, resultB] = await Promise.all([
            assignGlobalRole({ userId: kaiUserId, roleName: "gk_operator" }, poolA),
            assignGlobalRole({ userId: kaiUserId, roleName: "gk_operator" }, poolB),
          ]);
          assert.ok(resultA.ok && resultB.ok);
          const mutatedCount = [resultA, resultB].filter((r) => r.mutated).length;
          assert.equal(mutatedCount, 1, "exactly one of the two concurrent callers performed the actual insert");
          const rows = await userRolesRows(kaiUserId);
          assert.equal(rows.length, 1);
          assert.equal(rows[0].active, true);
        } finally {
          await poolA.end();
          await poolB.end();
        }
      });

      // --- C. Audit reconciliation ----------------------------------------------

      await t.test("forced required-audit failure rolls back the membership write (zero rows, zero audit)", async () => {
        await resetAllTables();
        const orgId = await newOrgId();
        const deps = realDeps({
          createProductionMetadataOnlyAuditForAccessAdministration: () => ({
            prepareMetadataOnlyAudit: () => ({
              ok: true,
              async publish() {
                throw new Error("forced_audit_failure");
              },
            }),
          }),
        });
        const result = await manageOrganizationMembership(
          { actorContext: platformSuperuserActor(), organizationId: orgId, targetLegacyPublicUserdataId: 301, roleName: "client_reviewer", membershipStatus: "active", now: NOW },
          deps,
        );
        // publish() itself throwing (as opposed to prepareMetadataOnlyAudit
        // rejecting) surfaces as the generic system_error fallback in
        // kaiAccessAdministrationService.js#shapeThrownError, not
        // validation_blocker - the property under test here is that the
        // transaction rolled back, not the specific error code.
        assert.equal(result.ok, false);
        assert.equal(result.error.code, "system_error");
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM kai.organization_memberships")).rows[0].n, 0);
        assert.equal(await auditCount(), 0);
      });

      await t.test("forced required-audit failure rolls back a global-role assignment (zero rows, zero audit)", async () => {
        await resetAllTables();
        const deps = realDeps({
          createProductionMetadataOnlyAuditForAccessAdministration: () => ({
            prepareMetadataOnlyAudit: () => ({
              ok: true,
              async publish() {
                throw new Error("forced_audit_failure");
              },
            }),
          }),
        });
        const result = await manageGlobalKaiRole(
          { actorContext: platformSuperuserActor(), targetLegacyPublicUserdataId: 302, roleName: "gk_reviewer", action: "assign", now: NOW },
          deps,
        );
        assert.equal(result.ok, false);
        assert.equal(result.error.code, "system_error");
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM kai.user_roles")).rows[0].n, 0);
        assert.equal(await auditCount(), 0);
      });
    } finally {
      await pool.end();
    }
  });
}
