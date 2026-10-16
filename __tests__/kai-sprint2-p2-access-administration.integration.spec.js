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
      // Production target resolution supplies the account's own usable email
      // (findOrCreateKaiUserForAdministrationTarget); a mapping is never
      // created without one, so the synthetic target accounts carry one too.
      findOrCreateKaiUserByLegacyPublicUserdataId: (input) =>
        findOrCreateKaiUserByLegacyPublicUserdataId(
          { ...input, email: input.email ?? `user${input.legacyPublicUserdataId}@example.com` },
          pool,
        ),
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

      // --- A2. Last effective administrator (real router, real actor) --------
      //
      // Every request below goes through the production access-administration
      // router with no service override: requireKaiSprint2Authenticated ->
      // attachKaiSprint2ActorContext (real resolveKaiActorContext, real org
      // scope and GK binding derivation) -> manageOrganizationMembership with
      // its default repository on the ambient pool, which this runner points
      // at its own cluster. Only the Get Kinder session login is simulated.

      const express = (await import("express")).default;
      const accessAdministrationRouter = (await import("../Backend/kai/routes/kaiAccessAdministrationApi.js")).default;
      const BASE = "/api/kai/sprint2/access-administration";
      // orgScopeService selects public.organizations.status (the production
      // column other runners' synthetic mirrors also add).
      await pool.query("ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS status text");

      async function withRealRouter(work) {
        const previousEnabled = process.env.KAI_SPRINT2_ENABLED;
        process.env.KAI_SPRINT2_ENABLED = "true";
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
          const legacyId = Number(req.headers["x-harness-user"]);
          if (Number.isInteger(legacyId) && legacyId > 0) {
            req.user = {
              id: legacyId,
              email: req.headers["x-harness-email"] || `user${legacyId}@guard.test`,
              ...(req.headers["x-harness-admin"] === "1" ? { is_admin: true } : {}),
            };
          }
          req.isAuthenticated = () => Boolean(req.user);
          next();
        });
        app.use(BASE, accessAdministrationRouter);
        const server = await new Promise((resolve) => {
          const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
        });
        const { port } = server.address();
        const call = async (asLegacyId, method, path, body, extraHeaders = {}) => {
          const response = await fetch(`http://127.0.0.1:${port}${BASE}${path}`, {
            method,
            headers: { "x-harness-user": String(asLegacyId), ...extraHeaders, ...(body ? { "content-type": "application/json" } : {}) },
            body: body ? JSON.stringify(body) : undefined,
          });
          return { status: response.status, body: await response.json().catch(() => null) };
        };
        try {
          return await work(call);
        } finally {
          await new Promise((resolve) => server.close(resolve));
          if (previousEnabled === undefined) delete process.env.KAI_SPRINT2_ENABLED;
          else process.env.KAI_SPRINT2_ENABLED = previousEnabled;
        }
      }

      // One public.userdata identity; optionally a kai.users mapping with the
      // given status (null = never provisioned) and a Get Kinder org-admin
      // membership of gkAdminOf.
      async function seedPerson({ kaiStatus = "active", gkAdminOf = null } = {}) {
        const legacyId = (await pool.query("INSERT INTO public.userdata (org_id) VALUES ($1) RETURNING id", [gkAdminOf])).rows[0].id;
        if (gkAdminOf) {
          await pool.query("INSERT INTO public.user_org_memberships (org_id, user_id, role, is_active) VALUES ($1, $2, 'admin', true)", [gkAdminOf, legacyId]);
        }
        let kaiUserId = null;
        if (kaiStatus) {
          kaiUserId = (await pool.query(
            `INSERT INTO kai.users (legacy_identity_source, legacy_public_userdata_id, email, status)
             VALUES ('public.userdata', $1, $2, $3) RETURNING user_id`,
            [legacyId, `user${legacyId}@guard.test`, kaiStatus],
          )).rows[0].user_id;
        }
        return { legacyId, kaiUserId };
      }

      async function storeMembership(organizationId, person, roleName, membershipStatus = "active") {
        await pool.query(
          "INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status) VALUES ($1, $2, $3, $4)",
          [organizationId, person.kaiUserId, roleName, membershipStatus],
        );
      }

      async function boundOrganization() {
        const orgId = await newOrgId();
        const gkOrganizationId = (await pool.query("INSERT INTO public.organizations (name, status) VALUES ('Guard Org', 'approved') RETURNING id")).rows[0].id;
        await pool.query("INSERT INTO kai.gk_organization_bindings (gk_organization_id, kai_organization_id, status) VALUES ($1, $2, 'active')", [gkOrganizationId, orgId]);
        return { orgId, gkOrganizationId };
      }

      const demote = (call, actor, orgId, target, body = { role_name: "client_contributor", membership_status: "active" }) =>
        call(actor.legacyId, "PUT", `/organizations/${orgId}/memberships/${target.legacyId}`, body);

      // The roster row the Team & Access UI reads for a person: its account
      // status, effective authority, and read-time last-administrator answer
      // must agree with the guard's decision on the same data.
      async function rosterRow(call, asPerson, orgId, person) {
        const roster = await call(asPerson.legacyId, "GET", `/organizations/${orgId}/access`);
        assert.equal(roster.status, 200, JSON.stringify(roster.body));
        return roster.body.data.access.find((row) => row.legacy_public_userdata_id === person.legacyId);
      }

      async function assertRejectedWithoutMutation(result, orgId, target) {
        assert.equal(result.status, 409, JSON.stringify(result.body));
        assert.equal(result.body.error.code, "last_admin_protection");
        assert.deepEqual(await membershipRows(orgId, target.kaiUserId), [{ role_name: "client_admin", membership_status: "active" }]);
      }

      await t.test("guard 1: a deactivated (or never provisioned) legacy GK administrator does not count, so the only effective administrator cannot be demoted", async () => {
        for (const derivedStatus of ["inactive", null]) {
          await resetAllTables();
          const { orgId, gkOrganizationId } = await boundOrganization();
          const derived = await seedPerson({ kaiStatus: derivedStatus, gkAdminOf: gkOrganizationId });
          const admin = await seedPerson();
          await storeMembership(orgId, admin, "client_admin");
          await withRealRouter(async (call) => {
            const derivedRow = await rosterRow(call, admin, orgId, derived);
            assert.equal(derivedRow.effective_role_name, "client_admin");
            assert.equal(derivedRow.kai_account_status, derivedStatus === null ? "not_activated" : "inactive");
            assert.equal(derivedRow.effective_admin_authority, false);
            assert.equal((await rosterRow(call, admin, orgId, admin)).last_admin_protected, true);
            const auditsBefore = await auditCount();
            await assertRejectedWithoutMutation(await demote(call, admin, orgId, admin), orgId, admin);
            // The same direct API with an inactive status is refused too.
            await assertRejectedWithoutMutation(
              await demote(call, admin, orgId, admin, { role_name: "client_admin", membership_status: "inactive" }), orgId, admin);
            assert.equal(await auditCount(), auditsBefore, `derived kai status ${derivedStatus}: nothing audited`);
          });
        }
      });

      await t.test("guard 2: with two effective stored administrators one may be demoted, then the remaining one is protected", async () => {
        await resetAllTables();
        const orgId = await newOrgId();
        const first = await seedPerson();
        const second = await seedPerson();
        await storeMembership(orgId, first, "client_admin");
        await storeMembership(orgId, second, "client_admin");
        await withRealRouter(async (call) => {
          assert.equal((await rosterRow(call, first, orgId, first)).last_admin_protected, false);
          assert.equal((await rosterRow(call, first, orgId, second)).last_admin_protected, false);
          const allowed = await demote(call, first, orgId, second);
          assert.equal(allowed.status, 200, JSON.stringify(allowed.body));
          assert.deepEqual(await membershipRows(orgId, second.kaiUserId), [{ role_name: "client_contributor", membership_status: "active" }]);
          assert.equal((await rosterRow(call, first, orgId, first)).last_admin_protected, true);
          await assertRejectedWithoutMutation(await demote(call, first, orgId, first), orgId, first);
        });
      });

      await t.test("guard 3: an active legacy-derived administrator counts and can actually administer", async () => {
        await resetAllTables();
        const { orgId, gkOrganizationId } = await boundOrganization();
        const derived = await seedPerson({ gkAdminOf: gkOrganizationId });
        const admin = await seedPerson();
        await storeMembership(orgId, admin, "client_admin");
        await withRealRouter(async (call) => {
          assert.equal((await call(derived.legacyId, "GET", `/organizations/${orgId}/access`)).status, 200, "the derived administrator is effective");
          const derivedRow = await rosterRow(call, admin, orgId, derived);
          assert.deepEqual([derivedRow.kai_account_status, derivedRow.effective_admin_authority], ["active", true]);
          assert.equal((await rosterRow(call, admin, orgId, admin)).last_admin_protected, false);
          const allowed = await demote(call, admin, orgId, admin);
          assert.equal(allowed.status, 200, JSON.stringify(allowed.body));
        });
      });

      await t.test("guard 4-5: a stored administrator counts only while both the membership and the KAI account are active", async () => {
        for (const other of [
          { membershipStatus: "active", kaiStatus: "active", counts: true },
          { membershipStatus: "inactive", kaiStatus: "active", counts: false },
          { membershipStatus: "revoked", kaiStatus: "active", counts: false },
          { membershipStatus: "active", kaiStatus: "inactive", counts: false },
        ]) {
          await resetAllTables();
          const orgId = await newOrgId();
          const admin = await seedPerson();
          const otherAdmin = await seedPerson({ kaiStatus: other.kaiStatus });
          await storeMembership(orgId, admin, "client_admin");
          await storeMembership(orgId, otherAdmin, "client_admin", other.membershipStatus);
          await withRealRouter(async (call) => {
            const otherRow = await rosterRow(call, admin, orgId, otherAdmin);
            assert.equal(otherRow.kai_account_status, other.kaiStatus, JSON.stringify(other));
            assert.equal(otherRow.effective_admin_authority, other.counts, JSON.stringify(other));
            assert.equal((await rosterRow(call, admin, orgId, admin)).last_admin_protected, !other.counts, JSON.stringify(other));
            const result = await demote(call, admin, orgId, admin);
            if (other.counts) assert.equal(result.status, 200, JSON.stringify(other));
            else await assertRejectedWithoutMutation(result, orgId, admin);
          });
        }
      });

      await t.test("guard 6: a person with both derived and stored authority is one administrator, counted once and only while active", async () => {
        await resetAllTables();
        let { orgId, gkOrganizationId } = await boundOrganization();
        let both = await seedPerson({ gkAdminOf: gkOrganizationId });
        await storeMembership(orgId, both, "client_admin");
        const admin = await seedPerson();
        await storeMembership(orgId, admin, "client_admin");
        await withRealRouter(async (call) => {
          const roster = await call(admin.legacyId, "GET", `/organizations/${orgId}/access`);
          assert.equal(roster.body.data.access.filter((row) => row.legacy_public_userdata_id === both.legacyId).length, 1);
          assert.equal(roster.body.data.access.find((row) => row.legacy_public_userdata_id === both.legacyId).authority_source, "both");
          assert.equal(roster.body.data.access.filter((row) => row.effective_admin_authority === true).length, 2, "counted once");
          assert.equal((await rosterRow(call, admin, orgId, admin)).last_admin_protected, false);
          assert.equal((await demote(call, admin, orgId, admin)).status, 200);
          // Their own stored role may go: the derived authority remains.
          assert.equal((await demote(call, both, orgId, both)).status, 200);
          assert.equal((await call(both.legacyId, "GET", `/organizations/${orgId}/access`)).status, 200);
        });

        // The same person with a deactivated KAI account counts through
        // neither source.
        await resetAllTables();
        ({ orgId, gkOrganizationId } = await boundOrganization());
        both = await seedPerson({ kaiStatus: "inactive", gkAdminOf: gkOrganizationId });
        await storeMembership(orgId, both, "client_admin");
        const soleAdmin = await seedPerson();
        await storeMembership(orgId, soleAdmin, "client_admin");
        await withRealRouter(async (call) => {
          assert.equal((await call(both.legacyId, "GET", `/organizations/${orgId}/access`)).status, 403, "a deactivated account cannot act");
          const bothRow = await rosterRow(call, soleAdmin, orgId, both);
          assert.deepEqual([bothRow.authority_source, bothRow.stored_membership.role_name, bothRow.kai_account_status, bothRow.effective_admin_authority],
            ["both", "client_admin", "inactive", false]);
          assert.equal((await rosterRow(call, soleAdmin, orgId, soleAdmin)).last_admin_protected, true);
          await assertRejectedWithoutMutation(await demote(call, soleAdmin, orgId, soleAdmin), orgId, soleAdmin);
        });
      });

      await t.test("guard 7: two administrators demoting each other at the same time leave exactly one administrator", async () => {
        for (let round = 0; round < 3; round += 1) {
          await resetAllTables();
          const orgId = await newOrgId();
          const first = await seedPerson();
          const second = await seedPerson();
          await storeMembership(orgId, first, "client_admin");
          await storeMembership(orgId, second, "client_admin");
          await withRealRouter(async (call) => {
            const results = await Promise.all([demote(call, first, orgId, second), demote(call, second, orgId, first)]);
            assert.deepEqual(results.map((r) => r.status).sort(), [200, 409], JSON.stringify(results.map((r) => r.body)));
          });
          const admins = await pool.query(
            "SELECT count(*)::int AS n FROM kai.organization_memberships WHERE organization_id = $1 AND role_name = 'client_admin' AND membership_status = 'active'",
            [orgId],
          );
          assert.equal(admins.rows[0].n, 1, `round ${round}`);
          assert.equal(await auditCount(), 1, `round ${round}: one change audited`);
        }
      });

      await t.test("guard 8: GK staff-role protection and the organization boundary still hold on the real path", async () => {
        await resetAllTables();
        const orgA = await newOrgId();
        const orgB = await newOrgId();
        const adminA = await seedPerson();
        const adminB = await seedPerson();
        const staff = await seedPerson();
        await storeMembership(orgA, adminA, "client_admin");
        await storeMembership(orgB, adminB, "client_admin");
        await storeMembership(orgA, staff, "gk_reviewer");
        await withRealRouter(async (call) => {
          const rewrite = await demote(call, adminA, orgA, staff);
          assert.equal(rewrite.status, 403);
          assert.equal(rewrite.body.blockers[0].blocking_reason, "non_client_membership_not_client_managed");
          const crossOrg = await demote(call, adminB, orgA, adminA);
          assert.equal(crossOrg.status, 403);
        });
        assert.deepEqual(await membershipRows(orgA, staff.kaiUserId), [{ role_name: "gk_reviewer", membership_status: "active" }]);
        assert.deepEqual(await membershipRows(orgA, adminA.kaiUserId), [{ role_name: "client_admin", membership_status: "active" }]);
        assert.equal(await auditCount(), 0);
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

      // --- D. Target account without a usable email (real router) --------------
      //
      // Both writers map a target who has never used KAI from their Get Kinder
      // account email. Each case runs under this runner's nullable kai.users
      // mirror and under the USER_CONFIRMED deployed NOT NULL email (applied
      // to the empty table for the case, then removed).

      const MIRRORS = [
        { name: "nullable mirror", apply: async () => {}, remove: async () => {} },
        {
          name: "deployed NOT NULL email",
          apply: () => pool.query("ALTER TABLE kai.users ALTER COLUMN email SET NOT NULL"),
          remove: () => pool.query("ALTER TABLE kai.users ALTER COLUMN email DROP NOT NULL"),
        },
      ];

      async function underMirror(mirror, work) {
        await resetAllTables();
        await mirror.apply();
        try {
          await work();
        } finally {
          await mirror.remove();
        }
      }

      const SUPERUSER_HEADERS = { "x-harness-admin": "1" };

      async function seedAccount(email = null) {
        return (await pool.query("INSERT INTO public.userdata (org_id, email) VALUES (NULL, $1) RETURNING id", [email])).rows[0].id;
      }

      async function writeState() {
        const count = async (table) => Number((await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n);
        return {
          users: await count("kai.users"),
          userRoles: await count("kai.user_roles"),
          memberships: await count("kai.organization_memberships"),
          audits: await auditCount(),
          accounts: (await pool.query("SELECT id, org_id, email FROM public.userdata ORDER BY id")).rows,
        };
      }

      async function kaiUserRowsFor(legacyId) {
        return (await pool.query(
          "SELECT user_id, legacy_identity_source, legacy_public_userdata_id, status, email, created_at, updated_at FROM kai.users WHERE legacy_public_userdata_id = $1",
          [legacyId],
        )).rows;
      }

      const grantGlobal = (call, superuserId, targetId) =>
        call(superuserId, "PUT", `/global-roles/${targetId}`, { role_name: "gk_reviewer", action: "assign" }, SUPERUSER_HEADERS);
      const grantGkMembership = (call, superuserId, orgId, targetId) =>
        call(superuserId, "PUT", `/organizations/${orgId}/memberships/${targetId}`, { role_name: "gk_reviewer", membership_status: "active" }, SUPERUSER_HEADERS);

      function assertUnusableEmailBlocker(result, validatorKey, accountEmail) {
        assert.equal(result.status, 422, JSON.stringify(result.body));
        assert.equal(result.body.error.code, "validation_blocker");
        assert.equal(result.body.blockers.length, 1);
        assert.equal(result.body.blockers[0].validator_key, validatorKey);
        assert.equal(result.body.blockers[0].blocking_reason, "target_account_email_unusable");
        const text = JSON.stringify(result.body);
        for (const leak of ["kai.users", "constraint", "violates", "null value", "insert", "provisioning", "23502", "23514"]) {
          assert.equal(text.toLowerCase().includes(leak.toLowerCase()), false, `response leaks ${leak}: ${text}`);
        }
        if (accountEmail) assert.equal(text.includes(accountEmail), false, `response leaks the account email: ${text}`);
      }

      await t.test("missing-email 1: a never-signed-in account with no usable email is refused on both writers with a 422 blocker and nothing written", async () => {
        for (const mirror of MIRRORS) {
          for (const accountEmail of [null, "", "   "]) {
            await underMirror(mirror, async () => {
              const orgId = await newOrgId();
              const superuser = await seedPerson();
              const target = await seedAccount(accountEmail);
              const before = await writeState();
              await withRealRouter(async (call) => {
                assertUnusableEmailBlocker(await grantGlobal(call, superuser.legacyId, target), "VAL-KAI-P2-ACC-002");
                assertUnusableEmailBlocker(await grantGkMembership(call, superuser.legacyId, orgId, target), "VAL-KAI-P2-ACC-001");
              });
              assert.deepEqual(await kaiUserRowsFor(target), [], `${mirror.name} / ${JSON.stringify(accountEmail)}: no identity`);
              assert.deepEqual(await writeState(), before, `${mirror.name} / ${JSON.stringify(accountEmail)}: nothing written, account unchanged`);
            });
          }
        }
      });

      await t.test("missing-email 2: an organization administrator provisioning client_reviewer for such an account gets the same blocker, nothing written", async () => {
        for (const mirror of MIRRORS) {
          await underMirror(mirror, async () => {
            const orgId = await newOrgId();
            const admin = await seedPerson();
            await storeMembership(orgId, admin, "client_admin");
            const target = await seedAccount(null);
            const before = await writeState();
            await withRealRouter(async (call) => {
              const result = await call(admin.legacyId, "PUT", `/organizations/${orgId}/memberships/${target}`, { role_name: "client_reviewer", membership_status: "active" });
              assertUnusableEmailBlocker(result, "VAL-KAI-P2-ACC-001");
            });
            assert.deepEqual(await writeState(), before, mirror.name);
          });
        }
      });

      await t.test("missing-email 3: an account email the deployed kai.users contract rejects is the same blocker, not a 500 (synthetic CHECK stand-in)", async () => {
        // A synthetic stand-in for an email the deployed kai.users email type
        // refuses; the deployed type's own definition is not mirrored here.
        await resetAllTables();
        await pool.query("ALTER TABLE kai.users ADD CONSTRAINT kai_users_email_synthetic_shape_check CHECK (email LIKE '%_@_%')");
        try {
          const orgId = await newOrgId();
          const superuser = await seedPerson();
          const target = await seedAccount("not-an-email");
          const before = await writeState();
          await withRealRouter(async (call) => {
            assertUnusableEmailBlocker(await grantGlobal(call, superuser.legacyId, target), "VAL-KAI-P2-ACC-002", "not-an-email");
            assertUnusableEmailBlocker(await grantGkMembership(call, superuser.legacyId, orgId, target), "VAL-KAI-P2-ACC-001", "not-an-email");
          });
          assert.deepEqual(await writeState(), before);
        } finally {
          await pool.query("ALTER TABLE kai.users DROP CONSTRAINT kai_users_email_synthetic_shape_check");
        }
      });

      await t.test("missing-email 4: an existing active identity is reused unchanged whatever the account email now is", async () => {
        for (const mirror of MIRRORS) {
          for (const accountEmail of [null, "changed@guard.test"]) {
            await underMirror(mirror, async () => {
              const orgId = await newOrgId();
              const superuser = await seedPerson();
              const target = await seedAccount(accountEmail);
              const kaiUserId = (await pool.query(
                `INSERT INTO kai.users (legacy_identity_source, legacy_public_userdata_id, email, status)
                 VALUES ('public.userdata', $1, 'kept@guard.test', 'active') RETURNING user_id`,
                [target],
              )).rows[0].user_id;
              const identityBefore = await kaiUserRowsFor(target);
              await withRealRouter(async (call) => {
                const global = await grantGlobal(call, superuser.legacyId, target);
                assert.equal(global.status, 200, JSON.stringify(global.body));
                assert.equal(global.body.data.user_id, kaiUserId);
                const membership = await grantGkMembership(call, superuser.legacyId, orgId, target);
                assert.equal(membership.status, 200, JSON.stringify(membership.body));
                assert.equal(membership.body.data.user_id, kaiUserId);
              });
              const label = `${mirror.name} / ${JSON.stringify(accountEmail)}`;
              assert.deepEqual(await kaiUserRowsFor(target), identityBefore, `${label}: identity untouched`);
              assert.equal((await userRolesRows(kaiUserId)).filter((row) => row.active).length, 1, label);
              assert.deepEqual(await membershipRows(orgId, kaiUserId), [{ role_name: "gk_reviewer", membership_status: "active" }], label);
              assert.equal(await auditCount(), 2, label);
              assert.deepEqual(
                (await pool.query("SELECT email FROM public.userdata WHERE id = $1", [target])).rows,
                [{ email: accountEmail }],
                `${label}: account unchanged`,
              );
            });
          }
        }
      });

      await t.test("missing-email 5: callers without authority are refused identically whatever the target account's identity or email state", async () => {
        for (const mirror of MIRRORS) {
          await underMirror(mirror, async () => {
            const orgA = await newOrgId();
            const orgB = await newOrgId();
            const plain = await seedPerson();
            const adminA = await seedPerson();
            const adminB = await seedPerson();
            await storeMembership(orgA, adminA, "client_admin");
            await storeMembership(orgB, adminB, "client_admin");
            const targets = {
              noEmail: await seedAccount(null),
              validEmail: await seedAccount("valid@guard.test"),
              mapped: (await seedPerson()).legacyId,
              absent: 987654,
            };
            const attempts = [
              ["no-role caller, global role", plain, "PUT", (id) => `/global-roles/${id}`, { role_name: "gk_reviewer", action: "assign" }, 403],
              ["no-role caller, membership", plain, "PUT", (id) => `/organizations/${orgA}/memberships/${id}`, { role_name: "client_reviewer", membership_status: "active" }, 403],
              ["organization administrator, global role", adminA, "PUT", (id) => `/global-roles/${id}`, { role_name: "gk_reviewer", action: "assign" }, 403],
              ["other organization's administrator", adminB, "PUT", (id) => `/organizations/${orgA}/memberships/${id}`, { role_name: "client_reviewer", membership_status: "active" }, 403],
              ["organization administrator, gk_reviewer membership", adminA, "PUT", (id) => `/organizations/${orgA}/memberships/${id}`, { role_name: "gk_reviewer", membership_status: "active" }, 403],
            ];
            const before = await writeState();
            await withRealRouter(async (call) => {
              for (const [label, caller, method, path, body, expectedStatus] of attempts) {
                const responses = [];
                for (const targetId of Object.values(targets)) responses.push(await call(caller.legacyId, method, path(targetId), body));
                assert.equal(responses[0].status, expectedStatus, `${mirror.name} / ${label}: ${JSON.stringify(responses[0].body)}`);
                for (const response of responses.slice(1)) {
                  assert.deepEqual(response, responses[0], `${mirror.name} / ${label}: same response for every target`);
                }
                assert.equal(JSON.stringify(responses[0].body).includes("target_account_email_unusable"), false, label);
              }
            });
            assert.deepEqual(await writeState(), before, `${mirror.name}: nothing written`);
          });
        }
      });

      await t.test("missing-email 6: after the account gets an email, the retry provisions one identity, both grants hold, and first sign-in reuses it", async () => {
        for (const mirror of MIRRORS) {
          await underMirror(mirror, async () => {
            const orgId = await newOrgId();
            const superuser = await seedPerson();
            const target = await seedAccount(null);
            await withRealRouter(async (call) => {
              assertUnusableEmailBlocker(await grantGlobal(call, superuser.legacyId, target), "VAL-KAI-P2-ACC-002");
              assertUnusableEmailBlocker(await grantGkMembership(call, superuser.legacyId, orgId, target), "VAL-KAI-P2-ACC-001");
              assert.deepEqual(await kaiUserRowsFor(target), []);

              await pool.query("UPDATE public.userdata SET email = 'retry@guard.test' WHERE id = $1", [target]);
              const global = await grantGlobal(call, superuser.legacyId, target);
              assert.equal(global.status, 200, JSON.stringify(global.body));
              assert.equal(global.body.data.replayed, false);
              const membership = await grantGkMembership(call, superuser.legacyId, orgId, target);
              assert.equal(membership.status, 200, JSON.stringify(membership.body));
              assert.equal(membership.body.data.user_id, global.body.data.user_id);

              const provisioned = await kaiUserRowsFor(target);
              assert.equal(provisioned.length, 1, mirror.name);
              assert.equal(provisioned[0].email, "retry@guard.test");
              assert.equal(provisioned[0].status, "active");
              const kaiUserId = provisioned[0].user_id;
              assert.equal((await userRolesRows(kaiUserId)).filter((row) => row.active && row.organization_id === null).length, 1);
              assert.deepEqual(await membershipRows(orgId, kaiUserId), [{ role_name: "gk_reviewer", membership_status: "active" }]);
              assert.equal(await auditCount(), 2);

              // First sign-in: actor resolution maps the signed-in account to
              // the provisioned identity (an authorization refusal of this
              // client_admin read, not mapped_kai_user_required).
              const firstSignIn = await call(target, "GET", `/organizations/${orgId}/access`, undefined, { "x-harness-email": "retry@guard.test" });
              assert.equal(firstSignIn.status, 403, JSON.stringify(firstSignIn.body));
              assert.notEqual(firstSignIn.body.error.code, "mapped_kai_user_required");
              assert.deepEqual(await kaiUserRowsFor(target), provisioned, `${mirror.name}: same single identity after first sign-in`);
            });
          });
        }
      });
      // --- B/E. Independent grants, explicit replacement, targeted revocation
      //
      // Owner decision B/E (C04-C06) on the production router with real actor
      // resolution: a superuser, a delegated GK administrator (global +
      // organization gk_admin, both written by governed routes), and the
      // persisted kai.organization_memberships / kai.audit_events rows.

      const { resolveKaiActorContext } = await import("../Backend/kai/auth/kaiActorContext.js");
      const { authorizeSourcePromotionDecision } = await import("../Backend/kai/services/kaiSourcePromotionService.js");

      const grantRole = (call, actor, orgId, target, roleName) =>
        call(actor.legacyId, "POST", `/organizations/${orgId}/memberships/${target.legacyId}/roles`, { role_name: roleName }, actor.headers);
      const revokeRole = (call, actor, orgId, target, roleName) =>
        call(actor.legacyId, "POST", `/organizations/${orgId}/memberships/${target.legacyId}/roles/${roleName}/revoke`, {}, actor.headers);
      const sortedRows = async (orgId, person) => (await membershipRows(orgId, person.kaiUserId))
        .sort((a, b) => a.role_name.localeCompare(b.role_name));
      const auditMetadata = async () => (await pool.query(
        "SELECT actor_user_id, organization_id, metadata FROM kai.audit_events ORDER BY created_at, audit_event_id",
      )).rows;
      const freshActor = async (person) => {
        const resolved = await resolveKaiActorContext({ id: person.legacyId, email: `user${person.legacyId}@guard.test` });
        assert.equal(resolved.ok, true, JSON.stringify(resolved));
        return resolved.actorContext;
      };

      // A superuser and a delegated GK administrator provisioned through the
      // governed routes only: global gk_admin (superuser global-role route),
      // then organization gk_admin (superuser organization grant).
      async function governedAdministrators(call, orgId) {
        const superuser = { ...(await seedPerson()), headers: { "x-harness-admin": "1" } };
        const gkAdmin = await seedPerson();
        assert.equal((await call(superuser.legacyId, "PUT", `/global-roles/${gkAdmin.legacyId}`, { role_name: "gk_admin", action: "assign" }, superuser.headers)).status, 200);
        assert.equal((await grantRole(call, superuser, orgId, gkAdmin, "gk_admin")).status, 200);
        return { superuser, gkAdmin };
      }

      await t.test("B/E 1: additive grants coexist as separate rows, preserve the existing client role, replay writes nothing, and persist truthful audit", async () => {
        await resetAllTables();
        const orgId = await newOrgId();
        const member = await seedPerson();
        await storeMembership(orgId, member, "client_contributor");
        await withRealRouter(async (call) => {
          const { superuser, gkAdmin } = await governedAdministrators(call, orgId);
          const before = await auditCount();
          const granted = await grantRole(call, gkAdmin, orgId, member, "gk_operator");
          assert.equal(granted.status, 200, JSON.stringify(granted.body));
          assert.equal(granted.body.data.organization_access_admitted, false);
          assert.equal((await grantRole(call, gkAdmin, orgId, member, "gk_reviewer")).status, 200);
          const replay = await grantRole(call, gkAdmin, orgId, member, "gk_operator");
          assert.deepEqual([replay.status, replay.body.data.replayed], [200, true]);
          assert.deepEqual(await sortedRows(orgId, member), [
            { role_name: "client_contributor", membership_status: "active" },
            { role_name: "gk_operator", membership_status: "active" },
            { role_name: "gk_reviewer", membership_status: "active" },
          ]);
          assert.deepEqual((await userRolesRows(member.kaiUserId)).length, 0, "no global role created");
          assert.equal(await auditCount(), before + 2);
          const audits = (await auditMetadata()).slice(-2);
          assert.deepEqual(audits.map((row) => [row.actor_user_id, row.organization_id, row.metadata.operation, row.metadata.role_name, row.metadata.authority_source, row.metadata.target_user_id]), [
            [gkAdmin.kaiUserId, orgId, "organization_role_granted", "gk_operator", "delegated_gk_admin", member.kaiUserId],
            [gkAdmin.kaiUserId, orgId, "organization_role_granted", "gk_reviewer", "delegated_gk_admin", member.kaiUserId],
          ]);
          // The superuser's own grants were audited with its authority.
          assert.deepEqual((await auditMetadata()).slice(0, 2).map((row) => [row.metadata.operation, row.metadata.authority_source]), [
            ["global_kai_role_assigned", "platform_superuser"],
            ["organization_role_granted_access_admitted", "platform_superuser"],
          ]);
          assert.ok(superuser);
        });
      });

      await t.test("B/E 2: explicit replacement changes only the named row; an unnamed or conflicting replacement fails closed", async () => {
        await resetAllTables();
        const orgId = await newOrgId();
        const member = await seedPerson();
        await storeMembership(orgId, member, "client_contributor");
        await storeMembership(orgId, member, "gk_reviewer");
        await withRealRouter(async (call) => {
          const { gkAdmin } = await governedAdministrators(call, orgId);
          const before = await auditCount();
          const unnamed = await demote(call, gkAdmin, orgId, member, { role_name: "gk_operator", membership_status: "active" });
          assert.deepEqual([unnamed.status, unnamed.body.error.code], [409, "membership_state_conflict"]);
          const intoHeld = await demote(call, gkAdmin, orgId, member, { role_name: "gk_reviewer", membership_status: "active", previous_role_name: "client_contributor" });
          assert.equal(intoHeld.status, 403, "the delegated GK administrator does not manage the client row");
          const replaced = await demote(call, gkAdmin, orgId, member, { role_name: "gk_operator", membership_status: "active", previous_role_name: "gk_reviewer" });
          assert.equal(replaced.status, 200, JSON.stringify(replaced.body));
          assert.deepEqual(await sortedRows(orgId, member), [
            { role_name: "client_contributor", membership_status: "active" },
            { role_name: "gk_operator", membership_status: "active" },
          ]);
          assert.equal(await auditCount(), before + 1);
          const audit = (await auditMetadata()).at(-1).metadata;
          assert.deepEqual([audit.operation, audit.previous_role_name, audit.resulting_role_name, audit.authority_source], ["organization_role_replaced", "gk_reviewer", "gk_operator", "delegated_gk_admin"]);
        });
      });

      await t.test("B/E 3: the governed operator path - global + organization gk_operator admit P1-08 on a freshly resolved actor, and targeted revocation removes it while other roles remain", async () => {
        await resetAllTables();
        const orgId = await newOrgId();
        const operator = await seedPerson();
        await storeMembership(orgId, operator, "client_contributor");
        await withRealRouter(async (call) => {
          const { superuser, gkAdmin } = await governedAdministrators(call, orgId);
          assert.equal(authorizeSourcePromotionDecision(await freshActor(operator), orgId).ok, false);
          assert.equal((await call(superuser.legacyId, "PUT", `/global-roles/${operator.legacyId}`, { role_name: "gk_operator", action: "assign" }, superuser.headers)).status, 200);
          assert.equal(authorizeSourcePromotionDecision(await freshActor(operator), orgId).ok, false, "global role alone");
          assert.equal((await grantRole(call, gkAdmin, orgId, operator, "gk_operator")).status, 200);
          const admitted = await freshActor(operator);
          assert.equal(authorizeSourcePromotionDecision(admitted, orgId).ok, true);
          assert.equal(authorizeSourcePromotionDecision(admitted, await newOrgId()).ok, false);

          const revoked = await revokeRole(call, gkAdmin, orgId, operator, "gk_operator");
          assert.deepEqual([revoked.status, revoked.body.data.remaining_active_role_names], [200, ["client_contributor"]]);
          const after = await freshActor(operator);
          const denied = authorizeSourcePromotionDecision(after, orgId);
          assert.deepEqual([denied.ok, denied.error.blockers[0].blocking_reason], [false, "role_not_allowed"]);
          assert.deepEqual(after.kaiRoles, ["gk_operator"], "the global role is left to its own governed operation");
          assert.deepEqual(await sortedRows(orgId, operator), [
            { role_name: "client_contributor", membership_status: "active" },
            { role_name: "gk_operator", membership_status: "inactive" },
          ]);
          const replay = await revokeRole(call, gkAdmin, orgId, operator, "gk_operator");
          assert.deepEqual([replay.status, replay.body.data.replayed], [200, true]);
          assert.equal((await auditMetadata()).at(-1).metadata.operation, "organization_role_revoked");
        });
      });

      await t.test("B/E 4: concurrent identical grants and revocations converge to one row and one audit; concurrent different grants both hold", async () => {
        for (let round = 0; round < 3; round += 1) {
          await resetAllTables();
          const orgId = await newOrgId();
          const member = await seedPerson();
          await withRealRouter(async (call) => {
            const { gkAdmin } = await governedAdministrators(call, orgId);
            const before = await auditCount();
            const grants = await Promise.all([1, 2, 3].map(() => grantRole(call, gkAdmin, orgId, member, "gk_operator")));
            assert.deepEqual(grants.map((r) => r.status), [200, 200, 200], JSON.stringify(grants.map((r) => r.body)));
            assert.equal(grants.filter((r) => r.body.data.replayed === false).length, 1, `round ${round}`);
            assert.equal(await auditCount(), before + 1, `round ${round}`);
            const both = await Promise.all([grantRole(call, gkAdmin, orgId, member, "gk_reviewer"), revokeRole(call, gkAdmin, orgId, member, "gk_operator"), revokeRole(call, gkAdmin, orgId, member, "gk_operator")]);
            assert.deepEqual(both.map((r) => r.status), [200, 200, 200], JSON.stringify(both.map((r) => r.body)));
            assert.deepEqual(await sortedRows(orgId, member), [
              { role_name: "gk_operator", membership_status: "inactive" },
              { role_name: "gk_reviewer", membership_status: "active" },
            ], `round ${round}`);
            assert.equal(await auditCount(), before + 3, `round ${round}: one grant, one reviewer grant, one revocation`);
          });
        }
      });

      await t.test("B/E 5: delegated GK administrator boundaries and self-elevation refusal hold on the real path with zero mutation", async () => {
        await resetAllTables();
        const orgId = await newOrgId();
        const otherOrg = await newOrgId();
        const member = await seedPerson();
        const clientAdmin = await seedPerson();
        await storeMembership(orgId, member, "client_contributor");
        await storeMembership(orgId, clientAdmin, "client_admin");
        await withRealRouter(async (call) => {
          const { gkAdmin } = await governedAdministrators(call, orgId);
          const before = await auditCount();
          const reasons = [];
          for (const attempt of [
            grantRole(call, gkAdmin, orgId, member, "gk_admin"),
            grantRole(call, gkAdmin, orgId, member, "client_reviewer"),
            grantRole(call, gkAdmin, orgId, gkAdmin, "gk_operator"),
            grantRole(call, gkAdmin, otherOrg, member, "gk_operator"),
            revokeRole(call, gkAdmin, orgId, gkAdmin, "gk_admin"),
            grantRole(call, clientAdmin, orgId, member, "gk_reviewer"),
            grantRole(call, clientAdmin, orgId, clientAdmin, "client_reviewer"),
            call(gkAdmin.legacyId, "PUT", `/global-roles/${member.legacyId}`, { role_name: "gk_operator", action: "assign" }),
          ]) {
            const result = await attempt;
            assert.equal(result.status, 403, JSON.stringify(result.body));
            reasons.push(result.body.blockers[0].blocking_reason);
          }
          assert.deepEqual(reasons, [
            "organization_role_not_administrable",
            "organization_role_not_administrable",
            "self_role_elevation_not_allowed",
            "missing_active_organization_membership",
            "organization_role_not_administrable",
            "non_client_membership_not_client_managed",
            "self_role_elevation_not_allowed",
            "platform_superuser_required",
          ]);
          assert.equal(await auditCount(), before);
          assert.deepEqual(await sortedRows(orgId, member), [{ role_name: "client_contributor", membership_status: "active" }]);
          assert.deepEqual(await sortedRows(orgId, gkAdmin), [{ role_name: "gk_admin", membership_status: "active" }]);
        });
      });

    } finally {
      await pool.end();
      const { default: ambientPool } = await import("../Backend/db/pg.js");
      await ambientPool.end().catch(() => {});
    }
  });
}
