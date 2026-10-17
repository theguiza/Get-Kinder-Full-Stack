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
 * Approval-triggered first organization administrator, run only by
 *   node scripts/kai-client-knowledge-studio-browser-acceptance-local-postgres.js \
 *     __tests__/kai-approval-triggered-organization-administrator-browser-acceptance.integration.spec.js
 * against that runner's ephemeral loopback PostgreSQL. Skipped otherwise.
 *
 * The repository's own index.js runs as a loopback child process (see
 * support/kaiRealApplicationBrowserHarness.js): every actor signs in through
 * the real /login form, the applicant submits the real /org-apply form, a
 * Get Kinder site admin approves or declines on the real
 * /admin/org-applications page, and the applicant and a new member then use
 * /impact-library in real Chrome. Notification email goes to a loopback SMTP
 * sink that delivers nothing. A second instance runs with KAI Sprint 2
 * disabled for the legacy-approval case.
 *
 * FIXTURES (direct SQL, never the behavior under test): accounts with bcrypt
 * passwords (one is_admin site admin), the production-shaped Get Kinder
 * organization columns the approval writes, an existing bound organization
 * with its own administrator, member and Project, and a trigger that makes
 * one organization's kai.organizations insert fail (failure injection).
 * The out-of-band removal of an organization admin membership is also a
 * direct write: no application route removes one.
 */

const RUNNER_DATABASE_URL = process.env.KAI_CLIENT_BROWSER_ACCEPTANCE_DATABASE_URL;
const CHROME = process.env.KAI_CLIENT_BROWSER_ACCEPTANCE_CHROME;
const WORKDIR = process.env.KAI_CLIENT_BROWSER_ACCEPTANCE_WORKDIR;

test("approval-triggered organization administrator isolation: a non-loopback runner URL is refused", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
});

test("approval-triggered organization administrator: the approval route initializes KAI only after its own commit, behind the Sprint 2 flag", () => {
  const source = readFileSync(new URL("../routes/orgApplyApi.js", import.meta.url), "utf8");
  assert.match(source, /orgApplyRouter\.post\("\/admin\/org-applications\/:id\/approve", ensureAuthenticated, ensureAdmin,/);
  const commit = source.indexOf('await client.query("COMMIT");\n\n    const kaiOrganization = await initializeKaiForApprovedApplication(req, applicationId, approvedOrgId);');
  assert.ok(commit > 0, "KAI initialization follows the approval's COMMIT");
  assert.match(source, /if \(!isKaiSprint2Enabled\(process\.env\)\) return \{ status: "not_enabled" \};/);
});

if (!RUNNER_DATABASE_URL || !CHROME || !WORKDIR) {
  test("approval-triggered organization administrator requires its runner", { skip: true }, () => {});
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
  const { initializeKaiOrganizationForApprovedApplication } = await import("../Backend/kai/services/kaiOrganizationEnablementService.js");

  const PASSWORD = "Synthetic-Sign-In-2026!";
  const USERS = Object.freeze({
    site: 2501, // Get Kinder site admin (public.userdata.is_admin): approves and declines
    applicant: 2502, // verified account, never used KAI; applies for a new organization
    joiner: 2503, // verified account; requests to join the applicant's organization
    plain: 2504, // verified account with no role
    existingAdmin: 2505, // Get Kinder admin of the existing bound organization (derived client_admin)
    existingMember: 2506, // stored client_contributor of the existing KAI organization
    pendingApplicant: 2507, // applies; never decided
    declinedApplicant: 2508, // applies; declined
    sameNameApplicant: 2509, // applies under the existing organization's name
    failingApplicant: 2510, // applies; its KAI initialization is made to fail
    legacyApplicant: 2511, // approved by the KAI-disabled instance; then initialized concurrently
    freshApplicant: 2512, // verified account that never signed in; its application is a fixture row
  });
  const email = (legacyId) => `org-admin-${legacyId}@seabright.test`;
  const NEW_ORG_NAME = "Tidepool Synthetic Community Kitchen";
  const EXISTING_ORG_NAME = "Seabright Synthetic Food Bank";
  const FAILING_ORG_NAME = "Breakwater Failing Synthetic Trust";
  const LEGACY_ORG_NAME = "Driftwood Legacy Synthetic Club";
  const FRESH_ORG_NAME = "Eelgrass Fresh Synthetic Collective";
  const EXISTING_KAI = "00000000-0000-4000-8000-0000000ab0e1";
  const EXISTING_PROJECT = "7d000000-0000-4000-8000-0000000ab0e1";
  const INTAKE = "/api/kai/sprint2/intake";
  const ACCESS = "/api/kai/sprint2/access-administration";
  const contextPath = `${ACCESS}/administration-context`;
  const rosterPath = (organizationId) => `${ACCESS}/organizations/${organizationId}/access`;
  const capabilitiesPath = (organizationId) => `${INTAKE}/admin/organizations/${organizationId}/access-capabilities`;
  const projectsPath = (organizationId) => `${INTAKE}/admin/organizations/${organizationId}/engagements`;
  const onboardingPath = `${INTAKE}/admin/organization-onboarding/status`;
  const organizationsPath = `${INTAKE}/admin/organizations`;
  const enablementPath = (gkOrganizationId) => `${INTAKE}/admin/gk-organizations/${gkOrganizationId}/kai-enablement`;
  const rowKey = (legacyId) => `legacy:${legacyId}`;
  const pathOf = (r) => new URL(r.url).pathname;
  const writes = (requests) => requests.filter((r) => r.method !== "GET").map((r) => [r.method, pathOf(r), r.status]);

  // =====================================================================
  // FIXTURES
  // =====================================================================
  await query(`ALTER TABLE public.userdata ADD COLUMN IF NOT EXISTS firstname text, ADD COLUMN IF NOT EXISTS lastname text,
                 ADD COLUMN IF NOT EXISTS password text, ADD COLUMN IF NOT EXISTS is_admin boolean DEFAULT false`);
  // The production public.organizations columns the approval writes and the shell reads.
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
      [legacyId, email(legacyId), `Org-Admin ${key}`, passwordHash, legacyId === USERS.site]);
  }
  // An existing, correctly linked organization with its own people and Project.
  const [existingGk] = await query("INSERT INTO public.organizations (name, status) VALUES ($1, 'approved') RETURNING id", [EXISTING_ORG_NAME]);
  await query("INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES ($1::uuid, $2, 'seabright-synthetic')", [EXISTING_KAI, EXISTING_ORG_NAME]);
  await query("INSERT INTO kai.gk_organization_bindings (gk_organization_id, kai_organization_id, status) VALUES ($1, $2::uuid, 'active')", [existingGk.id, EXISTING_KAI]);
  await query("INSERT INTO public.user_org_memberships (org_id, user_id, role, is_active) VALUES ($1, $2, 'admin', true)", [existingGk.id, USERS.existingAdmin]);
  await query("INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code, project_metadata) VALUES ($1::uuid, $2::uuid, 'Seabright Existing Project', '{}'::jsonb)",
    [EXISTING_PROJECT, EXISTING_KAI]);
  const existingMemberKai = await findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: USERS.existingMember, email: email(USERS.existingMember) });
  await query("INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status) VALUES ($1::uuid, $2::uuid, 'client_contributor', 'active')",
    [EXISTING_KAI, existingMemberKai.user_id]);
  // Failure injection: this one organization's KAI insert fails.
  await query(`CREATE FUNCTION kai.harness_fail_organization_insert() RETURNS trigger LANGUAGE plpgsql AS $$
                 BEGIN IF NEW.name = '${FAILING_ORG_NAME}' THEN RAISE EXCEPTION 'harness-injected KAI organization insert failure'; END IF; RETURN NEW; END $$`);
  await query("CREATE TRIGGER harness_fail_organization_insert BEFORE INSERT ON kai.organizations FOR EACH ROW EXECUTE FUNCTION kai.harness_fail_organization_insert()");

  // --- database readers ----------------------------------------------------
  const kaiUserOf = async (legacyId) => (await query("SELECT user_id::text, status FROM kai.users WHERE legacy_public_userdata_id = $1", [legacyId]))[0] || null;
  const applicationOf = async (legacyId) => (await query("SELECT id, status, org_name FROM public.org_applications WHERE user_id = $1 ORDER BY id DESC", [legacyId]))[0] || null;
  const gkOrganizationsNamed = async (name) => query("SELECT id, rep_user_id, status FROM public.organizations WHERE lower(name) = lower($1) ORDER BY id", [name]);
  const gkAdminMembershipsOf = async (legacyId) => query(
    "SELECT org_id, role, COALESCE(is_active, true) AS is_active FROM public.user_org_memberships WHERE user_id = $1 ORDER BY org_id", [legacyId]);
  const bindingsFor = async (gkOrganizationId) => query(
    "SELECT kai_organization_id::text, status FROM kai.gk_organization_bindings WHERE gk_organization_id = $1 ORDER BY gk_organization_binding_id", [gkOrganizationId]);
  const kaiOrganizationsFor = async (gkOrganizationId) => query(
    "SELECT organization_id::text, name, status::text FROM kai.organizations WHERE legacy_public_organization_id = $1 ORDER BY organization_id", [gkOrganizationId]);
  const projectsOf = async (kaiOrganizationId) => query("SELECT engagement_id::text, engagement_code FROM kai.engagements WHERE organization_id = $1::uuid ORDER BY engagement_code", [kaiOrganizationId]);
  const storedMembershipsOf = async (legacyId) => query(
    `SELECT m.organization_id::text, m.role_name, m.membership_status FROM kai.organization_memberships m JOIN kai.users u ON u.user_id = m.user_id
      WHERE u.legacy_public_userdata_id = $1 ORDER BY m.organization_id, m.role_name`, [legacyId]);
  const globalRoleCountOf = async (legacyId) => (await query(
    `SELECT count(*)::int AS count FROM kai.user_roles ur JOIN kai.users u ON u.user_id = ur.user_id
      WHERE u.legacy_public_userdata_id = $1 AND ur.active = true AND ur.revoked_at IS NULL`, [legacyId]))[0].count;
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

  // --- application, browser, sessions ---------------------------------------
  const smtp = await startLoopbackSmtpSink();
  const app = await startRealApplication({ databaseUrl: RUNNER_DATABASE_URL, workdir: WORKDIR, name: "approval-org-admin", smtpPort: smtp.port });
  const { baseUrl } = app;
  const browser = await launchChrome({ chrome: CHROME, workdir: WORKDIR, profileName: "approval-org-admin" });
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
  async function apply(page, organizationName) {
    assert.equal(await page.goto("/org-apply"), "/org-apply");
    await page.setInput("orgName", organizationName);
    await page.setInput("repRole", "Executive Director");
    await page.setInput("orgWebsite", "https://example.test");
    await page.setInput("orgDescription", "Synthetic organization for local acceptance.");
    await page.clickWhere("Submit Application", `() => document.querySelector("form[action='/org-apply'] button[type=submit]")`);
    await page.waitFor(async () => (await page.evaluate("location.search")).includes("submitted=true"), "application submitted");
  }
  // The real /admin/org-applications page: the site admin clicks Approve or
  // Decline; returns the decision request's JSON response.
  async function decide(page, applicationId, action) {
    assert.equal(await page.goto("/admin/org-applications"), "/admin/org-applications");
    await page.waitFor(() => page.evaluate(`Boolean(document.getElementById("app-card-${applicationId}"))`), `application card ${applicationId}`);
    const mark = page.mark();
    await page.clickWhere(`${action} ${applicationId}`,
      `() => document.querySelector('button.js-admin-action[data-id="${applicationId}"][data-action="${action}"]')`);
    await page.waitFor(() => page.evaluate(`!document.getElementById("app-card-${applicationId}")`), `card ${applicationId} decided`);
    await page.idle();
    const decisions = page.requestsSince(mark).filter((r) => r.method === "POST");
    assert.deepEqual(decisions.map((r) => [pathOf(r), r.status]), [[`/admin/org-applications/${applicationId}/${action}`, 200]]);
    return page.responseJson(decisions[0]);
  }
  async function openImpactLibrary(page) {
    assert.equal(await page.goto("/impact-library"), "/impact-library");
    await page.waitFor(async () => (await page.visibleControl("Knowledge Studio")) || (await page.visibleControl("Team & Access"))
      || (await page.text()).includes("Set up your organization") || (await page.text()).includes("Your organization"), "the Impact Library shell");
    await page.idle();
  }
  const memberRowText = (page, legacyId) => page.evaluate(`(() => {
    const el = document.querySelector('[data-team-access-member="${rowKey(legacyId)}"]');
    return el ? el.innerText : null;
  })()`);
  const memberHasRoleBadge = (page, legacyId, roleName) => page.evaluate(
    `Boolean(document.querySelector('[data-team-access-member="${rowKey(legacyId)}"] .gk-team-access-role--${roleName}'))`);
  const authorizedOrganizationIds = async (page) => ((await page.fetchJson("GET", organizationsPath)).data?.items || []).map((item) => item.organization_id).sort();

  let newGk = null;
  let newKai = null;
  try {
    // =====================================================================
    // A. Full new-organization journey
    // =====================================================================
    await test("A1: the applicant, signed in for real, submits the organization application; ordinary users cannot approve it; nothing reaches KAI", async () => {
      const applicantPage = await signIn(USERS.applicant);
      assert.deepEqual(await authorizedOrganizationIds(applicantPage), []);
      assert.equal((await applicantPage.fetchJson("GET", onboardingPath)).data.status, "NO_REQUEST");
      await apply(applicantPage, NEW_ORG_NAME);
      const application = await applicationOf(USERS.applicant);
      assert.deepEqual([application.status, application.org_name], ["pending", NEW_ORG_NAME]);
      assert.equal((await applicantPage.fetchJson("GET", onboardingPath)).data.status, "PENDING");
      assert.deepEqual(await authorizedOrganizationIds(applicantPage), []);
      assert.deepEqual(await gkOrganizationsNamed(NEW_ORG_NAME), [], "no organization before approval");
      await signOut(applicantPage);

      const before = await allKaiCounts();
      for (const legacyId of [USERS.plain, USERS.applicant]) {
        const page = await signIn(legacyId);
        assert.equal(await page.goto("/admin/org-applications"), "/", "ensureAdmin redirects a non-admin");
        const attempt = await page.fetchJson("POST", `/admin/org-applications/${application.id}/approve`);
        assert.deepEqual([attempt.redirected, attempt.finalPath], [true, "/"], "ensureAdmin redirects a non-admin's approval; nothing is approved");
        await signOut(page);
      }
      assert.equal((await applicationOf(USERS.applicant)).status, "pending");
      assert.deepEqual(changedTables(before, await allKaiCounts()).filter((table) => table !== "users"), [], "only sign-in identity mappings");
      results.A1 = { applicationId: application.id };
    });

    await test("A2: the site admin approves on /admin/org-applications; the approved organization gets its KAI organization and binding with no Project, no membership, no role; the audit names approver and applicant; the notification is sent", async () => {
      const sitePage = await signIn(USERS.site);
      const before = await allKaiCounts();
      const { id: applicationId } = await applicationOf(USERS.applicant);
      const response = await decide(sitePage, applicationId, "approve");
      assert.deepEqual(response, { success: true, kai_organization: { status: "ready", outcome: "created" } });
      assert.equal((await applicationOf(USERS.applicant)).status, "approved");
      [newGk] = await gkOrganizationsNamed(NEW_ORG_NAME);
      assert.deepEqual([newGk.rep_user_id, newGk.status], [USERS.applicant, "approved"]);
      assert.deepEqual(await gkAdminMembershipsOf(USERS.applicant), [{ org_id: newGk.id, role: "admin", is_active: true }]);
      const kaiOrganizations = await kaiOrganizationsFor(newGk.id);
      assert.equal(kaiOrganizations.length, 1);
      newKai = kaiOrganizations[0].organization_id;
      assert.deepEqual([kaiOrganizations[0].name, kaiOrganizations[0].status], [NEW_ORG_NAME, "active"]);
      assert.deepEqual(await bindingsFor(newGk.id), [{ kai_organization_id: newKai, status: "active" }]);
      assert.deepEqual(await projectsOf(newKai), [], "approval creates no Project");
      assert.deepEqual(await storedMembershipsOf(USERS.applicant), [], "no stored KAI membership: the administration is binding-derived");
      assert.equal(await globalRoleCountOf(USERS.applicant), 0);
      // (The applicant's kai.users mapping already exists: its sign-in landed on /impact-library.)
      const changed = changedTables(before, await allKaiCounts());
      assert.deepEqual(changed, ["audit_events", "gk_organization_bindings", "organizations"]);
      const applicantKai = await kaiUserOf(USERS.applicant);
      const siteKai = await kaiUserOf(USERS.site);
      const audits = await auditsForOrganization(newKai);
      assert.deepEqual(audits.map((a) => [a.action, a.actor_user_id, a.metadata.target_user_id, a.metadata.role_name, a.metadata.authority_source]), [
        ["initialize_kai_organization_for_approved_application", siteKai.user_id, applicantKai.user_id, "client_admin", "approved_organization_application"],
      ]);
      assert.doesNotMatch(JSON.stringify(audits), /@/, "no email in audit metadata");
      const notice = smtp.messages.find((message) => message.to.includes(email(USERS.applicant)));
      assert.ok(notice, "the applicant's approval email reached the loopback sink");
      assert.match(notice.data, /approved as an Organization Representative/);
      // The approver gained nothing in the organization.
      assert.deepEqual(await storedMembershipsOf(USERS.site), []);
      assert.deepEqual(await gkAdminMembershipsOf(USERS.site), []);
      assert.deepEqual(sitePage.exceptions, []);
      await signOut(sitePage);
      results.A2 = { response, newKai };
    });

    let applicantPage;
    await test("A3: the applicant signs in alone and administers the organization in KAI with zero Projects and no manual setup, holding no platform, Get Kinder staff or other-organization authority", async () => {
      applicantPage = await signIn(USERS.applicant);
      assert.equal(await applicantPage.pathname(), "/impact-library");
      assert.deepEqual(await authorizedOrganizationIds(applicantPage), [newKai]);
      const onboarding = (await applicantPage.fetchJson("GET", onboardingPath)).data;
      assert.deepEqual([onboarding.status, onboarding.kai_organization_id, onboarding.can_enable_kai], ["KAI_AVAILABLE", newKai, false]);
      const capabilities = await applicantPage.fetchJson("GET", capabilitiesPath(newKai));
      assert.equal(capabilities.status, 200);
      assert.equal(capabilities.data.organizationAccessManagement, true);
      assert.equal(capabilities.data.internalKnowledgeWorkspace, false, "no Get Kinder staff workspace");
      const projects = await applicantPage.fetchJson("GET", projectsPath(newKai));
      assert.deepEqual([projects.status, projects.data.items], [200, []], "zero Projects");
      assert.equal((await applicantPage.fetchJson("GET", contextPath)).data.platform_administration, false);
      await openImpactLibrary(applicantPage);
      const shell = await applicantPage.text();
      assert.match(shell, new RegExp(NEW_ORG_NAME));
      assert.doesNotMatch(shell, /KAI setup still needs to be completed|Complete KAI setup|Set up your organization/);
      await applicantPage.clickNav("Team & Access");
      await applicantPage.waitForText("Members");
      await applicantPage.idle();
      const body = await applicantPage.text();
      assert.match(body, new RegExp(`Team & Access for ${NEW_ORG_NAME}`));
      assert.doesNotMatch(body, /Platform administration|Add Get Kinder staff|Grant global role/);
      assert.match(await memberRowText(applicantPage, USERS.applicant), /Get Kinder organization admin/);
      assert.deepEqual(applicantPage.exceptions, []);
      results.A3 = { onboarding: onboarding.status, capabilities: capabilities.data.organizationAccessManagement };
    });

    await test("A4/A5: a new person requests to join; the applicant approves them in Team & Access and makes them a reviewer; the member signs in to the organization's KAI as that role", async () => {
      const joinerPage = await signIn(USERS.joiner);
      const search = await joinerPage.fetchJson("GET", `${INTAKE}/admin/organization-join/organizations?q=${encodeURIComponent("Tidepool")}`);
      assert.deepEqual(search.data.items.map((item) => item.organization_id), [newKai]);
      const request = await joinerPage.fetchJson("POST", `${INTAKE}/admin/organization-join/requests`, { organization_id: newKai });
      assert.ok([200, 201].includes(request.status), JSON.stringify(request.body));
      await signOut(joinerPage);

      await applicantPage.goto("/impact-library");
      await applicantPage.waitFor(() => applicantPage.visibleControl("Team & Access"), "Team & Access");
      await applicantPage.clickNav("Team & Access");
      await applicantPage.waitForText("Approve as contributor");
      let mark = applicantPage.mark();
      await applicantPage.clickButton("Approve as contributor");
      await applicantPage.waitFor(() => memberHasRoleBadge(applicantPage, USERS.joiner, "client_contributor"), "the new contributor");
      await applicantPage.idle();
      assert.equal(writes(applicantPage.requestsSince(mark)).length, 1);
      assert.deepEqual(await storedMembershipsOf(USERS.joiner), [{ organization_id: newKai, role_name: "client_contributor", membership_status: "active" }]);
      mark = applicantPage.mark();
      await applicantPage.setSelect(`() => document.getElementById("gk-team-access-role-legacy-${USERS.joiner}-client_contributor")`, "client_reviewer");
      await applicantPage.clickWhere("Save role", `() => [...document.querySelectorAll('[data-team-access-member="${rowKey(USERS.joiner)}"] button')]
        .find((el) => el.innerText.trim() === "Save role" && !el.disabled)`);
      await applicantPage.waitFor(() => memberHasRoleBadge(applicantPage, USERS.joiner, "client_reviewer"), "the promoted reviewer");
      await applicantPage.idle();
      assert.deepEqual(writes(applicantPage.requestsSince(mark)).map(([method, , status]) => [method, status]), [["PUT", 200]]);
      assert.deepEqual(await storedMembershipsOf(USERS.joiner), [{ organization_id: newKai, role_name: "client_reviewer", membership_status: "active" }]);
      const applicantKai = await kaiUserOf(USERS.applicant);
      const joinerKai = await kaiUserOf(USERS.joiner);
      const memberAudits = (await auditsForOrganization(newKai)).filter((a) => a.metadata.target_user_id === joinerKai.user_id || a.action.includes("join"));
      const byApplicant = memberAudits.filter((a) => a.actor_user_id === applicantKai.user_id);
      assert.ok(byApplicant.length >= 2, JSON.stringify(memberAudits.map((a) => a.action)));
      assert.ok(memberAudits.every((a) => [applicantKai.user_id, joinerKai.user_id].includes(a.actor_user_id)),
        "the join request is the joiner's own; every membership change is the applicant's");
      // The applicant's first real Project, through the existing creation path.
      const created = await applicantPage.fetchJson("POST", projectsPath(newKai), { engagement_code: "Tidepool First Project" });
      assert.equal(created.status, 201, JSON.stringify(created.body));

      const memberPage = await signIn(USERS.joiner);
      assert.deepEqual(await authorizedOrganizationIds(memberPage), [newKai]);
      const memberCapabilities = (await memberPage.fetchJson("GET", capabilitiesPath(newKai))).data;
      assert.equal(memberCapabilities.organizationAccessManagement, false, "a reviewer does not administer the team");
      assert.ok(JSON.stringify((await memberPage.fetchJson("GET", projectsPath(newKai))).data).includes("Tidepool First Project"));
      await openImpactLibrary(memberPage);
      assert.equal(await memberPage.visibleControl("Team & Access"), false);
      await signOut(memberPage);
      results.A4_A5 = { audits: memberAudits.map((a) => [a.action, a.actor_user_id === applicantKai.user_id ? "applicant" : "joiner"]) };
    });

    // =====================================================================
    // B. Role and tenant negatives
    // =====================================================================
    await test("B: the applicant has no site-admin, platform, Get Kinder staff or other-organization authority; pending and declined applicants get nothing; nothing is written", async () => {
      const before = await allKaiCounts();
      const joinerLegacy = USERS.joiner;
      const refusals = {
        admin: await applicantPage.goto("/admin"),
        applications: await applicantPage.goto("/admin/org-applications"),
        otherRoster: (await applicantPage.fetchJson("GET", rosterPath(EXISTING_KAI))).status,
        otherCapabilities: (await applicantPage.fetchJson("GET", capabilitiesPath(EXISTING_KAI))).status,
        otherProjects: (await applicantPage.fetchJson("GET", projectsPath(EXISTING_KAI))).status,
        gkRole: await applicantPage.fetchJson("POST", `${ACCESS}/organizations/${newKai}/memberships/${joinerLegacy}/roles`, { role_name: "gk_reviewer" }),
        staff: (await applicantPage.fetchJson("POST", `${ACCESS}/organizations/${newKai}/gk-staff`, { email: email(USERS.plain), role_name: "gk_operator" })).status,
        globalRole: await applicantPage.fetchJson("PUT", `${ACCESS}/global-roles/${joinerLegacy}`, { role_name: "gk_reviewer", action: "assign" }),
        selfGlobal: await applicantPage.fetchJson("PUT", `${ACCESS}/global-roles/${USERS.applicant}`, { role_name: "gk_admin", action: "assign" }),
        otherEnablement: (await applicantPage.fetchJson("POST", enablementPath(existingGk.id), {})).status,
      };
      assert.deepEqual([refusals.admin, refusals.applications], ["/", "/"]);
      assert.deepEqual([refusals.otherRoster, refusals.otherCapabilities, refusals.otherProjects], [403, 403, 403]);
      assert.equal(refusals.gkRole.status, 403);
      assert.equal(refusals.staff, 403);
      assert.deepEqual([refusals.globalRole.status, refusals.globalRole.blockingReason], [403, "platform_superuser_required"]);
      assert.deepEqual([refusals.selfGlobal.status, refusals.selfGlobal.blockingReason], [403, "platform_superuser_required"]);
      assert.equal(refusals.otherEnablement, 403, "KAI setup of another organization is refused");
      assert.deepEqual(changedTables(before, await allKaiCounts()), []);

      // Pending and declined applicants.
      const pendingPage = await signIn(USERS.pendingApplicant);
      await apply(pendingPage, "Kelpwood Pending Synthetic Society");
      const declinedPage = await signIn(USERS.declinedApplicant);
      await apply(declinedPage, "Saltmarsh Declined Synthetic Society");
      const sitePage = await signIn(USERS.site);
      const declinedApplication = await applicationOf(USERS.declinedApplicant);
      const declineBefore = await allKaiCounts();
      assert.deepEqual(await decide(sitePage, declinedApplication.id, "decline"), { success: true });
      assert.deepEqual(changedTables(declineBefore, await allKaiCounts()), [], "a decline writes nothing to KAI");
      await signOut(sitePage);
      for (const [page, status, name] of [[pendingPage, "PENDING", "Kelpwood Pending Synthetic Society"], [declinedPage, "DECLINED", "Saltmarsh Declined Synthetic Society"]]) {
        assert.equal((await page.fetchJson("GET", onboardingPath)).data.status, status);
        assert.deepEqual(await authorizedOrganizationIds(page), []);
        assert.deepEqual(await gkOrganizationsNamed(name), []);
        assert.equal((await page.fetchJson("GET", rosterPath(newKai))).status, 403);
        await openImpactLibrary(page);
        assert.equal(await page.visibleControl("Team & Access"), false);
        await signOut(page);
      }
      results.B = refusals;
    });

    await test("B (same name): an application under an existing bound organization's name is refused at approval; it creates no KAI organization or binding, changes none of its people, and gives the applicant nothing", async () => {
      const page = await signIn(USERS.sameNameApplicant);
      await apply(page, `  seabright   SYNTHETIC food bank `);
      await signOut(page);
      const sitePage = await signIn(USERS.site);
      const before = await allKaiCounts();
      const { id: applicationId } = await applicationOf(USERS.sameNameApplicant);
      const response = await sitePage.fetchJson("POST", `/admin/org-applications/${applicationId}/approve`);
      await signOut(sitePage);
      assert.deepEqual([response.status, response.body.success, response.body.error], [409, false, "organization_name_conflict"]);
      assert.equal((await applicationOf(USERS.sameNameApplicant)).status, "pending");
      assert.deepEqual(await gkOrganizationsNamed(EXISTING_ORG_NAME), [{ id: existingGk.id, rep_user_id: null, status: "approved" }], "no second organization");
      assert.deepEqual(await bindingsFor(existingGk.id), [{ kai_organization_id: EXISTING_KAI, status: "active" }]);
      assert.equal((await kaiOrganizationsFor(existingGk.id)).length, 0, "the pre-existing KAI organization is untouched (it was not created by enablement)");
      assert.deepEqual(changedTables(before, await allKaiCounts()).filter((table) => table !== "users"), [], "nothing written to KAI");
      assert.deepEqual(await storedMembershipsOf(USERS.existingMember), [{ organization_id: EXISTING_KAI, role_name: "client_contributor", membership_status: "active" }]);
      assert.deepEqual(await projectsOf(EXISTING_KAI), [{ engagement_id: EXISTING_PROJECT, engagement_code: "Seabright Existing Project" }]);
      assert.deepEqual(await gkAdminMembershipsOf(USERS.sameNameApplicant), [], "no Get Kinder membership");
      assert.equal(smtp.messages.some((message) => message.to.includes(email(USERS.sameNameApplicant)) && /approved as an Organization Representative/.test(message.data)), false);
      const sameNamePage = await signIn(USERS.sameNameApplicant);
      assert.deepEqual(await authorizedOrganizationIds(sameNamePage), []);
      assert.equal((await sameNamePage.fetchJson("GET", capabilitiesPath(EXISTING_KAI))).status, 403);
      await signOut(sameNamePage);
      results.B_same_name = { status: response.status, error: response.body.error };
    });

    // =====================================================================
    // C. Existing users and repeated operations
    // =====================================================================
    await test("C: the existing organization's administrator and member keep their access; a repeated approval writes nothing; manual KAI setup stays compatible", async () => {
      const existingAdminPage = await signIn(USERS.existingAdmin);
      assert.deepEqual(await authorizedOrganizationIds(existingAdminPage), [EXISTING_KAI]);
      assert.equal((await existingAdminPage.fetchJson("GET", capabilitiesPath(EXISTING_KAI))).data.organizationAccessManagement, true);
      await signOut(existingAdminPage);
      const existingMemberPage = await signIn(USERS.existingMember);
      assert.deepEqual(await authorizedOrganizationIds(existingMemberPage), [EXISTING_KAI]);
      await signOut(existingMemberPage);

      const sitePage = await signIn(USERS.site);
      const before = await allKaiCounts();
      const repeat = await sitePage.fetchJson("POST", `/admin/org-applications/${(await applicationOf(USERS.applicant)).id}/approve`);
      assert.equal(repeat.status, 400, "an approved application cannot be approved again");
      assert.deepEqual(changedTables(before, await allKaiCounts()), []);
      await signOut(sitePage);

      // The existing manual setup still works on an initialized organization
      // and duplicates nothing (it adds its own initial Project, as before).
      const enablementStatus = await applicantPage.fetchJson("GET", enablementPath(newGk.id));
      assert.deepEqual([enablementStatus.data.kai_enabled, enablementStatus.data.kai_organization_id], [true, newKai]);
      const manual = await applicantPage.fetchJson("POST", enablementPath(newGk.id), {});
      assert.deepEqual([manual.status, manual.data.kai_organization_id], [201, newKai]);
      assert.equal((await kaiOrganizationsFor(newGk.id)).length, 1);
      assert.equal((await bindingsFor(newGk.id)).length, 1);
      assert.equal(await globalRoleCountOf(USERS.applicant), 0, "KAI setup grants no global role");
      results.C = { repeat: repeat.status, manualSetupProjects: (await projectsOf(newKai)).map((p) => p.engagement_code) };
    });

    // =====================================================================
    // D. Failure, recovery and feature gate
    // =====================================================================
    await test("D (failure): an injected KAI initialization failure leaves the approval committed and truthfully reported as setup_incomplete with nothing partial; the applicant's existing setup action recovers it", async () => {
      const page = await signIn(USERS.failingApplicant);
      await apply(page, FAILING_ORG_NAME);
      const sitePage = await signIn(USERS.site);
      const before = await allKaiCounts();
      const response = await decide(sitePage, (await applicationOf(USERS.failingApplicant)).id, "approve");
      await signOut(sitePage);
      assert.deepEqual(response, { success: true, kai_organization: { status: "setup_incomplete" } });
      assert.equal((await applicationOf(USERS.failingApplicant)).status, "approved");
      const [failingGk] = await gkOrganizationsNamed(FAILING_ORG_NAME);
      assert.equal(failingGk.rep_user_id, USERS.failingApplicant);
      assert.deepEqual(await bindingsFor(failingGk.id), [], "no binding");
      assert.deepEqual(await kaiOrganizationsFor(failingGk.id), [], "no organization");
      assert.deepEqual(changedTables(before, await allKaiCounts()).filter((table) => table !== "users"), [], "nothing partial");
      assert.ok(smtp.messages.some((message) => message.to.includes(email(USERS.failingApplicant))), "the approval notification (it claims approval, not KAI readiness)");
      const onboarding = (await page.fetchJson("GET", onboardingPath)).data;
      assert.deepEqual([onboarding.status, onboarding.can_enable_kai, onboarding.gk_organization_id], ["APPROVED_NOT_KAI_ENABLED", true, failingGk.id]);
      assert.deepEqual(await authorizedOrganizationIds(page), []);
      // Recovery through the existing setup action, once the cause is gone.
      await query("DROP TRIGGER harness_fail_organization_insert ON kai.organizations");
      await openImpactLibrary(page);
      const mark = page.mark();
      await page.clickButton("Complete KAI setup");
      await page.waitFor(async () => (await authorizedOrganizationIds(page)).length === 1, "the recovered organization");
      await page.idle();
      assert.deepEqual(writes(page.requestsSince(mark)), [["POST", enablementPath(failingGk.id), 201]]);
      const [recovered] = await kaiOrganizationsFor(failingGk.id);
      assert.equal((await bindingsFor(failingGk.id)).length, 1);
      assert.equal((await page.fetchJson("GET", capabilitiesPath(recovered.organization_id))).data.organizationAccessManagement, true);
      await signOut(page);
      results.D_failure = { response, recoveredProjects: (await projectsOf(recovered.organization_id)).map((p) => p.engagement_code) };
    });

    await test("D (feature gate): with KAI Sprint 2 disabled the legacy approval still works and writes nothing to KAI", async () => {
      const page = await signIn(USERS.legacyApplicant);
      await apply(page, LEGACY_ORG_NAME);
      await signOut(page);
      legacyApp = await startRealApplication({ databaseUrl: RUNNER_DATABASE_URL, workdir: WORKDIR, name: "approval-org-admin-legacy",
        smtpPort: smtp.port, env: { KAI_SPRINT2_ENABLED: "false" } });
      const legacySite = await signIn(USERS.site, legacyApp.baseUrl);
      const before = await allKaiCounts();
      const response = await decide(legacySite, (await applicationOf(USERS.legacyApplicant)).id, "approve");
      assert.deepEqual(response, { success: true, kai_organization: { status: "not_enabled" } });
      assert.deepEqual(changedTables(before, await allKaiCounts()), [], "no KAI write");
      const [legacyGk] = await gkOrganizationsNamed(LEGACY_ORG_NAME);
      assert.equal(legacyGk.rep_user_id, USERS.legacyApplicant);
      assert.deepEqual(await gkAdminMembershipsOf(USERS.legacyApplicant), [{ org_id: legacyGk.id, role: "admin", is_active: true }]);
      contexts.splice(contexts.indexOf(legacySite), 1);
      await legacySite.close();
      results.D_gate = response;
    });

    await test("C (concurrency): three simultaneous initializations of the legacy-approved organization create exactly one KAI organization and binding; its applicant then administers it", async () => {
      // Service level, with the site admin's own public.userdata row as the
      // request user (the approval route's caller).
      const [siteRow] = await query("SELECT * FROM public.userdata WHERE id = $1", [USERS.site]);
      const [legacyGk] = await gkOrganizationsNamed(LEGACY_ORG_NAME);
      const applicationId = (await applicationOf(USERS.legacyApplicant)).id;
      const concurrent = await Promise.all([1, 2, 3].map(() => initializeKaiOrganizationForApprovedApplication(
        { req: { user: siteRow }, applicationId, gkOrganizationId: legacyGk.id }, { env: { KAI_SPRINT2_ENABLED: "true" } })));
      assert.ok(concurrent.every((r) => r.ok), JSON.stringify(concurrent));
      assert.deepEqual(concurrent.map((r) => r.data.outcome).sort(), ["created", "reused", "reused"]);
      const kaiOrganizations = await kaiOrganizationsFor(legacyGk.id);
      assert.equal(kaiOrganizations.length, 1);
      assert.equal((await bindingsFor(legacyGk.id)).length, 1);
      assert.ok(concurrent.every((r) => r.data.kai_organization_id === kaiOrganizations[0].organization_id));
      const page = await signIn(USERS.legacyApplicant);
      assert.deepEqual(await authorizedOrganizationIds(page), [kaiOrganizations[0].organization_id]);
      assert.equal((await page.fetchJson("GET", capabilitiesPath(kaiOrganizations[0].organization_id))).data.organizationAccessManagement, true);
      await signOut(page);
      results.C_concurrency = concurrent.map((r) => r.data.outcome).sort();
    });

    await test("C (no prior KAI sign-in): an account that has never signed in is approved, mapped by the initialization, and administers its organization on its first sign-in", async () => {
      assert.equal(await kaiUserOf(USERS.freshApplicant), null);
      // FIXTURE: the application row (its submission is proven in A1).
      const [application] = await query(`INSERT INTO public.org_applications (user_id, org_name, org_description, rep_role, status)
                                         VALUES ($1, $2, 'Synthetic organization for local acceptance.', 'Coordinator', 'pending') RETURNING id`,
        [USERS.freshApplicant, FRESH_ORG_NAME]);
      const sitePage = await signIn(USERS.site);
      const response = await decide(sitePage, application.id, "approve");
      await signOut(sitePage);
      assert.deepEqual(response, { success: true, kai_organization: { status: "ready", outcome: "created" } });
      const mapping = await kaiUserOf(USERS.freshApplicant);
      assert.equal(mapping?.status, "active", "mapped by the initialization (the same JIT mapping sign-in uses)");
      const [freshGk] = await gkOrganizationsNamed(FRESH_ORG_NAME);
      const [freshKai] = await kaiOrganizationsFor(freshGk.id);
      const audit = (await auditsForOrganization(freshKai.organization_id))[0];
      assert.equal(audit.metadata.target_user_id, mapping.user_id);
      const page = await signIn(USERS.freshApplicant);
      assert.equal(await page.pathname(), "/impact-library");
      assert.deepEqual(await authorizedOrganizationIds(page), [freshKai.organization_id]);
      assert.equal((await page.fetchJson("GET", capabilitiesPath(freshKai.organization_id))).data.organizationAccessManagement, true);
      assert.equal((await kaiUserOf(USERS.freshApplicant)).user_id, mapping.user_id, "sign-in reused the mapping");
      await signOut(page);
      results.C_fresh = "PASS";
    });

    // =====================================================================
    // C (revocation): removing the organization admin ends the authority,
    // and neither sign-in nor initialization restores it.
    // =====================================================================
    await test("C (revocation): after the applicant stops being the organization's Get Kinder admin, the next request, a new sign-in, a repeated initialization and KAI setup all leave them without the organization", async () => {
      // No application route removes a Get Kinder organization admin, so the
      // removal is out of band. Get Kinder derives organization admin from
      // two places (services/orgScopeService.js): an active
      // public.user_org_memberships admin row, and - as a legacy fallback -
      // public.userdata.org_id, which the approval also sets. Deactivating
      // the membership row alone therefore leaves the person an admin
      // (recorded; pre-existing behavior, not decided here).
      await query("UPDATE public.user_org_memberships SET is_active = false WHERE user_id = $1 AND org_id = $2", [USERS.applicant, newGk.id]);
      results.C_revocation_membership_row_only = await authorizedOrganizationIds(applicantPage);
      console.log(`[approval-org-admin] PRE-EXISTING after deactivating only the membership row: ${JSON.stringify(results.C_revocation_membership_row_only)}`);
      await query("UPDATE public.userdata SET org_id = NULL, org_rep = false WHERE id = $1", [USERS.applicant]);
      assert.deepEqual(await authorizedOrganizationIds(applicantPage), [], "the next request");
      assert.equal((await applicantPage.fetchJson("GET", rosterPath(newKai))).status, 403);
      await signOut(applicantPage);
      const again = await signIn(USERS.applicant);
      assert.deepEqual(await authorizedOrganizationIds(again), [], "a new sign-in");
      const before = await allKaiCounts();
      const [siteRow] = await query("SELECT * FROM public.userdata WHERE id = $1", [USERS.site]);
      const retry = await initializeKaiOrganizationForApprovedApplication(
        { req: { user: siteRow }, applicationId: (await applicationOf(USERS.applicant)).id, gkOrganizationId: newGk.id },
        { env: { KAI_SPRINT2_ENABLED: "true" } });
      assert.deepEqual([retry.ok, retry.error?.code], [false, "authorization_denied"], "initialization never restores a removed administrator");
      assert.equal((await again.fetchJson("POST", enablementPath(newGk.id), {})).status, 403);
      assert.deepEqual(changedTables(before, await allKaiCounts()), []);
      assert.deepEqual(await authorizedOrganizationIds(again), []);
      assert.deepEqual((await storedMembershipsOf(USERS.joiner)).map((m) => m.role_name), ["client_reviewer"], "the members the administrator added keep their roles");
      await signOut(again);
      results.C_revocation = "PASS";
    });
  } finally {
    console.log(`[approval-org-admin] results ${JSON.stringify(results)}`);
    for (const page of contexts.splice(0)) await page.close().catch(() => {});
    await browser.close();
    await app.stop();
    if (legacyApp) await legacyApp.stop();
    await smtp.close();
    await seedPool.end();
  }
}
