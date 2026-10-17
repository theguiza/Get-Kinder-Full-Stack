import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assertLoopbackDatabaseUrl,
  launchChrome,
  signIn as signInThroughLogin,
  signOut as signOutThroughLogout,
  startLoopbackSmtpSink,
  startRealApplication,
} from "./support/kaiRealApplicationBrowserHarness.js";

/**
 * Name-based organization takeover at the original approval boundary, run only by
 *   node scripts/kai-client-knowledge-studio-browser-acceptance-local-postgres.js \
 *     __tests__/kai-approval-organization-name-takeover-browser-acceptance.integration.spec.js
 * against that runner's ephemeral loopback PostgreSQL. Skipped otherwise.
 *
 * The repository's own index.js runs as a loopback child process: every actor
 * signs in through the real /login form, applicants submit the real /org-apply
 * form, and a Get Kinder site admin decides on the real
 * /admin/org-applications page (or, for concurrent decisions, posts the same
 * approval request from that signed-in page). Effective authority is read
 * through the applicant's own independent sign-in (KAI organizations, Team &
 * Access capabilities and roster) and through the real Get Kinder and KAI
 * authority resolvers. A second instance runs with KAI Sprint 2 disabled.
 *
 * Invariant: an application's organization name is not evidence of
 * ownership. Approval never gives the applicant authority over an existing
 * organization they do not already administer.
 *
 * FIXTURES (direct SQL, never the behavior under test): accounts with bcrypt
 * passwords (one is_admin site admin), the production-shaped Get Kinder
 * organization columns the approval writes, an existing bound organization
 * with its administrator (membership and legacy fields), a member and a
 * Project, and two existing unbound organizations.
 */

const RUNNER_DATABASE_URL = process.env.KAI_CLIENT_BROWSER_ACCEPTANCE_DATABASE_URL;
const CHROME = process.env.KAI_CLIENT_BROWSER_ACCEPTANCE_CHROME;
const WORKDIR = process.env.KAI_CLIENT_BROWSER_ACCEPTANCE_WORKDIR;

test("organization name takeover isolation: a non-loopback runner URL is refused", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
});

test("organization name takeover: the approval decides an existing-organization match inside its transaction, before any authority write", () => {
  const source = readFileSync(new URL("../routes/orgApplyApi.js", import.meta.url), "utf8");
  const route = source.slice(source.indexOf('orgApplyRouter.post("/admin/org-applications/:id/approve"'));
  const begin = route.indexOf('await client.query("BEGIN");');
  const lock = route.indexOf("pg_advisory_xact_lock");
  const refusal = route.indexOf("organization_name_conflict");
  const authorityWrite = route.indexOf("UPDATE userdata");
  assert.ok(begin > 0 && begin < lock && lock < refusal && refusal < authorityWrite,
    "BEGIN -> name lock -> refusal -> authority writes");
  assert.doesNotMatch(source, /'\\s\+'/, "no template-literal regex that JavaScript reduces to 's+'");
});

if (!RUNNER_DATABASE_URL || !CHROME || !WORKDIR) {
  test("organization name takeover requires its runner", { skip: true }, () => {});
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

  const PASSWORD = "Synthetic-Sign-In-2026!";
  const USERS = Object.freeze({
    site: 2601, // Get Kinder site admin (public.userdata.is_admin): approves
    boundAdmin: 2602, // the bound organization's administrator (membership + legacy fields + representative)
    boundMember: 2603, // Get Kinder member of the bound organization; stored KAI client_contributor
    takeover: 2604, // applies under the bound organization's name
    takeoverSecond: 2605, // also applies under the bound organization's name (concurrent)
    takeoverThird: 2606, // also applies under the bound organization's name (concurrent)
    unboundAdmin: 2607, // the unbound organization's administrator
    unboundTakeover: 2608, // applies under the unbound organization's name
    shelterAdmin: 2609, // the administrator of an organization whose name has a lowercase "s"
    shelterTakeover: 2610, // applies under that organization's name
    newApplicant: 2611, // applies for a genuinely new organization
    raceFirst: 2612, // both apply for the same new name; approved concurrently
    raceSecond: 2613,
    doubleApproval: 2614, // one application, approved twice concurrently
    legacyNew: 2615, // KAI-disabled instance: genuinely new organization
    legacyTakeover: 2616, // KAI-disabled instance: applies under the bound organization's name
  });
  const email = (legacyId) => `name-takeover-${legacyId}@harborlight.test`;
  const BOUND_ORG_NAME = "Cobalt Harbor Synthetic Food Bank";
  const UNBOUND_ORG_NAME = "Ember Valley Youth Club";
  const SHELTER_ORG_NAME = "Seaside Synthetic Shelters";
  const NEW_ORG_NAME = "Quillwort Synthetic Community Garden";
  const RACE_ORG_NAME = "Pebblebrook Synthetic Collective";
  const DOUBLE_ORG_NAME = "Kittiwake Synthetic Commons";
  const LEGACY_NEW_ORG_NAME = "Driftline Legacy Synthetic Club";
  const BOUND_KAI = "00000000-0000-4000-8000-0000000ab0f1";
  const BOUND_PROJECT = "7d000000-0000-4000-8000-0000000ab0f1";
  const INTAKE = "/api/kai/sprint2/intake";
  const ACCESS = "/api/kai/sprint2/access-administration";
  const contextPath = `${ACCESS}/administration-context`;
  const rosterPath = (organizationId) => `${ACCESS}/organizations/${organizationId}/access`;
  const capabilitiesPath = (organizationId) => `${INTAKE}/admin/organizations/${organizationId}/access-capabilities`;
  const projectsPath = (organizationId) => `${INTAKE}/admin/organizations/${organizationId}/engagements`;
  const onboardingPath = `${INTAKE}/admin/organization-onboarding/status`;
  const organizationsPath = `${INTAKE}/admin/organizations`;
  const approvePath = (applicationId) => `/admin/org-applications/${applicationId}/approve`;
  const pathOf = (r) => new URL(r.url).pathname;

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
      [legacyId, email(legacyId), `Name-Takeover ${key}`, passwordHash, legacyId === USERS.site]);
  }
  // An existing Get Kinder organization exactly as an approval leaves it.
  async function existingOrganization(name, adminLegacyId) {
    const [organization] = await query(
      `INSERT INTO public.organizations (name, description, website, rep_user_id, rep_role, status, approved_at, approved_by)
       VALUES ($1, 'Existing synthetic organization.', 'https://existing.example.test', $2, 'Executive Director', 'approved', now(), 'earlier-approver')
       RETURNING id`, [name, adminLegacyId]);
    await query("UPDATE public.userdata SET org_rep = true, org_id = $1 WHERE id = $2", [organization.id, adminLegacyId]);
    await query("INSERT INTO public.user_org_memberships (org_id, user_id, role, is_active) VALUES ($1, $2, 'admin', true)", [organization.id, adminLegacyId]);
    return organization;
  }
  const boundGk = await existingOrganization(BOUND_ORG_NAME, USERS.boundAdmin);
  await query("INSERT INTO public.user_org_memberships (org_id, user_id, role, is_active) VALUES ($1, $2, 'member', true)", [boundGk.id, USERS.boundMember]);
  await query("INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES ($1::uuid, $2, 'cobalt-harbor-synthetic')", [BOUND_KAI, BOUND_ORG_NAME]);
  await query("INSERT INTO kai.gk_organization_bindings (gk_organization_id, kai_organization_id, status) VALUES ($1, $2::uuid, 'active')", [boundGk.id, BOUND_KAI]);
  await query("INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code, project_metadata) VALUES ($1::uuid, $2::uuid, 'Cobalt Harbor Existing Project', '{}'::jsonb)",
    [BOUND_PROJECT, BOUND_KAI]);
  const boundMemberKai = await findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: USERS.boundMember, email: email(USERS.boundMember) });
  await query("INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status) VALUES ($1::uuid, $2::uuid, 'client_contributor', 'active')",
    [BOUND_KAI, boundMemberKai.user_id]);
  const unboundGk = await existingOrganization(UNBOUND_ORG_NAME, USERS.unboundAdmin);
  const shelterGk = await existingOrganization(SHELTER_ORG_NAME, USERS.shelterAdmin);

  // --- database readers ----------------------------------------------------
  const applicationOf = async (legacyId) => (await query(
    "SELECT id, status, org_name, reviewed_at, reviewed_by FROM public.org_applications WHERE user_id = $1 ORDER BY id DESC", [legacyId]))[0] || null;
  const gkOrganizationsNamed = async (name) => query(
    "SELECT id, rep_user_id, status FROM public.organizations WHERE lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) = lower($1) ORDER BY id", [name]);
  const gkMembershipsOf = async (legacyId) => query(
    "SELECT org_id, role, COALESCE(is_active, true) AS is_active, added_by_user_id FROM public.user_org_memberships WHERE user_id = $1 ORDER BY org_id", [legacyId]);
  const bindingsFor = async (gkOrganizationId) => query(
    "SELECT kai_organization_id::text, status FROM kai.gk_organization_bindings WHERE gk_organization_id = $1 ORDER BY gk_organization_binding_id", [gkOrganizationId]);
  const kaiOrganizationsFor = async (gkOrganizationId) => query(
    "SELECT organization_id::text, name, status::text FROM kai.organizations WHERE legacy_public_organization_id = $1 ORDER BY organization_id", [gkOrganizationId]);
  const globalRoleCountOf = async (legacyId) => (await query(
    `SELECT count(*)::int AS count FROM kai.user_roles ur JOIN kai.users u ON u.user_id = ur.user_id
      WHERE u.legacy_public_userdata_id = $1 AND ur.active = true AND ur.revoked_at IS NULL`, [legacyId]))[0].count;
  const storedMembershipsOf = async (legacyId) => query(
    `SELECT m.organization_id::text, m.role_name, m.membership_status FROM kai.organization_memberships m JOIN kai.users u ON u.user_id = m.user_id
      WHERE u.legacy_public_userdata_id = $1 ORDER BY m.organization_id, m.role_name`, [legacyId]);
  const projectsOf = async (kaiOrganizationId) => query(
    "SELECT engagement_id::text, engagement_code, organization_id::text FROM kai.engagements WHERE organization_id = $1::uuid ORDER BY engagement_code", [kaiOrganizationId]);
  const auditsForOrganization = async (kaiOrganizationId) => query(
    "SELECT action, actor_user_id::text, metadata FROM kai.audit_events WHERE metadata->>'organization_id' = $1 ORDER BY audit_event_id", [kaiOrganizationId]);
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
  // Everything an approval could touch for one existing organization and the
  // people around it: identity, representative, legacy fields, memberships,
  // KAI organization, binding, Project, stored KAI memberships and audits.
  async function organizationState(gkOrganizationId, people) {
    return {
      organizations: await query("SELECT * FROM public.organizations WHERE id = $1", [gkOrganizationId]),
      sameNamedOrganizations: (await query(
        `SELECT count(*)::int AS count FROM public.organizations
          WHERE lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) = (SELECT lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) FROM public.organizations WHERE id = $1)`,
        [gkOrganizationId]))[0].count,
      people: await query("SELECT id, org_rep, org_id FROM public.userdata WHERE id = ANY($1::int[]) ORDER BY id", [people]),
      memberships: await query(
        "SELECT user_id, role, COALESCE(is_active, true) AS is_active, added_by_user_id FROM public.user_org_memberships WHERE org_id = $1 OR user_id = ANY($2::int[]) ORDER BY user_id, org_id",
        [gkOrganizationId, people]),
      bindings: await query("SELECT * FROM kai.gk_organization_bindings WHERE gk_organization_id = $1 ORDER BY gk_organization_binding_id", [gkOrganizationId]),
      kaiOrganizations: await query(
        `SELECT o.organization_id::text, o.name, o.status::text FROM kai.organizations o
          JOIN kai.gk_organization_bindings b ON b.kai_organization_id = o.organization_id WHERE b.gk_organization_id = $1 ORDER BY 1`, [gkOrganizationId]),
      projects: await query(
        `SELECT e.engagement_id::text, e.engagement_code, e.organization_id::text FROM kai.engagements e
          JOIN kai.gk_organization_bindings b ON b.kai_organization_id = e.organization_id WHERE b.gk_organization_id = $1 ORDER BY 1`, [gkOrganizationId]),
      storedKaiMemberships: await query(
        `SELECT m.organization_id::text, m.user_id::text, m.role_name, m.membership_status FROM kai.organization_memberships m
          JOIN kai.gk_organization_bindings b ON b.kai_organization_id = m.organization_id WHERE b.gk_organization_id = $1 ORDER BY 2, 3`, [gkOrganizationId]),
      audits: (await query(
        `SELECT count(*)::int AS count FROM kai.audit_events a
          JOIN kai.gk_organization_bindings b ON a.metadata->>'organization_id' = b.kai_organization_id::text WHERE b.gk_organization_id = $1`, [gkOrganizationId]))[0].count,
    };
  }
  // The applicant's Get Kinder and KAI authority, through the real resolvers.
  async function resolvedAuthority(legacyId) {
    const scope = await resolveOrgScopeForUserId(legacyId, { includeOrgMembersForOrgRep: false });
    return {
      gkAdminOf: scope.memberships.filter((m) => m.role === "admin" && m.is_active !== false).map((m) => m.orgId).sort(),
      gkOrganizations: scope.memberships.map((m) => m.orgId).sort(),
      derivedClientAdminOf: (await resolveEffectiveClientOrganizationMembershipsForLegacyUser(legacyId))
        .filter((m) => m.role_name === "client_admin").map((m) => m.organization_id).sort(),
    };
  }

  // --- application, browser, sessions ---------------------------------------
  const smtp = await startLoopbackSmtpSink();
  const app = await startRealApplication({ databaseUrl: RUNNER_DATABASE_URL, workdir: WORKDIR, name: "name-takeover", smtpPort: smtp.port });
  const { baseUrl } = app;
  const browser = await launchChrome({ chrome: CHROME, workdir: WORKDIR, profileName: "name-takeover" });
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
  const notificationsTo = (legacyId) => smtp.messages.filter((message) => message.to.includes(email(legacyId)));
  const approvalNotificationsTo = (legacyId) => notificationsTo(legacyId).filter((message) => /approved as an Organization Representative/.test(message.data));
  async function applyAs(legacyId, organizationName, { url = baseUrl, formPath = "/org-apply" } = {}) {
    const page = await signIn(legacyId, url);
    assert.equal(await page.goto(formPath), "/org-apply");
    await page.setInput("orgName", organizationName);
    await page.setInput("repRole", "Executive Director");
    await page.setInput("orgWebsite", "https://example.test");
    await page.setInput("orgDescription", "Synthetic organization for local acceptance.");
    await page.clickWhere("Submit Application", `() => document.querySelector("form[action='/org-apply'] button[type=submit]")`);
    await page.waitFor(async () => (await page.evaluate("location.search")).includes("submitted=true"), "application submitted");
    contexts.splice(contexts.indexOf(page), 1);
    await page.close();
    return applicationOf(legacyId);
  }
  // The real /admin/org-applications page: the site admin clicks Approve and
  // waits for the page's own outcome (card removed, or its inline error).
  // Returns the approval request's status and JSON body.
  async function approveOnPage(page, applicationId) {
    assert.equal(await page.goto("/admin/org-applications"), "/admin/org-applications");
    await page.waitFor(() => page.evaluate(`Boolean(document.getElementById("app-card-${applicationId}"))`), `application card ${applicationId}`);
    const mark = page.mark();
    await page.clickWhere(`approve ${applicationId}`,
      `() => document.querySelector('button.js-admin-action[data-id="${applicationId}"][data-action="approve"]')`);
    await page.waitFor(() => page.evaluate(`(() => {
      const card = document.getElementById("app-card-${applicationId}");
      return !card || !card.querySelector(".app-inline-error").classList.contains("d-none");
    })()`), `approval of ${applicationId} decided`);
    await page.idle();
    const decisions = page.requestsSince(mark).filter((r) => r.method === "POST");
    assert.deepEqual(decisions.map(pathOf), [approvePath(applicationId)]);
    const cardText = await page.evaluate(`(() => { const card = document.getElementById("app-card-${applicationId}"); return card ? card.innerText : null; })()`);
    return { status: decisions[0].status, body: await page.responseJson(decisions[0]), cardText };
  }
  // Simultaneous approval requests from the signed-in site admin's page, with
  // the session CSRF token that page renders and sends.
  const approveConcurrently = (page, applicationIds) => page.evaluate(`(async () => {
    const html = await (await fetch("/admin/org-applications", { credentials: "same-origin" })).text();
    const token = html.match(/<meta name="csrf-token" content="([^"]+)">/)[1];
    return Promise.all(${JSON.stringify(applicationIds)}.map(async (id) => {
      const response = await fetch("/admin/org-applications/" + id + "/approve", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json", "X-CSRF-Token": token } });
      return { id, status: response.status, body: await response.json().catch(() => null) };
    }));
  })()`);
  const authorizedOrganizationIds = async (page) => ((await page.fetchJson("GET", organizationsPath)).data?.items || []).map((item) => item.organization_id).sort();
  // The applicant's own independent sign-in: what they can actually do.
  async function effectiveAccessOf(legacyId, kaiOrganizationId, url = baseUrl) {
    const page = await signIn(legacyId, url);
    const capabilities = await page.fetchJson("GET", capabilitiesPath(kaiOrganizationId));
    const access = {
      kaiOrganizations: await authorizedOrganizationIds(page),
      capabilitiesStatus: capabilities.status,
      organizationAccessManagement: capabilities.data?.organizationAccessManagement ?? null,
      rosterStatus: (await page.fetchJson("GET", rosterPath(kaiOrganizationId))).status,
      projectsStatus: (await page.fetchJson("GET", projectsPath(kaiOrganizationId))).status,
      platformAdministration: (await page.fetchJson("GET", contextPath)).data?.platform_administration === true,
      onboarding: (await page.fetchJson("GET", onboardingPath)).data?.status ?? null,
    };
    await signOut(page);
    return access;
  }
  const REFUSED_ACCESS = Object.freeze({ kaiOrganizations: [], capabilitiesStatus: 403, organizationAccessManagement: null, rosterStatus: 403, projectsStatus: 403, platformAdministration: false, onboarding: "PENDING" });
  const NO_AUTHORITY = Object.freeze({ gkAdminOf: [], gkOrganizations: [], derivedClientAdminOf: [] });
  const assertSafeRefusal = (outcome, label) => {
    assert.equal(outcome.status, 409, `${label}: refused as a conflict`);
    assert.deepEqual([outcome.body.success, outcome.body.error], [false, "organization_name_conflict"], `${label}: safe refusal body`);
    assert.doesNotMatch(JSON.stringify(outcome.body), /@|rep_user_id|org_id/, `${label}: names no person or organization id`);
  };
  const boundPeople = [USERS.boundAdmin, USERS.boundMember, USERS.takeover, USERS.takeoverSecond, USERS.takeoverThird, USERS.legacyTakeover];

  let sitePage = null;
  try {
    sitePage = await signIn(USERS.site);

    // =====================================================================
    // A. Existing organization with an active KAI binding
    // =====================================================================
    await test("A: an unrelated applicant's application under an existing bound organization's name is refused; it gains no Get Kinder or KAI authority and the organization, its people, binding and Project are unchanged", async () => {
      const application = await applyAs(USERS.takeover, `  cobalt   HARBOR synthetic food bank `);
      const before = { state: await organizationState(boundGk.id, boundPeople), kai: await allKaiCounts(), authority: await resolvedAuthority(USERS.takeover) };
      assert.deepEqual(before.authority, NO_AUTHORITY, "the applicant starts with no authority");
      const outcome = await approveOnPage(sitePage, application.id);
      const after = { state: await organizationState(boundGk.id, boundPeople), authority: await resolvedAuthority(USERS.takeover) };
      const access = await effectiveAccessOf(USERS.takeover, BOUND_KAI);
      results.A = { status: outcome.status, body: outcome.body, authority: after.authority, access,
        applicantLegacy: after.state.people.find((p) => p.id === USERS.takeover), applicantMemberships: await gkMembershipsOf(USERS.takeover),
        approvalEmail: approvalNotificationsTo(USERS.takeover).length };
      console.log(`[name-takeover] A observed ${JSON.stringify(results.A)}`);

      assertSafeRefusal(outcome, "A");
      assert.match(outcome.cardText, /already exists/, "the admin page shows why, and keeps the application");
      assert.deepEqual(after.state, before.state, "organization, representative, legacy fields, memberships, binding, KAI organization, Project, stored memberships, audits");
      assert.deepEqual(after.authority, NO_AUTHORITY, "no Get Kinder admin, no derived client_admin");
      assert.deepEqual(access, REFUSED_ACCESS, "independent sign-in: no KAI organization, Team & Access refused");
      assert.equal(await globalRoleCountOf(USERS.takeover), 0);
      assert.deepEqual(await storedMembershipsOf(USERS.takeover), []);
      assert.deepEqual(changedTables(before.kai, await allKaiCounts()).filter((table) => table !== "users"), [], "nothing written to KAI");
      const persisted = await applicationOf(USERS.takeover);
      assert.deepEqual([persisted.status, persisted.reviewed_at, persisted.reviewed_by], ["pending", null, null], "the application is kept for later handling");
      assert.equal(approvalNotificationsTo(USERS.takeover).length, 0, "no approval notification");
      assert.match(app.log(), new RegExp(`\\[org-applications\\] approval refused \\{\\s*code: 'organization_name_conflict',\\s*application_id: ${application.id},\\s*organization_id: ${boundGk.id}\\s*\\}`),
        "metadata-only refusal record: code and ids, no names or email");
      // The existing administrator and member keep their access.
      const adminAccess = await effectiveAccessOf(USERS.boundAdmin, BOUND_KAI);
      assert.deepEqual([adminAccess.kaiOrganizations, adminAccess.organizationAccessManagement], [[BOUND_KAI], true]);
      assert.deepEqual((await resolvedAuthority(USERS.boundAdmin)).derivedClientAdminOf, [BOUND_KAI]);
      const memberPage = await signIn(USERS.boundMember);
      assert.deepEqual(await authorizedOrganizationIds(memberPage), [BOUND_KAI]);
      await signOut(memberPage);
    });

    // =====================================================================
    // B. Existing organizations without a KAI binding
    // =====================================================================
    await test("B: an unrelated applicant's application under an existing unbound organization's name is refused; no membership, representative, legacy field or binding is written", async () => {
      const application = await applyAs(USERS.unboundTakeover, "EMBER valley youth club");
      const people = [USERS.unboundAdmin, USERS.unboundTakeover];
      const before = { state: await organizationState(unboundGk.id, people), kai: await allKaiCounts() };
      const outcome = await approveOnPage(sitePage, application.id);
      const after = await organizationState(unboundGk.id, people);
      results.B = { status: outcome.status, body: outcome.body, authority: await resolvedAuthority(USERS.unboundTakeover),
        bindings: await bindingsFor(unboundGk.id), kaiOrganizations: await kaiOrganizationsFor(unboundGk.id) };
      console.log(`[name-takeover] B observed ${JSON.stringify(results.B)}`);

      assertSafeRefusal(outcome, "B");
      assert.deepEqual(after, before.state);
      assert.deepEqual(results.B.authority, NO_AUTHORITY);
      assert.deepEqual(results.B.bindings, [], "no binding");
      assert.deepEqual(results.B.kaiOrganizations, [], "no KAI organization");
      assert.deepEqual(changedTables(before.kai, await allKaiCounts()).filter((table) => table !== "users"), []);
      assert.equal((await applicationOf(USERS.unboundTakeover)).status, "pending");
      assert.equal(approvalNotificationsTo(USERS.unboundTakeover).length, 0);
    });

    await test("B (normalization): a name the old SQL normalization never matched (a lowercase \"s\") is still recognized as the existing organization; no same-named duplicate organization is created", async () => {
      const application = await applyAs(USERS.shelterTakeover, "seaside  synthetic SHELTERS");
      const people = [USERS.shelterAdmin, USERS.shelterTakeover];
      const before = { state: await organizationState(shelterGk.id, people), kai: await allKaiCounts() };
      const outcome = await approveOnPage(sitePage, application.id);
      results.B_normalization = { status: outcome.status, body: outcome.body, sameNamed: await gkOrganizationsNamed(SHELTER_ORG_NAME),
        authority: await resolvedAuthority(USERS.shelterTakeover) };
      console.log(`[name-takeover] B normalization observed ${JSON.stringify(results.B_normalization)}`);

      assertSafeRefusal(outcome, "B normalization");
      assert.deepEqual(results.B_normalization.sameNamed.map((o) => o.id), [shelterGk.id], "no duplicate organization");
      assert.deepEqual(await organizationState(shelterGk.id, people), before.state);
      assert.deepEqual(results.B_normalization.authority, NO_AUTHORITY);
      assert.deepEqual(changedTables(before.kai, await allKaiCounts()).filter((table) => table !== "users"), []);
      assert.equal(approvalNotificationsTo(USERS.shelterTakeover).length, 0);
    });

    // =====================================================================
    // Trusted relationship: the organization's own administrator
    // =====================================================================
    await test("trusted: the organization's own active administrator applying under its name is approved against the same organization, gains nothing new, and nobody's authority changes", async () => {
      const application = await applyAs(USERS.boundAdmin, BOUND_ORG_NAME, { formPath: "/org-apply?source=impact-library" });
      const before = { state: await organizationState(boundGk.id, boundPeople), kai: await allKaiCounts() };
      const outcome = await approveOnPage(sitePage, application.id);
      assert.equal(outcome.status, 200);
      assert.deepEqual(outcome.body, { success: true, kai_organization: { status: "ready", outcome: "reused" } });
      assert.equal(outcome.cardText, null, "the card leaves the queue");
      const after = await organizationState(boundGk.id, boundPeople);
      assert.deepEqual({ ...after, audits: before.state.audits }, before.state, "no Get Kinder or KAI authority change");
      assert.equal(after.audits, before.state.audits + 1, "the reuse is audited");
      assert.deepEqual(changedTables(before.kai, await allKaiCounts()), ["audit_events"]);
      assert.equal((await applicationOf(USERS.boundAdmin)).status, "approved");
      assert.deepEqual((await resolvedAuthority(USERS.boundAdmin)).derivedClientAdminOf, [BOUND_KAI]);
      const [audit] = (await auditsForOrganization(BOUND_KAI)).slice(-1);
      assert.equal(audit.action, "reuse_kai_organization_for_approved_application");
      results.trusted = outcome.body;
    });

    // =====================================================================
    // C. A genuinely new organization
    // =====================================================================
    await test("C: a genuinely new organization is approved; its applicant becomes its Get Kinder admin and, through KAI initialization, its KAI administrator with no Project and no global role", async () => {
      const application = await applyAs(USERS.newApplicant, NEW_ORG_NAME);
      const before = await allKaiCounts();
      const outcome = await approveOnPage(sitePage, application.id);
      assert.equal(outcome.status, 200);
      assert.deepEqual(outcome.body, { success: true, kai_organization: { status: "ready", outcome: "created" } });
      const [newGk, ...duplicates] = await gkOrganizationsNamed(NEW_ORG_NAME);
      assert.deepEqual(duplicates, []);
      assert.deepEqual([newGk.rep_user_id, newGk.status], [USERS.newApplicant, "approved"]);
      assert.deepEqual((await gkMembershipsOf(USERS.newApplicant)).map((m) => [m.org_id, m.role, m.is_active]), [[newGk.id, "admin", true]]);
      const [newKai, ...extraKai] = await kaiOrganizationsFor(newGk.id);
      assert.deepEqual(extraKai, []);
      assert.deepEqual(await bindingsFor(newGk.id), [{ kai_organization_id: newKai.organization_id, status: "active" }]);
      assert.deepEqual(await projectsOf(newKai.organization_id), [], "approval creates no Project");
      assert.deepEqual(changedTables(before, await allKaiCounts()), ["audit_events", "gk_organization_bindings", "organizations"]);
      assert.equal(approvalNotificationsTo(USERS.newApplicant).length, 1);
      assert.deepEqual(await resolvedAuthority(USERS.newApplicant),
        { gkAdminOf: [newGk.id], gkOrganizations: [newGk.id], derivedClientAdminOf: [newKai.organization_id] });

      // The applicant, alone, through their own sign-in.
      const page = await signIn(USERS.newApplicant);
      assert.equal(await page.pathname(), "/impact-library");
      assert.deepEqual(await authorizedOrganizationIds(page), [newKai.organization_id]);
      const onboarding = (await page.fetchJson("GET", onboardingPath)).data;
      assert.deepEqual([onboarding.status, onboarding.kai_organization_id, onboarding.can_enable_kai], ["KAI_AVAILABLE", newKai.organization_id, false]);
      assert.equal((await page.fetchJson("GET", capabilitiesPath(newKai.organization_id))).data.organizationAccessManagement, true);
      assert.equal((await page.fetchJson("GET", rosterPath(newKai.organization_id))).status, 200);
      assert.deepEqual((await page.fetchJson("GET", projectsPath(newKai.organization_id))).data.items, []);
      assert.equal((await page.fetchJson("GET", contextPath)).data.platform_administration, false);
      // Cross-organization management is denied.
      assert.deepEqual([(await page.fetchJson("GET", rosterPath(BOUND_KAI))).status, (await page.fetchJson("GET", capabilitiesPath(BOUND_KAI))).status], [403, 403]);
      assert.equal((await page.fetchJson("POST", `${ACCESS}/organizations/${newKai.organization_id}/memberships/${USERS.newApplicant}/roles`, { role_name: "gk_reviewer" })).status, 403, "no GK role");
      assert.equal((await page.fetchJson("PUT", `${ACCESS}/global-roles/${USERS.newApplicant}`, { role_name: "gk_admin", action: "assign" })).status, 403, "no global role");
      assert.equal(await page.goto("/admin/org-applications"), "/", "no site administration");
      assert.equal(await page.goto("/impact-library"), "/impact-library");
      await page.waitFor(() => page.visibleControl("Team & Access"), "Team & Access");
      await page.clickNav("Team & Access");
      await page.waitForText(`Team & Access for ${NEW_ORG_NAME}`);
      assert.deepEqual(page.exceptions, []);
      await signOut(page);
      assert.equal(await globalRoleCountOf(USERS.newApplicant), 0);
      assert.deepEqual(await storedMembershipsOf(USERS.newApplicant), [], "binding-derived administration; no stored membership");
      results.C = { response: outcome.body, onboarding: onboarding.status };
    });

    // =====================================================================
    // D. Concurrent and repeated attempts
    // =====================================================================
    await test("D: concurrent approvals of applications under the bound organization's name all refuse; repeating a refused approval refuses again; nothing changes", async () => {
      const second = await applyAs(USERS.takeoverSecond, BOUND_ORG_NAME);
      const third = await applyAs(USERS.takeoverThird, `${BOUND_ORG_NAME.toUpperCase()} `);
      const first = await applicationOf(USERS.takeover);
      const before = { state: await organizationState(boundGk.id, boundPeople), kai: await allKaiCounts() };
      const outcomes = await approveConcurrently(sitePage, [first.id, second.id, third.id]);
      const repeated = await approveConcurrently(sitePage, [first.id]);
      results.D_existing = { outcomes: outcomes.map((o) => [o.status, o.body?.error]), repeated: repeated.map((o) => [o.status, o.body?.error]),
        authority: [await resolvedAuthority(USERS.takeover), await resolvedAuthority(USERS.takeoverSecond), await resolvedAuthority(USERS.takeoverThird)] };
      console.log(`[name-takeover] D existing observed ${JSON.stringify(results.D_existing)}`);

      for (const outcome of [...outcomes, ...repeated]) assertSafeRefusal(outcome, `D application ${outcome.id}`);
      assert.deepEqual(await organizationState(boundGk.id, boundPeople), before.state);
      assert.deepEqual(results.D_existing.authority, [NO_AUTHORITY, NO_AUTHORITY, NO_AUTHORITY]);
      assert.deepEqual(changedTables(before.kai, await allKaiCounts()), []);
      for (const legacyId of [USERS.takeover, USERS.takeoverSecond, USERS.takeoverThird]) {
        assert.equal((await applicationOf(legacyId)).status, "pending");
        assert.equal(approvalNotificationsTo(legacyId).length, 0);
      }
      assert.deepEqual(await effectiveAccessOf(USERS.takeoverSecond, BOUND_KAI), REFUSED_ACCESS);
    });

    await test("D (new-name race): two applications for the same new name approved at once create exactly one organization; the first approval's applicant administers it and the other is refused with nothing written", async () => {
      const firstApplication = await applyAs(USERS.raceFirst, RACE_ORG_NAME);
      const secondApplication = await applyAs(USERS.raceSecond, ` ${RACE_ORG_NAME.toLowerCase()}`);
      const before = await allKaiCounts();
      const outcomes = await approveConcurrently(sitePage, [firstApplication.id, secondApplication.id]);
      const organizations = await gkOrganizationsNamed(RACE_ORG_NAME);
      results.D_race = { outcomes: outcomes.map((o) => [o.status, o.body?.error ?? o.body?.kai_organization?.status]),
        organizations: organizations.map((o) => o.rep_user_id),
        authority: [await resolvedAuthority(USERS.raceFirst), await resolvedAuthority(USERS.raceSecond)] };
      console.log(`[name-takeover] D race observed ${JSON.stringify(results.D_race)}`);

      assert.equal(organizations.length, 1, "exactly one organization");
      const winner = outcomes.find((o) => o.status === 200);
      const loser = outcomes.find((o) => o.status !== 200);
      assert.ok(winner && loser, JSON.stringify(results.D_race.outcomes));
      assert.deepEqual(winner.body, { success: true, kai_organization: { status: "ready", outcome: "created" } });
      assertSafeRefusal(loser, "D race loser");
      const winnerLegacy = winner.id === firstApplication.id ? USERS.raceFirst : USERS.raceSecond;
      const loserLegacy = winnerLegacy === USERS.raceFirst ? USERS.raceSecond : USERS.raceFirst;
      const [raceKai] = await kaiOrganizationsFor(organizations[0].id);
      assert.equal(organizations[0].rep_user_id, winnerLegacy);
      assert.deepEqual(await resolvedAuthority(winnerLegacy), { gkAdminOf: [organizations[0].id], gkOrganizations: [organizations[0].id], derivedClientAdminOf: [raceKai.organization_id] });
      assert.deepEqual(await resolvedAuthority(loserLegacy), NO_AUTHORITY);
      assert.deepEqual(await bindingsFor(organizations[0].id), [{ kai_organization_id: raceKai.organization_id, status: "active" }]);
      assert.deepEqual(changedTables(before, await allKaiCounts()), ["audit_events", "gk_organization_bindings", "organizations"]);
      assert.equal((await applicationOf(loserLegacy)).status, "pending");
      assert.equal(approvalNotificationsTo(loserLegacy).length, 0);
      assert.equal(approvalNotificationsTo(winnerLegacy).length, 1);
    });

    await test("D (double approval): one application approved twice at once is approved exactly once; the other request is refused as not pending; one organization, one notification", async () => {
      const application = await applyAs(USERS.doubleApproval, DOUBLE_ORG_NAME);
      const outcomes = await approveConcurrently(sitePage, [application.id, application.id]);
      const organizations = await gkOrganizationsNamed(DOUBLE_ORG_NAME);
      results.D_double = { outcomes: outcomes.map((o) => [o.status, o.body?.error ?? o.body?.kai_organization?.status]), organizations: organizations.length,
        notifications: approvalNotificationsTo(USERS.doubleApproval).length };
      console.log(`[name-takeover] D double observed ${JSON.stringify(results.D_double)}`);

      assert.deepEqual(outcomes.map((o) => o.status).sort(), [200, 400]);
      assert.equal(outcomes.find((o) => o.status === 400).body.error, "application not pending");
      assert.equal(organizations.length, 1);
      assert.equal((await kaiOrganizationsFor(organizations[0].id)).length, 1);
      assert.equal(approvalNotificationsTo(USERS.doubleApproval).length, 1);
    });

    // =====================================================================
    // E. KAI Sprint 2 disabled
    // =====================================================================
    await test("E: with KAI Sprint 2 disabled a genuinely new organization is still approved (legacy) with zero KAI writes, and an application under the bound organization's name is still refused at the legacy boundary", async () => {
      const legacyNew = await applyAs(USERS.legacyNew, LEGACY_NEW_ORG_NAME);
      const legacyTakeover = await applyAs(USERS.legacyTakeover, BOUND_ORG_NAME);
      legacyApp = await startRealApplication({ databaseUrl: RUNNER_DATABASE_URL, workdir: WORKDIR, name: "name-takeover-legacy",
        smtpPort: smtp.port, env: { KAI_SPRINT2_ENABLED: "false" } });
      const legacySite = await signIn(USERS.site, legacyApp.baseUrl);
      const before = { state: await organizationState(boundGk.id, boundPeople), kai: await allKaiCounts() };

      const refused = await approveOnPage(legacySite, legacyTakeover.id);
      results.E_takeover = { status: refused.status, body: refused.body, authority: await resolvedAuthority(USERS.legacyTakeover) };
      console.log(`[name-takeover] E takeover observed ${JSON.stringify(results.E_takeover)}`);
      assertSafeRefusal(refused, "E");
      assert.deepEqual(await organizationState(boundGk.id, boundPeople), before.state);
      assert.deepEqual(results.E_takeover.authority, NO_AUTHORITY);
      assert.equal((await applicationOf(USERS.legacyTakeover)).status, "pending");
      assert.equal(approvalNotificationsTo(USERS.legacyTakeover).length, 0);

      const approved = await approveOnPage(legacySite, legacyNew.id);
      assert.deepEqual([approved.status, approved.body], [200, { success: true, kai_organization: { status: "not_enabled" } }]);
      const [legacyGk] = await gkOrganizationsNamed(LEGACY_NEW_ORG_NAME);
      assert.equal(legacyGk.rep_user_id, USERS.legacyNew);
      assert.deepEqual((await gkMembershipsOf(USERS.legacyNew)).map((m) => [m.org_id, m.role, m.is_active]), [[legacyGk.id, "admin", true]]);
      assert.equal(approvalNotificationsTo(USERS.legacyNew).length, 1);
      assert.deepEqual(changedTables(before.kai, await allKaiCounts()), [], "no KAI write with Sprint 2 disabled");
      contexts.splice(contexts.indexOf(legacySite), 1);
      await legacySite.close();
      // The same applicant on the KAI-enabled instance: still nothing.
      assert.deepEqual(await effectiveAccessOf(USERS.legacyTakeover, BOUND_KAI), REFUSED_ACCESS);
      results.E_new = approved.body;
    });
  } finally {
    console.log(`[name-takeover] results ${JSON.stringify(results)}`);
    for (const page of contexts.splice(0)) await page.close().catch(() => {});
    await browser.close();
    await app.stop();
    if (legacyApp) await legacyApp.stop();
    await smtp.close();
    await seedPool.end();
  }
}
