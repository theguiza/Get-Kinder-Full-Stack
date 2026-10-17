import test from "node:test";
import assert from "node:assert/strict";
import {
  assertLoopbackDatabaseUrl,
  launchChrome,
  signIn as signInThroughLogin,
  signOut as signOutThroughLogout,
  startLoopbackSmtpSink,
  startRealApplication,
} from "./support/kaiRealApplicationBrowserHarness.js";

/**
 * Explicit Get Kinder organization-administrator revocation, run only by
 *   node scripts/kai-client-knowledge-studio-browser-acceptance-local-postgres.js \
 *     __tests__/kai-organization-administrator-revocation-browser-acceptance.integration.spec.js
 * against that runner's ephemeral loopback PostgreSQL. Skipped otherwise.
 *
 * The repository's own index.js runs as a loopback child process and every
 * actor signs in through the real /login form. Effective authority is read
 * through protected requests (Get Kinder organization portal, organization
 * description, event creation; KAI organizations, Team & Access, join-request
 * approval, role changes, Projects) from a session established before the
 * change and from a fresh sign-in, and through the real Get Kinder and KAI
 * authority resolvers.
 *
 * Invariant: an explicitly deactivated public.user_org_memberships row for an
 * organization is never overridden by the legacy public.userdata
 * org_rep/org_id fields that still name that organization. A person with no
 * membership row for their legacy organization (legacy-only) keeps it.
 *
 * FIXTURES (direct SQL, never the behavior under test): accounts with bcrypt
 * passwords (one is_admin site admin), two bound Get Kinder organizations
 * with their administrators (membership and legacy fields), members, Projects,
 * pending join requests, a legacy-only administrator, a representative with
 * a non-admin membership, an administrator of both organizations and a GK
 * staff member. The deactivation itself is the out-of-band fixture change:
 * no application route deactivates a Get Kinder organization membership.
 */

const RUNNER_DATABASE_URL = process.env.KAI_CLIENT_BROWSER_ACCEPTANCE_DATABASE_URL;
const CHROME = process.env.KAI_CLIENT_BROWSER_ACCEPTANCE_CHROME;
const WORKDIR = process.env.KAI_CLIENT_BROWSER_ACCEPTANCE_WORKDIR;

test("organization administrator revocation isolation: a non-loopback runner URL is refused", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
});

if (!RUNNER_DATABASE_URL || !CHROME || !WORKDIR) {
  test("organization administrator revocation requires its runner", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_DATABASE_URL);
  await runAcceptance();
}

async function runAcceptance() {
  const { Pool } = await import("pg");
  const bcrypt = (await import("bcrypt")).default;
  const seedPool = new Pool({ connectionString: RUNNER_DATABASE_URL, ssl: false, max: 4 });
  const query = async (sql, params = []) => (await seedPool.query(sql, params)).rows;
  const { findOrCreateKaiUserByLegacyPublicUserdataId } = await import("../Backend/kai/db/kaiQueries.js");
  const { resolveOrgScopeForUserId } = await import("../services/orgScopeService.js");
  const { resolveEffectiveClientOrganizationMembershipsForLegacyUser } = await import("../Backend/kai/auth/gkOrganizationBindingAuthority.js");
  const { __testables: legacyKaiChat } = await import("../Backend/services/kai.js");

  const PASSWORD = "Synthetic-Sign-In-2026!";
  const USERS = Object.freeze({
    site: 2801, // Get Kinder site admin (public.userdata.is_admin)
    adminA: 2802, // organization A's administrator (membership + legacy fields + representative); deactivated in B
    memberA: 2803, // Get Kinder member of A; stored KAI client_contributor (role-change target)
    joinerOne: 2804, // pending join request to A, approved while adminA is active
    joinerTwo: 2805, // pending join request to A, attempted after the deactivation
    adminB: 2806, // organization B's administrator
    dualAdmin: 2807, // administers A and B; legacy fields name A
    repMember: 2808, // active non-admin membership of A; legacy fields name A; stored client_contributor
    legacyOnly: 2809, // legacy fields name A; no membership row at all
    staff: 2810, // global GK operator
  });
  const email = (legacyId) => `admin-revocation-${legacyId}@harborlight.test`;
  const ORG_A_NAME = "Larkspur Synthetic Tenants Union";
  const ORG_B_NAME = "Fenwick Synthetic Arts Collective";
  const KAI_A = "00000000-0000-4000-8000-0000000ad0a1";
  const KAI_B = "00000000-0000-4000-8000-0000000ad0b2";
  const PROJECT_A = "7d000000-0000-4000-8000-0000000ad0a1";
  const PROJECT_B = "7d000000-0000-4000-8000-0000000ad0b2";
  const INTAKE = "/api/kai/sprint2/intake";
  const ACCESS = "/api/kai/sprint2/access-administration";
  const contextPath = `${ACCESS}/administration-context`;
  const rosterPath = (organizationId) => `${ACCESS}/organizations/${organizationId}/access`;
  const capabilitiesPath = (organizationId) => `${INTAKE}/admin/organizations/${organizationId}/access-capabilities`;
  const projectsPath = (organizationId) => `${INTAKE}/admin/organizations/${organizationId}/engagements`;
  const organizationsPath = `${INTAKE}/admin/organizations`;
  const rolesPath = (organizationId, legacyId) => `${ACCESS}/organizations/${organizationId}/memberships/${legacyId}/roles`;
  const joinDecisionPath = (organizationId, requestId) => `${ACCESS}/organizations/${organizationId}/join-requests/${requestId}/approve`;

  // =====================================================================
  // FIXTURES
  // =====================================================================
  await query(`ALTER TABLE public.userdata ADD COLUMN IF NOT EXISTS firstname text, ADD COLUMN IF NOT EXISTS lastname text,
                 ADD COLUMN IF NOT EXISTS password text, ADD COLUMN IF NOT EXISTS is_admin boolean DEFAULT false`);
  await query(`ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS description text, ADD COLUMN IF NOT EXISTS website varchar(255),
                 ADD COLUMN IF NOT EXISTS logo_url text, ADD COLUMN IF NOT EXISTS rep_user_id integer, ADD COLUMN IF NOT EXISTS rep_role varchar(255),
                 ADD COLUMN IF NOT EXISTS applied_at timestamptz DEFAULT now(), ADD COLUMN IF NOT EXISTS approved_at timestamptz,
                 ADD COLUMN IF NOT EXISTS approved_by varchar(255), ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now()`);
  await query("ALTER TABLE public.user_org_memberships ADD COLUMN IF NOT EXISTS added_by_user_id integer");
  await query("CREATE UNIQUE INDEX IF NOT EXISTS user_org_memberships_user_org_unique ON public.user_org_memberships (user_id, org_id)");
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  for (const [key, legacyId] of Object.entries(USERS)) {
    await query(`INSERT INTO public.userdata (id, email, firstname, lastname, password, email_verified, is_suspended, is_admin)
                 VALUES ($1, $2, 'Synthetic', $3, $4, true, false, $5)`,
      [legacyId, email(legacyId), `Admin-Revocation ${key}`, passwordHash, legacyId === USERS.site]);
  }
  const kaiUserIds = {};
  for (const [key, legacyId] of Object.entries(USERS)) {
    kaiUserIds[key] = (await findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: legacyId, email: email(legacyId) })).user_id;
  }
  async function boundOrganization(name, adminLegacyId, kaiOrganizationId, projectId, code) {
    const [organization] = await query(
      `INSERT INTO public.organizations (name, description, website, rep_user_id, rep_role, status, approved_at, approved_by)
       VALUES ($1, 'Original synthetic description.', 'https://existing.example.test', $2, 'Executive Director', 'approved', now(), 'earlier-approver')
       RETURNING id`, [name, adminLegacyId]);
    await query("UPDATE public.userdata SET org_rep = true, org_id = $1 WHERE id = $2", [organization.id, adminLegacyId]);
    await query("INSERT INTO public.user_org_memberships (org_id, user_id, role, is_active) VALUES ($1, $2, 'admin', true)", [organization.id, adminLegacyId]);
    await query("INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES ($1::uuid, $2, $3)", [kaiOrganizationId, name, code]);
    await query("INSERT INTO kai.gk_organization_bindings (gk_organization_id, kai_organization_id, status) VALUES ($1, $2::uuid, 'active')", [organization.id, kaiOrganizationId]);
    await query("INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code, project_metadata) VALUES ($1::uuid, $2::uuid, $3, '{}'::jsonb)",
      [projectId, kaiOrganizationId, `${name} Existing Project`]);
    return organization.id;
  }
  const ORG_A = await boundOrganization(ORG_A_NAME, USERS.adminA, KAI_A, PROJECT_A, "larkspur-synthetic");
  const ORG_B = await boundOrganization(ORG_B_NAME, USERS.adminB, KAI_B, PROJECT_B, "fenwick-synthetic");
  const storedMembership = (organizationId, key, role) => query(
    "INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status) VALUES ($1::uuid, $2::uuid, $3, 'active')",
    [organizationId, kaiUserIds[key], role]);
  await query("INSERT INTO public.user_org_memberships (org_id, user_id, role, is_active) VALUES ($1, $2, 'member', true)", [ORG_A, USERS.memberA]);
  await storedMembership(KAI_A, "memberA", "client_contributor");
  // dualAdmin: an administrator of both; the legacy fields name A.
  await query("UPDATE public.userdata SET org_rep = true, org_id = $1 WHERE id = $2", [ORG_A, USERS.dualAdmin]);
  await query("INSERT INTO public.user_org_memberships (org_id, user_id, role, is_active) VALUES ($1, $3, 'admin', true), ($2, $3, 'admin', true)",
    [ORG_A, ORG_B, USERS.dualAdmin]);
  // repMember: an active non-admin membership; the legacy fields still name A as their representative organization.
  await query("UPDATE public.userdata SET org_rep = true, org_id = $1 WHERE id = $2", [ORG_A, USERS.repMember]);
  await query("INSERT INTO public.user_org_memberships (org_id, user_id, role, is_active) VALUES ($1, $2, 'member', true)", [ORG_A, USERS.repMember]);
  await storedMembership(KAI_A, "repMember", "client_contributor");
  // legacyOnly: the legacy fields alone, no membership row for any organization.
  await query("UPDATE public.userdata SET org_rep = true, org_id = $1 WHERE id = $2", [ORG_A, USERS.legacyOnly]);
  await query("INSERT INTO kai.user_roles (user_id, role_id) SELECT $1::uuid, role_id FROM kai.roles WHERE role_name = 'gk_operator'", [kaiUserIds.staff]);
  const joinRequest = async (key) => (await query(
    "INSERT INTO kai.organization_join_requests (organization_id, requester_user_id) VALUES ($1::uuid, $2::uuid) RETURNING organization_join_request_id::text AS id",
    [KAI_A, kaiUserIds[key]]))[0].id;
  const JOIN_ONE = await joinRequest("joinerOne");
  const JOIN_TWO = await joinRequest("joinerTwo");

  // --- database readers ----------------------------------------------------
  const legacyFieldsOf = async (legacyIds) => query("SELECT id, org_rep, org_id, is_admin FROM public.userdata WHERE id = ANY($1::int[]) ORDER BY id", [legacyIds]);
  const gkMembershipRows = async () => query(
    "SELECT user_id, org_id, role, COALESCE(is_active, true) AS is_active, added_by_user_id FROM public.user_org_memberships ORDER BY user_id, org_id");
  const storedRolesOf = async (key, organizationId = KAI_A) => (await query(
    "SELECT role_name FROM kai.organization_memberships WHERE user_id = $1::uuid AND organization_id = $2::uuid AND membership_status = 'active' ORDER BY role_name",
    [kaiUserIds[key], organizationId])).map((row) => row.role_name);
  const joinRequestStatus = async (requestId) => (await query(
    "SELECT status::text FROM kai.organization_join_requests WHERE organization_join_request_id = $1::uuid", [requestId]))[0].status;
  const descriptionOf = async (gkOrganizationId) => (await query("SELECT description FROM public.organizations WHERE id = $1", [gkOrganizationId]))[0].description;
  const globalRoleCountOf = async (key) => (await query(
    "SELECT count(*)::int AS count FROM kai.user_roles WHERE user_id = $1::uuid AND active = true AND revoked_at IS NULL", [kaiUserIds[key]]))[0].count;
  async function allKaiCounts() {
    const counts = {};
    for (const { table_name: table } of await query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'kai' AND table_type = 'BASE TABLE' ORDER BY table_name",
    )) {
      counts[table] = (await query(`SELECT count(*)::int AS count FROM kai.${table}`))[0].count;
    }
    return counts;
  }
  const changedTables = (before, after) => Object.keys(after).filter((table) => after[table] !== before[table]).sort();
  // Everything outside the one deactivated row that must not move.
  async function tenantState() {
    return {
      organizations: await query("SELECT id, name, rep_user_id, status FROM public.organizations ORDER BY id"),
      bindings: await query("SELECT gk_organization_id, kai_organization_id::text, status FROM kai.gk_organization_bindings ORDER BY gk_organization_id"),
      kaiOrganizations: await query("SELECT organization_id::text, name, status::text FROM kai.organizations ORDER BY organization_id"),
      projects: await query("SELECT engagement_id::text, organization_id::text, engagement_code FROM kai.engagements ORDER BY engagement_id"),
      storedMemberships: await query(
        "SELECT organization_id::text, user_id::text, role_name, membership_status FROM kai.organization_memberships ORDER BY organization_id, user_id, role_name"),
      globalRoles: await query("SELECT user_id::text, role_id, active, revoked_at FROM kai.user_roles ORDER BY user_id, role_id"),
      legacyFields: await legacyFieldsOf(Object.values(USERS)),
    };
  }
  // Get Kinder and KAI authority through the real resolvers (and the legacy
  // KAI assistant's organization context, which scopes its organization tools).
  async function resolvedAuthority(legacyId) {
    const scope = await resolveOrgScopeForUserId(legacyId, { includeOrgMembersForOrgRep: false });
    const chat = await legacyKaiChat.getOrgContextForUser(legacyId);
    return {
      gkOrganizations: scope.memberships.map((m) => [m.orgId, m.role]).sort(),
      gkActiveOrganization: scope.orgId,
      gkRepresentativeAccess: scope.hasOrgRepAccess,
      derivedClientAdminOf: (await resolveEffectiveClientOrganizationMembershipsForLegacyUser(legacyId))
        .filter((m) => m.role_name === "client_admin").map((m) => m.organization_id).sort(),
      assistantOrganization: chat?.orgId ?? null,
    };
  }

  // --- application, browser, sessions ---------------------------------------
  const smtp = await startLoopbackSmtpSink();
  const app = await startRealApplication({ databaseUrl: RUNNER_DATABASE_URL, workdir: WORKDIR, name: "admin-revocation", smtpPort: smtp.port });
  const { baseUrl } = app;
  const browser = await launchChrome({ chrome: CHROME, workdir: WORKDIR, profileName: "admin-revocation" });
  const contexts = [];
  const results = {};
  let legacyApp = null;

  const signIn = async (legacyId, url = baseUrl) => {
    const page = await signInThroughLogin(browser, url, email(legacyId), PASSWORD);
    contexts.push(page);
    return page;
  };
  const signOut = async (page) => {
    contexts.splice(contexts.indexOf(page), 1);
    await signOutThroughLogout(page, contextPath);
  };
  const authorizedOrganizationIds = async (page) => ((await page.fetchJson("GET", organizationsPath)).data?.items || []).map((item) => item.organization_id).sort();
  // The site admin's approval request as the signed-in /admin/org-applications page sends it, with its session CSRF token.
  const approveWithPageToken = (page, applicationId) => page.evaluate(`(async () => {
    const html = await (await fetch("/admin/org-applications", { credentials: "same-origin" })).text();
    const token = html.match(/<meta name="csrf-token" content="([^"]+)">/)[1];
    const response = await fetch("/admin/org-applications/${applicationId}/approve", { method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json", "X-CSRF-Token": token } });
    return { status: response.status, body: await response.json().catch(() => null) };
  })()`);
  // The real organization-description form post (no CSRF field on this form).
  const postDescription = (page, text) => page.evaluate(`(async () => {
    const response = await fetch("/org-portal/description", { method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ orgDescription: ${JSON.stringify(text)} }) });
    await response.text();
    return { status: response.status, finalPath: new URL(response.url).pathname };
  })()`);
  // A CSRF-protected Get Kinder JSON request, with the session's token as a signed-in page carries it.
  const fetchWithSessionCsrf = (page, method, path, body) => page.evaluate(`(async () => {
      const html = await (await fetch("/kai/client-followups", { credentials: "same-origin" })).text();
      const token = html.match(/name="csrf-token" content="([^"]+)"/)[1];
      const response = await fetch(${JSON.stringify(path)}, { method: ${JSON.stringify(method)}, credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json", "X-CSRF-Token": token }, body: ${JSON.stringify(JSON.stringify(body))} });
      return { status: response.status, body: await response.json().catch(() => null) };
    })()`);
  // What a signed-in person can read as an organization administrator.
  async function readSurface(page, kaiOrganizationId) {
    const gkContext = await page.fetchJson("GET", "/api/org/context");
    const event = await page.fetchJson("POST", "/api/events", {});
    const capabilities = await page.fetchJson("GET", capabilitiesPath(kaiOrganizationId));
    return {
      gkPortal: gkContext.status,
      gkActiveOrganization: gkContext.body?.active_org_id ?? null,
      gkOrganizations: (gkContext.body?.memberships || []).map((m) => [m.org_id, m.role]),
      eventCreation: [event.status, event.body?.error ?? null],
      kaiOrganizations: await authorizedOrganizationIds(page),
      capabilities: capabilities.status,
      organizationAccessManagement: capabilities.data?.organizationAccessManagement ?? null,
      roster: (await page.fetchJson("GET", rosterPath(kaiOrganizationId))).status,
      projects: (await page.fetchJson("GET", projectsPath(kaiOrganizationId))).status,
      platformAdministration: (await page.fetchJson("GET", contextPath)).data?.platform_administration === true,
    };
  }
  const EVENT_GATE_PASSED = [400, "At least one role is required."]; // validation, after the gate
  const EVENT_GATE_REFUSED = [403, "Organization representative access required."];
  const ADMIN_A_SURFACE = Object.freeze({
    gkPortal: 200, gkActiveOrganization: null, gkOrganizations: null, eventCreation: EVENT_GATE_PASSED, kaiOrganizations: [KAI_A],
    capabilities: 200, organizationAccessManagement: true, roster: 200, projects: 200, platformAdministration: false,
  });
  const REFUSED_SURFACE = Object.freeze({
    gkPortal: 403, gkActiveOrganization: null, gkOrganizations: [], eventCreation: EVENT_GATE_REFUSED, kaiOrganizations: [],
    capabilities: 403, organizationAccessManagement: null, roster: 403, projects: 403, platformAdministration: false,
  });
  // Every administrator write the revoked person attempts, with what each one left behind.
  async function attemptAdministration(page, label) {
    const before = { kai: await allKaiCounts(), description: await descriptionOf(ORG_A), memberRoles: await storedRolesOf("memberA") };
    const attempts = {
      description: await postDescription(page, `Rewritten after revocation (${label}).`),
      projectCreate: (await page.fetchJson("POST", projectsPath(KAI_A), { engagement_code: `Revoked ${label} Project` })).status,
      joinApproval: (await page.fetchJson("POST", joinDecisionPath(KAI_A, JOIN_TWO))).status,
      roleGrant: (await page.fetchJson("POST", rolesPath(KAI_A, USERS.memberA), { role_name: "client_admin" })).status,
      roleRevoke: (await page.fetchJson("POST", `${rolesPath(KAI_A, USERS.memberA)}/client_reviewer/revoke`)).status,
      otherOrganizationRoster: (await page.fetchJson("GET", rosterPath(KAI_B))).status,
      otherOrganizationProjects: (await page.fetchJson("GET", projectsPath(KAI_B))).status,
      globalRole: (await page.fetchJson("PUT", `${ACCESS}/global-roles/${USERS.adminA}`, { role_name: "gk_admin", action: "assign" })).status,
      siteAdministration: (await page.fetchJson("GET", "/admin/org-applications")).finalPath === "/admin/org-applications",
    };
    const after = {
      kaiTablesChanged: changedTables(before.kai, await allKaiCounts()),
      descriptionChanged: (await descriptionOf(ORG_A)) !== before.description,
      memberRoles: await storedRolesOf("memberA"),
      joinTwo: await joinRequestStatus(JOIN_TWO),
      joinerTwoRoles: await storedRolesOf("joinerTwo"),
    };
    return { attempts, after, memberRolesBefore: before.memberRoles };
  }

  let adminSession = null;
  let dualSession = null;
  try {
    // =====================================================================
    // A. Active administrator
    // =====================================================================
    await test("A: an active administrator administers organization A in Get Kinder and KAI through their own sign-in, and nothing in organization B", async () => {
      assert.deepEqual(await resolvedAuthority(USERS.adminA), {
        gkOrganizations: [[ORG_A, "admin"]], gkActiveOrganization: ORG_A, gkRepresentativeAccess: true,
        derivedClientAdminOf: [KAI_A], assistantOrganization: ORG_A,
      });
      adminSession = await signIn(USERS.adminA);
      const surface = await readSurface(adminSession, KAI_A);
      results.A_surface = surface;
      assert.deepEqual(surface, { ...ADMIN_A_SURFACE, gkActiveOrganization: ORG_A, gkOrganizations: [[ORG_A, "admin"]] });

      const description = await postDescription(adminSession, "Updated by the active administrator.");
      assert.equal(description.finalPath, "/impact-library", "the form's /home redirect");
      assert.equal(await descriptionOf(ORG_A), "Updated by the active administrator.");
      assert.equal((await adminSession.fetchJson("POST", joinDecisionPath(KAI_A, JOIN_ONE))).status, 200);
      assert.equal(await joinRequestStatus(JOIN_ONE), "approved");
      assert.deepEqual(await storedRolesOf("joinerOne"), ["client_contributor"]);
      assert.equal((await adminSession.fetchJson("POST", rolesPath(KAI_A, USERS.memberA), { role_name: "client_reviewer" })).status, 200);
      assert.deepEqual(await storedRolesOf("memberA"), ["client_contributor", "client_reviewer"]);
      const project = await adminSession.fetchJson("POST", projectsPath(KAI_A), { engagement_code: "Larkspur Second Project" });
      assert.equal(project.status, 201, JSON.stringify(project.body));
      assert.deepEqual([
        (await adminSession.fetchJson("GET", rosterPath(KAI_B))).status,
        (await adminSession.fetchJson("GET", capabilitiesPath(KAI_B))).status,
        (await adminSession.fetchJson("GET", projectsPath(KAI_B))).status,
      ], [403, 403, 403], "organization B is not reachable");
      const roster = (await adminSession.fetchJson("GET", rosterPath(KAI_A))).data.access;
      assert.equal(roster.find((row) => row.legacy_public_userdata_id === USERS.adminA)?.effective_admin_authority, true);
      assert.equal(await globalRoleCountOf("adminA"), 0);
    });

    // =====================================================================
    // B. Explicit deactivation, legacy fields unchanged
    // =====================================================================
    await test("B: after only adminA's organization-A membership is deactivated, the session established before the change and a fresh sign-in both lose every Get Kinder and KAI administrator capability for A; the legacy fields and everything else are unchanged", async () => {
      const before = { state: await tenantState(), memberships: await gkMembershipRows() };
      await query("UPDATE public.user_org_memberships SET is_active = false WHERE user_id = $1 AND org_id = $2", [USERS.adminA, ORG_A]);
      assert.deepEqual(await legacyFieldsOf([USERS.adminA]), [{ id: USERS.adminA, org_rep: true, org_id: ORG_A, is_admin: false }],
        "the legacy administrator fields still name organization A");
      assert.deepEqual(await gkMembershipRows(), before.memberships.map((row) =>
        (row.user_id === USERS.adminA && row.org_id === ORG_A ? { ...row, is_active: false } : row)), "only that one row changed");

      const authority = await resolvedAuthority(USERS.adminA);
      const existingSession = await readSurface(adminSession, KAI_A);
      const existingWrites = await attemptAdministration(adminSession, "existing session");
      const freshSession = await signIn(USERS.adminA);
      const fresh = await readSurface(freshSession, KAI_A);
      const freshWrites = await attemptAdministration(freshSession, "fresh sign-in");
      results.B = { authority, existingSession, existingWrites, fresh, freshWrites };
      console.log(`[admin-revocation] B observed ${JSON.stringify(results.B)}`);

      assert.deepEqual(authority, {
        gkOrganizations: [], gkActiveOrganization: null, gkRepresentativeAccess: false, derivedClientAdminOf: [], assistantOrganization: null,
      }, "resolvers: no Get Kinder organization, representative access, derived client_admin or assistant organization");
      assert.deepEqual(existingSession, REFUSED_SURFACE, "the session established before the change, on its next requests");
      assert.deepEqual(fresh, REFUSED_SURFACE, "a fresh sign-in");
      for (const [label, writes] of [["existing session", existingWrites], ["fresh sign-in", freshWrites]]) {
        assert.deepEqual(writes.attempts, {
          description: { status: 200, finalPath: "/org-apply" }, projectCreate: 403, joinApproval: 403, roleGrant: 403, roleRevoke: 403,
          otherOrganizationRoster: 403, otherOrganizationProjects: 403, globalRole: 403, siteAdministration: false,
        }, `${label}: every administrator write refused`);
        assert.deepEqual(writes.after, {
          kaiTablesChanged: [], descriptionChanged: false, memberRoles: writes.memberRolesBefore, joinTwo: "pending", joinerTwoRoles: [],
        }, `${label}: nothing written, no audit`);
      }
      // Nobody else's authority, no organization, binding, Project or role, and no legacy field moved.
      assert.deepEqual(await tenantState(), before.state);
      assert.equal(await globalRoleCountOf("adminA"), 0, "no global role appears");
      // The organization's roster (read by another administrator) no longer counts adminA.
      const otherAdmin = await signIn(USERS.dualAdmin);
      const roster = (await otherAdmin.fetchJson("GET", rosterPath(KAI_A))).data.access;
      assert.notEqual(roster.find((row) => row.legacy_public_userdata_id === USERS.adminA)?.effective_admin_authority, true);
      await signOut(otherAdmin);
      await signOut(freshSession);
    });

    // =====================================================================
    // C. Active non-administrator membership with legacy representative fields
    // =====================================================================
    await test("C: an active non-admin membership is not elevated by legacy fields that still name the organization; the member keeps their contributor access and administers nothing", async () => {
      const authority = await resolvedAuthority(USERS.repMember);
      const page = await signIn(USERS.repMember);
      const surface = await readSurface(page, KAI_A);
      const before = { kai: await allKaiCounts(), description: await descriptionOf(ORG_A) };
      const writes = {
        description: await postDescription(page, "Rewritten by a non-admin member."),
        joinApproval: (await page.fetchJson("POST", joinDecisionPath(KAI_A, JOIN_TWO))).status,
        roleGrant: (await page.fetchJson("POST", rolesPath(KAI_A, USERS.memberA), { role_name: "client_admin" })).status,
        otherOrganizationProjects: (await page.fetchJson("GET", projectsPath(KAI_B))).status,
      };
      results.C = { authority, surface, writes };
      console.log(`[admin-revocation] C observed ${JSON.stringify(results.C)}`);

      assert.deepEqual(authority.derivedClientAdminOf, [], "no derived client_admin");
      assert.deepEqual(authority.gkOrganizations, [[ORG_A, "member"]], "the membership keeps its own role");
      assert.deepEqual([surface.kaiOrganizations, surface.organizationAccessManagement, surface.projects], [[KAI_A], false, 200],
        "contributor access to organization A remains; Team & Access administration does not");
      assert.equal(surface.platformAdministration, false);
      assert.deepEqual([writes.description.finalPath, writes.joinApproval, writes.roleGrant, writes.otherOrganizationProjects], ["/impact-library", 403, 403, 403]);
      assert.equal(await descriptionOf(ORG_A), before.description, "the description edit is refused for a non-admin role");
      assert.deepEqual(changedTables(before.kai, await allKaiCounts()), []);
      await signOut(page);
    });

    // =====================================================================
    // D. Legacy-only administrator; deleted membership row
    // =====================================================================
    await test("D: a legacy-only administrator (legacy fields, no membership row) keeps administering organization A, unaffected by adminA's deactivation", async () => {
      assert.deepEqual(await resolvedAuthority(USERS.legacyOnly), {
        gkOrganizations: [[ORG_A, "admin"]], gkActiveOrganization: ORG_A, gkRepresentativeAccess: true,
        derivedClientAdminOf: [KAI_A], assistantOrganization: ORG_A,
      });
      const page = await signIn(USERS.legacyOnly);
      const surface = await readSurface(page, KAI_A);
      results.D = surface;
      assert.deepEqual(surface, { ...ADMIN_A_SURFACE, gkActiveOrganization: ORG_A, gkOrganizations: [[ORG_A, "admin"]] });
      await signOut(page);
    });

    await test("D (deleted row): with adminA's deactivated row physically deleted, the stored data can no longer tell a removed administrator from a legacy-only one, and the legacy fields grant organization A again (recorded limitation); restoring the deactivated row removes it again", async () => {
      await query("DELETE FROM public.user_org_memberships WHERE user_id = $1 AND org_id = $2", [USERS.adminA, ORG_A]);
      const deleted = await resolvedAuthority(USERS.adminA);
      const page = await signIn(USERS.adminA);
      const deletedSurface = await readSurface(page, KAI_A);
      await query("INSERT INTO public.user_org_memberships (org_id, user_id, role, is_active) VALUES ($1, $2, 'admin', false)", [ORG_A, USERS.adminA]);
      const restored = await readSurface(page, KAI_A);
      results.D_deleted = { deleted, deletedSurface, restored };
      console.log(`[admin-revocation] D deleted-row observed ${JSON.stringify(results.D_deleted)}`);

      assert.deepEqual(deleted.derivedClientAdminOf, [KAI_A], "deletion is indistinguishable from legacy-only administration");
      assert.equal(deletedSurface.organizationAccessManagement, true);
      assert.deepEqual(restored, REFUSED_SURFACE, "an explicit deactivated row is decisive again on the next request");
      await signOut(page);
    });

    // =====================================================================
    // E. Organization and role isolation
    // =====================================================================
    await test("E: deactivating dualAdmin's organization-A membership (their legacy organization) removes only A; their organization-B administration, organization B's own administrator, the site admin and GK staff are unchanged", async () => {
      const observeOthers = async () => {
        const adminB = await signIn(USERS.adminB);
        const site = await signIn(USERS.site);
        const staff = await signIn(USERS.staff);
        const observed = {
          adminB: await readSurface(adminB, KAI_B),
          siteApplications: (await site.fetchJson("GET", "/admin/org-applications")).finalPath,
          sitePlatform: (await site.fetchJson("GET", contextPath)).data?.platform_administration === true,
          staffOrganizations: await authorizedOrganizationIds(staff),
          staffPlatform: (await staff.fetchJson("GET", contextPath)).data?.platform_administration === true,
        };
        for (const page of [adminB, site, staff]) await signOut(page);
        return observed;
      };
      const othersBefore = await observeOthers();
      assert.deepEqual(await resolvedAuthority(USERS.dualAdmin), {
        gkOrganizations: [[ORG_A, "admin"], [ORG_B, "admin"]], gkActiveOrganization: ORG_A, gkRepresentativeAccess: true,
        derivedClientAdminOf: [KAI_A, KAI_B].sort(), assistantOrganization: ORG_A,
      });
      dualSession = await signIn(USERS.dualAdmin);
      assert.deepEqual(await authorizedOrganizationIds(dualSession), [KAI_A, KAI_B].sort());
      assert.equal((await dualSession.fetchJson("GET", "/api/org/context")).body.active_org_id, ORG_A, "the session's active organization is A");
      const before = await tenantState();

      await query("UPDATE public.user_org_memberships SET is_active = false WHERE user_id = $1 AND org_id = $2", [USERS.dualAdmin, ORG_A]);
      const authority = await resolvedAuthority(USERS.dualAdmin);
      const gkContext = await dualSession.fetchJson("GET", "/api/org/context");
      const switchToA = await fetchWithSessionCsrf(dualSession, "POST", "/api/org/active-org", { org_id: ORG_A });
      const observed = {
        authority,
        gkContext: [gkContext.status, gkContext.body?.active_org_id, (gkContext.body?.memberships || []).map((m) => m.org_id)],
        switchToA: switchToA.status,
        kaiOrganizations: await authorizedOrganizationIds(dualSession),
        rosterA: (await dualSession.fetchJson("GET", rosterPath(KAI_A))).status,
        rosterB: (await dualSession.fetchJson("GET", rosterPath(KAI_B))).status,
        joinApprovalA: (await dualSession.fetchJson("POST", joinDecisionPath(KAI_A, JOIN_TWO))).status,
        eventCreation: (await dualSession.fetchJson("POST", "/api/events", {})).status,
      };
      results.E = { observed, othersBefore };
      console.log(`[admin-revocation] E observed ${JSON.stringify(results.E)}`);

      assert.deepEqual(observed.authority, {
        gkOrganizations: [[ORG_B, "admin"]], gkActiveOrganization: ORG_B, gkRepresentativeAccess: true,
        derivedClientAdminOf: [KAI_B], assistantOrganization: null,
      }, "A is gone; B remains; the legacy organization A no longer scopes the assistant");
      assert.deepEqual(observed.gkContext, [200, ORG_B, [ORG_B]], "the existing session's stale active organization A is dropped");
      assert.equal(observed.switchToA, 403, "switching back to A is refused");
      assert.deepEqual(observed.kaiOrganizations, [KAI_B]);
      assert.deepEqual([observed.rosterA, observed.rosterB, observed.joinApprovalA], [403, 200, 403]);
      assert.equal(observed.eventCreation, 400, "event creation is still authorized, for organization B");
      assert.equal(await joinRequestStatus(JOIN_TWO), "pending");
      assert.deepEqual(await tenantState(), before, "no organization, binding, Project, stored membership, role or legacy field moved");
      assert.deepEqual(await observeOthers(), othersBefore, "organization B's administrator, the site admin and GK staff are unchanged");
      assert.equal(othersBefore.siteApplications, "/admin/org-applications");
      assert.deepEqual(othersBefore.adminB.kaiOrganizations, [KAI_B]);
      assert.equal(othersBefore.adminB.organizationAccessManagement, true);
      await signOut(dualSession);
      dualSession = null;
    });

    // =====================================================================
    // F. The approval ownership guard agrees; KAI Sprint 2 disabled
    // =====================================================================
    await test("F: the existing-organization approval guard agrees: the deactivated administrator's application under A's name is refused, the legacy-only administrator's is approved against A with nobody's authority changed", async () => {
      async function applyAs(legacyId) {
        const page = await signIn(legacyId);
        assert.equal(await page.goto("/org-apply?source=impact-library"), "/org-apply");
        await page.setInput("orgName", ORG_A_NAME);
        await page.setInput("repRole", "Executive Director");
        await page.setInput("orgWebsite", "https://example.test");
        await page.setInput("orgDescription", "Synthetic organization for local acceptance.");
        await page.clickWhere("Submit Application", `() => document.querySelector("form[action='/org-apply'] button[type=submit]")`);
        await page.waitFor(async () => (await page.evaluate("location.search")).includes("submitted=true"), "application submitted");
        await signOut(page);
        return (await query("SELECT id FROM public.org_applications WHERE user_id = $1 ORDER BY id DESC", [legacyId]))[0].id;
      }
      const revokedApplication = await applyAs(USERS.adminA);
      const legacyApplication = await applyAs(USERS.legacyOnly);
      const before = { state: await tenantState(), memberships: await gkMembershipRows() };
      const site = await signIn(USERS.site);
      const refused = await approveWithPageToken(site, revokedApplication);
      const approved = await approveWithPageToken(site, legacyApplication);
      await signOut(site);
      results.F = { refused: [refused.status, refused.body?.error], approved: [approved.status, approved.body] };
      console.log(`[admin-revocation] F observed ${JSON.stringify(results.F)}`);

      assert.deepEqual(results.F.refused, [409, "organization_name_conflict"]);
      assert.deepEqual(results.F.approved, [200, { success: true, kai_organization: { status: "ready", outcome: "reused" } }]);
      assert.deepEqual(await tenantState(), before.state);
      assert.deepEqual(await gkMembershipRows(), before.memberships, "approval wrote no membership");
      assert.deepEqual((await resolvedAuthority(USERS.adminA)).derivedClientAdminOf, []);
    });

    await test("F (KAI Sprint 2 disabled): the Get Kinder decision is the same without KAI; the deactivated administrator is refused and the legacy-only administrator is not", async () => {
      legacyApp = await startRealApplication({ databaseUrl: RUNNER_DATABASE_URL, workdir: WORKDIR, name: "admin-revocation-legacy",
        smtpPort: smtp.port, env: { KAI_SPRINT2_ENABLED: "false" } });
      const revoked = await signIn(USERS.adminA, legacyApp.baseUrl);
      const legacy = await signIn(USERS.legacyOnly, legacyApp.baseUrl);
      const observed = {
        revoked: [(await revoked.fetchJson("GET", "/api/org/context")).status, (await revoked.fetchJson("POST", "/api/events", {})).status],
        legacy: [(await legacy.fetchJson("GET", "/api/org/context")).status, (await legacy.fetchJson("POST", "/api/events", {})).status],
        kaiRoute: (await legacy.fetchJson("GET", organizationsPath)).status,
      };
      results.F_disabled = observed;
      console.log(`[admin-revocation] F disabled observed ${JSON.stringify(observed)}`);
      assert.deepEqual(observed.revoked, [403, 403]);
      assert.deepEqual(observed.legacy, [200, 400]);
      assert.notEqual(observed.kaiRoute, 200, "KAI Sprint 2 routes stay unavailable");
      for (const page of [revoked, legacy]) {
        contexts.splice(contexts.indexOf(page), 1);
        await page.close();
      }
    });
  } finally {
    console.log(`[admin-revocation] results ${JSON.stringify(results)}`);
    for (const page of contexts.splice(0)) await page.close().catch(() => {});
    await browser.close();
    await app.stop();
    if (legacyApp) await legacyApp.stop();
    await smtp.close();
    await seedPool.end();
  }
}
