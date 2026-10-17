import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import {
  assertLoopbackDatabaseUrl,
  launchChrome,
  signIn as signInThroughLogin,
  signOut as signOutThroughLogout,
  startLoopbackSmtpSink,
  startRealApplication,
} from "./support/kaiRealApplicationBrowserHarness.js";

/**
 * Organization application Approve / Decline request integrity and decision
 * state, run only by
 *   node scripts/kai-client-knowledge-studio-browser-acceptance-local-postgres.js \
 *     __tests__/kai-organization-application-decision-security-browser-acceptance.integration.spec.js
 * against that runner's ephemeral loopback PostgreSQL. Skipped otherwise.
 *
 * The repository's own index.js runs as a loopback child process: every actor
 * signs in through the real /login form, and the Get Kinder site admin
 * decides on the real /admin/org-applications page. Forged requests come from
 * a loopback page served on another origin and opened in the signed-in site
 * admin's own browser context (the real session cookie, SameSite=Lax, not
 * Secure outside production):
 *   - same-site, cross-origin: http://127.0.0.1:<other port> (the browser
 *     sends the session cookie with a cross-origin POST);
 *   - cross-site: http://csrf-attacker.test:<other port>, mapped to loopback
 *     (the browser withholds the Lax cookie).
 * A second instance runs with KAI Sprint 2 disabled.
 *
 * Invariant: a decision changes state only for a genuine site-admin request
 * carrying its session's CSRF token, only while the application is pending,
 * and only once; a refused or losing decision writes and notifies nothing.
 *
 * FIXTURES (direct SQL, never the behavior under test): accounts with bcrypt
 * passwords (one is_admin site admin), the production-shaped Get Kinder
 * organization columns the approval writes, an existing bound organization
 * with its administrator, and pending applications exactly as POST /org-apply
 * inserts them for the forged-request targets. The legitimate journeys apply
 * through the real /org-apply form.
 */

const RUNNER_DATABASE_URL = process.env.KAI_CLIENT_BROWSER_ACCEPTANCE_DATABASE_URL;
const CHROME = process.env.KAI_CLIENT_BROWSER_ACCEPTANCE_CHROME;
const WORKDIR = process.env.KAI_CLIENT_BROWSER_ACCEPTANCE_WORKDIR;

test("organization application decision isolation: a non-loopback runner URL is refused", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
});

test("organization application decisions: both routes check the session CSRF token after site-admin authorization, and decline decides pending under the application row lock before writing or notifying", () => {
  const source = readFileSync(new URL("../routes/orgApplyApi.js", import.meta.url), "utf8");
  for (const action of ["approve", "decline"]) {
    assert.match(source, new RegExp(`orgApplyRouter\\.post\\("/admin/org-applications/:id/${action}", ensureAuthenticated, ensureAdmin, requireCsrfToken,`));
  }
  const decline = source.slice(source.indexOf('orgApplyRouter.post("/admin/org-applications/:id/decline"'));
  const order = ['await client.query("BEGIN");', "FOR UPDATE OF oa", '!== "pending"', "SET status = 'declined'", 'await client.query("COMMIT");', "sendNudgeEmail"]
    .map((needle) => decline.indexOf(needle));
  assert.ok(order.every((position, index) => position > 0 && (index === 0 || position > order[index - 1])),
    `BEGIN -> row lock -> pending check -> decline -> COMMIT -> notification: ${order}`);
  const page = source.slice(source.indexOf('orgApplyRouter.get("/admin/org-applications"'));
  assert.match(page.slice(0, page.indexOf("orgApplyRouter.post(")), /csrfToken: sessionCsrfToken\(req\),/,
    "the admin page renders its session's token (the router runs before index.js's token middleware)");
});

if (!RUNNER_DATABASE_URL || !CHROME || !WORKDIR) {
  test("organization application decision security requires its runner", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_DATABASE_URL);
  await runAcceptance();
}

// A page on another origin that submits a decision to the application with
// the visiting browser's own cookies, as a hostile site would.
async function startForgeryOrigin(appBaseUrl) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://forgery.invalid");
    const action = url.searchParams.get("action") === "decline" ? "decline" : "approve";
    const target = `${appBaseUrl}/admin/org-applications/${Number(url.searchParams.get("id"))}/${action}`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    if (url.pathname === "/form") {
      res.end(`<!doctype html><form id="forged" method="POST" action="${target}"><input type="hidden" name="note" value="forged"></form>
        <script>document.getElementById("forged").submit();</script>`);
    } else if (url.pathname === "/no-cors") {
      res.end(`<!doctype html><title>pending</title><script>
        fetch(${JSON.stringify(target)}, { method: "POST", mode: "no-cors", credentials: "include" })
          .then(() => { document.title = "sent"; }, () => { document.title = "failed"; });
      </script>`);
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { port: server.address().port, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

async function runAcceptance() {
  const { Pool } = await import("pg");
  const bcrypt = (await import("bcrypt")).default;
  const seedPool = new Pool({ connectionString: RUNNER_DATABASE_URL, ssl: false, max: 4 });
  const query = async (sql, params = []) => (await seedPool.query(sql, params)).rows;
  const { resolveOrgScopeForUserId } = await import("../services/orgScopeService.js");
  const { resolveEffectiveClientOrganizationMembershipsForLegacyUser } = await import("../Backend/kai/auth/gkOrganizationBindingAuthority.js");

  const PASSWORD = "Synthetic-Sign-In-2026!";
  const USERS = Object.freeze({
    site: 2701, // Get Kinder site admin (public.userdata.is_admin): decides
    plain: 2702, // an ordinary signed-in user
    boundAdmin: 2703, // the existing bound organization's administrator
    approvedApplicant: 2704, // legitimately approved on the page
    declinedApplicant: 2705, // legitimately declined on the page
    pendingDecline: 2706, // C1: pending -> declined
    approvedThenDeclined: 2707, // C3: approved, then an ordinary decline
    declinedThenApproved: 2708, // C4: declined, then an ordinary approval
    doubleDecline: 2709, // C6: two simultaneous declines
    legacyNew: 2710, // KAI disabled: legitimately approved
    legacyTakeover: 2711, // KAI disabled: applies under the bound organization's name
    legacyForged: 2712, // KAI disabled: token-less approve / decline target
  });
  const RACE_USERS = Object.freeze([2721, 2722, 2723, 2724]); // C5: simultaneous approve + decline
  const FORGED_USERS_START = 2740; // one applicant per forged request
  const email = (legacyId) => `decision-security-${legacyId}@harborlight.test`;
  const BOUND_ORG_NAME = "Tidewater Synthetic Food Pantry";
  const BOUND_KAI = "00000000-0000-4000-8000-0000000dec01";
  const ORG_NAME = (legacyId) => `Decision Security Synthetic Org ${legacyId}`;
  const INTAKE = "/api/kai/sprint2/intake";
  const organizationsPath = `${INTAKE}/admin/organizations`;
  const contextPath = "/api/kai/sprint2/access-administration/administration-context";
  const decisionPath = (applicationId, action) => `/admin/org-applications/${applicationId}/${action}`;
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
  const createUser = (legacyId, label) => query(
    `INSERT INTO public.userdata (id, email, firstname, lastname, password, email_verified, is_suspended, is_admin)
     VALUES ($1, $2, 'Synthetic', $3, $4, true, false, $5)`,
    [legacyId, email(legacyId), `Decision-Security ${label}`, passwordHash, legacyId === USERS.site]);
  for (const [key, legacyId] of Object.entries(USERS)) await createUser(legacyId, key);
  for (const legacyId of RACE_USERS) await createUser(legacyId, `race-${legacyId}`);
  // The existing bound organization exactly as an approval leaves it.
  const [boundGk] = await query(
    `INSERT INTO public.organizations (name, description, website, rep_user_id, rep_role, status, approved_at, approved_by)
     VALUES ($1, 'Existing synthetic organization.', 'https://existing.example.test', $2, 'Executive Director', 'approved', now(), 'earlier-approver')
     RETURNING id`, [BOUND_ORG_NAME, USERS.boundAdmin]);
  await query("UPDATE public.userdata SET org_rep = true, org_id = $1 WHERE id = $2", [boundGk.id, USERS.boundAdmin]);
  await query("INSERT INTO public.user_org_memberships (org_id, user_id, role, is_active) VALUES ($1, $2, 'admin', true)", [boundGk.id, USERS.boundAdmin]);
  await query("INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES ($1::uuid, $2, 'tidewater-synthetic')", [BOUND_KAI, BOUND_ORG_NAME]);
  await query("INSERT INTO kai.gk_organization_bindings (gk_organization_id, kai_organization_id, status) VALUES ($1, $2::uuid, 'active')", [boundGk.id, BOUND_KAI]);
  // A pending application exactly as POST /org-apply inserts it.
  let nextForgedUser = FORGED_USERS_START;
  async function pendingApplicationFixture() {
    const legacyId = nextForgedUser++;
    await createUser(legacyId, `forged-target-${legacyId}`);
    const [application] = await query(
      `INSERT INTO public.org_applications (user_id, org_name, org_description, org_website, rep_role, status)
       VALUES ($1, $2, 'Synthetic organization for local acceptance.', 'https://example.test', 'Executive Director', 'pending')
       RETURNING id, user_id, org_name`, [legacyId, ORG_NAME(legacyId)]);
    return application;
  }

  // --- database readers ----------------------------------------------------
  const applicationRow = async (applicationId) => (await query(
    "SELECT id, status, reviewed_at, reviewed_by FROM public.org_applications WHERE id = $1", [applicationId]))[0];
  const applicationOf = async (legacyId) => (await query(
    "SELECT id, status, org_name, reviewed_at, reviewed_by FROM public.org_applications WHERE user_id = $1 ORDER BY id DESC", [legacyId]))[0] || null;
  const gkOrganizationsNamed = async (name) => query(
    "SELECT id, rep_user_id, status FROM public.organizations WHERE lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) = lower($1) ORDER BY id", [name]);
  const gkMembershipsOf = async (legacyId) => query(
    "SELECT org_id, role, COALESCE(is_active, true) AS is_active FROM public.user_org_memberships WHERE user_id = $1 ORDER BY org_id", [legacyId]);
  const legacyFieldsOf = async (legacyId) => (await query("SELECT org_rep, org_id FROM public.userdata WHERE id = $1", [legacyId]))[0];
  const kaiOrganizationsFor = async (gkOrganizationId) => query(
    "SELECT organization_id::text, status::text FROM kai.organizations WHERE legacy_public_organization_id = $1 ORDER BY organization_id", [gkOrganizationId]);
  const bindingsFor = async (gkOrganizationId) => query(
    "SELECT kai_organization_id::text, status FROM kai.gk_organization_bindings WHERE gk_organization_id = $1 ORDER BY gk_organization_binding_id", [gkOrganizationId]);
  const projectsOf = async (kaiOrganizationId) => query(
    "SELECT engagement_id::text FROM kai.engagements WHERE organization_id = $1::uuid", [kaiOrganizationId]);
  const globalRoleCountOf = async (legacyId) => (await query(
    `SELECT count(*)::int AS count FROM kai.user_roles ur JOIN kai.users u ON u.user_id = ur.user_id
      WHERE u.legacy_public_userdata_id = $1 AND ur.active = true AND ur.revoked_at IS NULL`, [legacyId]))[0].count;
  const storedMembershipsOf = async (legacyId) => query(
    `SELECT m.organization_id::text, m.role_name FROM kai.organization_memberships m JOIN kai.users u ON u.user_id = m.user_id
      WHERE u.legacy_public_userdata_id = $1`, [legacyId]);
  async function allKaiCounts() {
    const counts = {};
    for (const { table_name: table } of await query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'kai' AND table_type = 'BASE TABLE' ORDER BY table_name",
    )) {
      counts[table] = (await query(`SELECT count(*)::int AS count FROM kai.${table}`))[0].count;
    }
    return counts;
  }
  // Sign-ins map kai.users identities; nothing else may change.
  const kaiWritesSince = async (before) => Object.entries(await allKaiCounts())
    .filter(([table, count]) => table !== "users" && count !== before[table]).map(([table]) => table).sort();
  async function resolvedAuthority(legacyId) {
    const scope = await resolveOrgScopeForUserId(legacyId, { includeOrgMembersForOrgRep: false });
    return {
      gkAdminOf: scope.memberships.filter((m) => m.role === "admin" && m.is_active !== false).map((m) => m.orgId).sort(),
      derivedClientAdminOf: (await resolveEffectiveClientOrganizationMembershipsForLegacyUser(legacyId))
        .filter((m) => m.role_name === "client_admin").map((m) => m.organization_id).sort(),
    };
  }
  const NO_AUTHORITY = Object.freeze({ gkAdminOf: [], derivedClientAdminOf: [] });
  // Everything a decision could change for one application and its applicant.
  async function decisionState(application) {
    return {
      application: await applicationRow(application.id),
      organizations: await gkOrganizationsNamed(application.org_name),
      legacyFields: await legacyFieldsOf(application.user_id),
      memberships: await gkMembershipsOf(application.user_id),
      authority: await resolvedAuthority(application.user_id),
      approvalNotifications: approvalNotificationsTo(application.user_id).length,
      declineNotifications: declineNotificationsTo(application.user_id).length,
    };
  }
  // The existing bound organization and its administrator.
  async function boundOrganizationState() {
    return {
      organization: await query("SELECT * FROM public.organizations WHERE id = $1", [boundGk.id]),
      admin: await legacyFieldsOf(USERS.boundAdmin),
      memberships: await query("SELECT user_id, role, COALESCE(is_active, true) AS is_active FROM public.user_org_memberships WHERE org_id = $1 ORDER BY user_id", [boundGk.id]),
      bindings: await bindingsFor(boundGk.id),
      authority: await resolvedAuthority(USERS.boundAdmin),
    };
  }

  // --- application, browser, sessions ---------------------------------------
  const smtp = await startLoopbackSmtpSink();
  const app = await startRealApplication({ databaseUrl: RUNNER_DATABASE_URL, workdir: WORKDIR, name: "decision-security", smtpPort: smtp.port });
  const { baseUrl } = app;
  const appOrigin = new URL(baseUrl).origin;
  const forgery = await startForgeryOrigin(baseUrl);
  const SAME_SITE_ORIGIN = `http://127.0.0.1:${forgery.port}`;
  const CROSS_SITE_ORIGIN = `http://csrf-attacker.test:${forgery.port}`;
  const browser = await launchChrome({ chrome: CHROME, workdir: WORKDIR, profileName: "decision-security", loopbackHostnames: ["csrf-attacker.test"] });
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
  const declineNotificationsTo = (legacyId) => notificationsTo(legacyId).filter((message) => /Update on your GetKinder organization application/.test(message.data));
  async function applyAs(legacyId, organizationName, url = baseUrl) {
    const page = await signIn(legacyId, url);
    assert.equal(await page.goto("/org-apply"), "/org-apply");
    await page.setInput("orgName", organizationName);
    await page.setInput("repRole", "Executive Director");
    await page.setInput("orgWebsite", "https://example.test");
    await page.setInput("orgDescription", "Synthetic organization for local acceptance.");
    await page.clickWhere("Submit Application", `() => document.querySelector("form[action='/org-apply'] button[type=submit]")`);
    await page.waitFor(async () => (await page.evaluate("location.search")).includes("submitted=true"), "application submitted");
    contexts.splice(contexts.indexOf(page), 1);
    await page.close();
    const application = await applicationOf(legacyId);
    return { id: application.id, user_id: legacyId, org_name: application.org_name };
  }
  // The real /admin/org-applications page: the site admin clicks the action
  // and waits for the page's own outcome (card removed, or its inline error).
  async function decideOnPage(page, applicationId, action) {
    assert.equal(await page.goto("/admin/org-applications"), "/admin/org-applications");
    await page.waitFor(() => page.evaluate(`Boolean(document.getElementById("app-card-${applicationId}"))`), `application card ${applicationId}`);
    const mark = page.mark();
    await page.clickWhere(`${action} ${applicationId}`,
      `() => document.querySelector('button.js-admin-action[data-id="${applicationId}"][data-action="${action}"]')`);
    await page.waitFor(() => page.evaluate(`(() => {
      const card = document.getElementById("app-card-${applicationId}");
      return !card || !card.querySelector(".app-inline-error").classList.contains("d-none");
    })()`), `${action} of ${applicationId} decided`);
    await page.idle();
    const decisions = page.requestsSince(mark).filter((r) => r.method === "POST");
    assert.deepEqual(decisions.map(pathOf), [decisionPath(applicationId, action)]);
    const cardText = await page.evaluate(`(() => { const card = document.getElementById("app-card-${applicationId}"); return card ? card.innerText : null; })()`);
    return { status: decisions[0].status, body: await page.responseJson(decisions[0]), cardText };
  }
  // The CSRF token the signed-in site admin's /admin/org-applications page renders for its session.
  const pageToken = (page) => page.evaluate(`(async () => {
    const html = await (await fetch("/admin/org-applications", { credentials: "same-origin" })).text();
    const match = html.match(/<meta name="csrf-token" content="([^"]*)">/);
    return match ? match[1] : null;
  })()`);
  // Decision requests from a signed-in page; headerToken undefined sends no X-CSRF-Token header.
  const postDecisions = (page, decisions, headerToken) => page.evaluate(`Promise.all(${JSON.stringify(decisions)}.map(async ({ id, action }) => {
    const headers = { "Content-Type": "application/json", Accept: "application/json" };
    ${headerToken === undefined ? "" : `headers["X-CSRF-Token"] = ${JSON.stringify(headerToken)};`}
    const response = await fetch("/admin/org-applications/" + id + "/" + action, { method: "POST", credentials: "same-origin", headers });
    return { id, action, status: response.status, redirected: response.redirected, finalPath: new URL(response.url).pathname,
      body: await response.json().catch(() => null) };
  }))`);
  // What the signed-in page itself sends: its rendered session token.
  const decideWithPageToken = async (page, decisions) => postDecisions(page, decisions, await pageToken(page));
  // A forged request from another origin, in the victim's own browser context.
  async function forge(victim, origin, mode, applicationId, action) {
    await victim.evaluate('location.href = "about:blank"').catch(() => {});
    await victim.waitFor(async () => (await victim.evaluate("location.href")) === "about:blank", "blank start");
    const mark = victim.mark();
    await victim.evaluate(`location.href = ${JSON.stringify(`${origin}/${mode}?action=${action}&id=${applicationId}`)}`).catch(() => {});
    if (mode === "form") {
      await victim.waitFor(async () => (await victim.evaluate("location.origin")) === appOrigin && (await victim.evaluate("document.readyState")) === "complete",
        `forged ${action} form from ${origin} delivered`);
      await victim.idle();
      return { finalPath: await victim.pathname(), text: (await victim.text()).slice(0, 200) };
    }
    await victim.waitFor(async () => ["sent", "failed"].includes(await victim.evaluate("document.title")), `forged ${action} fetch from ${origin} delivered`);
    await victim.idle();
    return { title: await victim.evaluate("document.title"),
      statuses: victim.requestsSince(mark).filter((r) => r.method === "POST").map((r) => [pathOf(r), r.status]) };
  }
  async function unauthenticatedPost(applicationId, action) {
    const response = await fetch(`${baseUrl}${decisionPath(applicationId, action)}`, { method: "POST", redirect: "manual",
      headers: { "Content-Type": "application/json" } });
    return { status: response.status, location: response.headers.get("location") };
  }
  const CSRF_REFUSAL = Object.freeze({ success: false, error: "invalid csrf token" });

  let sitePage = null;
  let victimPage = null;
  let plainPage = null;
  try {
    sitePage = await signIn(USERS.site);
    victimPage = await signIn(USERS.site); // the same site admin, a second independent session
    plainPage = await signIn(USERS.plain);
    const siteToken = await pageToken(sitePage);
    const otherSessionToken = await pageToken(victimPage);
    results.tokens = { siteTokenLength: siteToken?.length ?? null, otherSessionTokenLength: otherSessionToken?.length ?? null,
      distinct: siteToken !== otherSessionToken };
    console.log(`[decision-security] page tokens ${JSON.stringify(results.tokens)}`);

    // Each forged attempt: who sends it, and what a refusal looks like.
    const ATTEMPTS = [
      ["unauthenticated", (id, action) => unauthenticatedPost(id, action),
        (o) => assert.deepEqual([o.status, o.location], [302, "/login"])],
      ["ordinary signed-in user", async (id, action) => (await postDecisions(plainPage, [{ id, action }]))[0],
        (o) => assert.deepEqual([o.redirected, o.finalPath], [true, "/"], "ensureAdmin redirects")],
      ["site admin without a CSRF token", async (id, action) => (await postDecisions(sitePage, [{ id, action }]))[0],
        (o) => assert.deepEqual([o.status, o.body], [403, CSRF_REFUSAL])],
      ["site admin with an empty CSRF token", async (id, action) => (await postDecisions(sitePage, [{ id, action }], ""))[0],
        (o) => assert.deepEqual([o.status, o.body], [403, CSRF_REFUSAL])],
      ["site admin with a wrong CSRF token", async (id, action) => (await postDecisions(sitePage, [{ id, action }], "f".repeat(48)))[0],
        (o) => assert.deepEqual([o.status, o.body], [403, CSRF_REFUSAL])],
      ["site admin with another session's CSRF token", async (id, action) => (await postDecisions(sitePage, [{ id, action }], otherSessionToken))[0],
        (o) => assert.deepEqual([o.status, o.body], [403, CSRF_REFUSAL])],
      ["same-site cross-origin auto-submitted form", (id, action) => forge(victimPage, SAME_SITE_ORIGIN, "form", id, action),
        (o, id, action) => assert.deepEqual([o.finalPath, JSON.parse(o.text)], [decisionPath(id, action), CSRF_REFUSAL])],
      ["same-site cross-origin no-cors fetch", (id, action) => forge(victimPage, SAME_SITE_ORIGIN, "no-cors", id, action),
        (o, id, action) => assert.deepEqual(o.statuses, [[decisionPath(id, action), 403]])],
      ["cross-site auto-submitted form", (id, action) => forge(victimPage, CROSS_SITE_ORIGIN, "form", id, action),
        (o) => {
          assert.doesNotMatch(o.text, /"success":true/);
          assert.deepEqual([o.finalPath, /Log Out/.test(o.text)], ["/login", true], "no cookie, sign-in redirect; the forged request does not replace the victim's session");
        }],
      ["cross-site no-cors fetch", (id, action) => forge(victimPage, CROSS_SITE_ORIGIN, "no-cors", id, action),
        (o, id, action) => assert.deepEqual(o.statuses[0], [decisionPath(id, action), 302], "no session cookie: sign-in redirect")],
    ];

    // =====================================================================
    // A / B. Request integrity of approve and decline
    // =====================================================================
    for (const action of ["approve", "decline"]) {
      for (const [label, attempt, refusal] of ATTEMPTS) {
        await test(`${action === "approve" ? "A" : "B"}: ${label} cannot ${action} a pending application; nothing is written or notified`, async () => {
          const application = await pendingApplicationFixture();
          const before = { state: await decisionState(application), kai: await allKaiCounts(), bound: await boundOrganizationState() };
          const outcome = await attempt(application.id, action);
          const after = await decisionState(application);
          const key = `${action}: ${label}`;
          results[key] = { outcome, status: after.application.status, organizations: after.organizations.length,
            memberships: after.memberships.length, authority: after.authority,
            notifications: [after.approvalNotifications, after.declineNotifications], kaiWrites: await kaiWritesSince(before.kai) };
          console.log(`[decision-security] ${key} observed ${JSON.stringify(results[key])}`);

          assert.deepEqual(after, before.state, "application, organization, legacy fields, memberships, authority and notifications unchanged");
          assert.deepEqual(results[key].kaiWrites, [], "nothing written to KAI");
          assert.deepEqual(await boundOrganizationState(), before.bound, "the existing organization and its administrator unchanged");
          refusal(outcome, application.id, action);
        });
      }
    }

    await test("A: the legitimate site-admin Approve on the real page carries its session token and approves a new organization exactly once: Get Kinder admin, KAI organization and binding, no Project, no global role, one approval notification", async () => {
      assert.equal(siteToken?.length, 48, "the page renders the session's token");
      assert.ok(results.tokens.distinct, "each session has its own token");
      const application = await applyAs(USERS.approvedApplicant, ORG_NAME(USERS.approvedApplicant));
      const before = await allKaiCounts();
      const outcome = await decideOnPage(sitePage, application.id, "approve");
      results.legitimateApprove = { status: outcome.status, body: outcome.body };
      assert.deepEqual([outcome.status, outcome.body], [200, { success: true, kai_organization: { status: "ready", outcome: "created" } }]);
      assert.equal(outcome.cardText, null, "the card leaves the queue");
      const row = await applicationRow(application.id);
      assert.equal(row.status, "approved");
      assert.equal(row.reviewed_by, email(USERS.site));
      const [organization, ...duplicates] = await gkOrganizationsNamed(application.org_name);
      assert.deepEqual(duplicates, []);
      assert.deepEqual([organization.rep_user_id, organization.status], [USERS.approvedApplicant, "approved"]);
      assert.deepEqual(await legacyFieldsOf(USERS.approvedApplicant), { org_rep: true, org_id: organization.id });
      assert.deepEqual((await gkMembershipsOf(USERS.approvedApplicant)).map((m) => [m.org_id, m.role, m.is_active]), [[organization.id, "admin", true]]);
      const [kaiOrganization, ...extra] = await kaiOrganizationsFor(organization.id);
      assert.deepEqual(extra, []);
      assert.deepEqual(await bindingsFor(organization.id), [{ kai_organization_id: kaiOrganization.organization_id, status: "active" }]);
      assert.deepEqual(await projectsOf(kaiOrganization.organization_id), [], "no fabricated Project");
      assert.deepEqual(await kaiWritesSince(before), ["audit_events", "gk_organization_bindings", "organizations"]);
      assert.deepEqual(await resolvedAuthority(USERS.approvedApplicant), { gkAdminOf: [organization.id], derivedClientAdminOf: [kaiOrganization.organization_id] });
      assert.equal(await globalRoleCountOf(USERS.approvedApplicant), 0, "no global GK privilege");
      assert.deepEqual(await storedMembershipsOf(USERS.approvedApplicant), []);
      assert.deepEqual([approvalNotificationsTo(USERS.approvedApplicant).length, declineNotificationsTo(USERS.approvedApplicant).length], [1, 0]);
      // The applicant's own sign-in: their organization, nothing else.
      const page = await signIn(USERS.approvedApplicant);
      assert.deepEqual(((await page.fetchJson("GET", organizationsPath)).data?.items || []).map((item) => item.organization_id), [kaiOrganization.organization_id]);
      assert.equal((await page.fetchJson("GET", contextPath)).data.platform_administration, false);
      assert.equal(await page.goto("/admin/org-applications"), "/", "no site administration");
      await signOut(page);
      results.approvedOrganization = { gk: organization.id, kai: kaiOrganization.organization_id };
    });

    await test("B: the legitimate site-admin Decline on the real page carries its session token, declines once, grants nothing and sends one decline notification", async () => {
      const application = await applyAs(USERS.declinedApplicant, ORG_NAME(USERS.declinedApplicant));
      const before = await allKaiCounts();
      const outcome = await decideOnPage(sitePage, application.id, "decline");
      results.legitimateDecline = { status: outcome.status, body: outcome.body };
      assert.deepEqual([outcome.status, outcome.body], [200, { success: true }]);
      assert.equal(outcome.cardText, null);
      const row = await applicationRow(application.id);
      assert.deepEqual([row.status, row.reviewed_by], ["declined", email(USERS.site)]);
      assert.deepEqual(await gkOrganizationsNamed(application.org_name), []);
      assert.deepEqual(await gkMembershipsOf(USERS.declinedApplicant), []);
      assert.deepEqual(await resolvedAuthority(USERS.declinedApplicant), NO_AUTHORITY);
      assert.deepEqual(await kaiWritesSince(before), [], "a decline writes nothing to KAI");
      assert.deepEqual([approvalNotificationsTo(USERS.declinedApplicant).length, declineNotificationsTo(USERS.declinedApplicant).length], [0, 1]);
    });

    // =====================================================================
    // C. Decision state transitions (genuine site-admin requests with the page's token)
    // =====================================================================
    await test("C1/C2: pending -> declined succeeds once; declining it again is refused as not pending and changes nothing and notifies nobody", async () => {
      const application = await applyAs(USERS.pendingDecline, ORG_NAME(USERS.pendingDecline));
      const [first] = await decideWithPageToken(sitePage, [{ id: application.id, action: "decline" }]);
      assert.deepEqual([first.status, first.body], [200, { success: true }]);
      const declined = await decisionState(application);
      assert.equal(declined.application.status, "declined");
      assert.equal(declined.declineNotifications, 1);
      const [again] = await decideWithPageToken(sitePage, [{ id: application.id, action: "decline" }]);
      results.C2 = { status: again.status, body: again.body, state: await decisionState(application) };
      console.log(`[decision-security] C2 observed ${JSON.stringify(results.C2)}`);
      assert.deepEqual([again.status, again.body], [400, { success: false, error: "application not pending" }]);
      assert.deepEqual(results.C2.state, declined, "reviewed_at / reviewed_by unchanged; no second notification");
    });

    await test("C3: an approved application cannot be declined by the ordinary decline; its organization, administrator, binding and KAI administration stay; no contradictory notification", async () => {
      const application = await applyAs(USERS.approvedThenDeclined, ORG_NAME(USERS.approvedThenDeclined));
      const [approved] = await decideWithPageToken(sitePage, [{ id: application.id, action: "approve" }]);
      assert.equal(approved.status, 200);
      const [organization] = await gkOrganizationsNamed(application.org_name);
      const before = { state: await decisionState(application), bindings: await bindingsFor(organization.id), kai: await allKaiCounts() };
      assert.equal(before.state.authority.derivedClientAdminOf.length, 1);
      const [decline] = await decideWithPageToken(sitePage, [{ id: application.id, action: "decline" }]);
      results.C3 = { status: decline.status, body: decline.body, state: await decisionState(application) };
      console.log(`[decision-security] C3 observed ${JSON.stringify(results.C3)}`);
      assert.deepEqual([decline.status, decline.body], [400, { success: false, error: "application not pending" }]);
      assert.deepEqual(results.C3.state, before.state, "still approved; organization, legacy fields, membership and authority intact; no decline notification");
      assert.deepEqual(await bindingsFor(organization.id), before.bindings);
      assert.deepEqual(await kaiWritesSince(before.kai), []);
    });

    await test("C4: a declined application cannot be approved by the ordinary approval; nothing is created or notified", async () => {
      const application = await applyAs(USERS.declinedThenApproved, ORG_NAME(USERS.declinedThenApproved));
      const [declined] = await decideWithPageToken(sitePage, [{ id: application.id, action: "decline" }]);
      assert.equal(declined.status, 200);
      const before = { state: await decisionState(application), kai: await allKaiCounts() };
      const [approve] = await decideWithPageToken(sitePage, [{ id: application.id, action: "approve" }]);
      results.C4 = { status: approve.status, body: approve.body };
      assert.deepEqual([approve.status, approve.body], [400, { success: false, error: "application not pending" }]);
      assert.deepEqual(await decisionState(application), before.state);
      assert.deepEqual(before.state.organizations, []);
      assert.deepEqual(await kaiWritesSince(before.kai), []);
    });

    await test("C5: simultaneous approval and decline of the same pending application commit exactly one decision; the loser is refused; only the winner's side effects and notification occur", async () => {
      results.C5 = [];
      for (const [roundIndex, legacyId] of RACE_USERS.entries()) {
        const application = await applyAs(legacyId, ORG_NAME(legacyId));
        const before = await allKaiCounts();
        // Alternate which request is sent first, so either decision can win.
        const actions = roundIndex % 2 === 0 ? ["approve", "decline"] : ["decline", "approve"];
        const outcomes = await decideWithPageToken(sitePage, actions.map((action) => ({ id: application.id, action })));
        const state = await decisionState(application);
        const round = { outcomes: outcomes.map((o) => [o.action, o.status, o.body?.error ?? null]), status: state.application.status,
          organizations: state.organizations.length, authority: state.authority, notifications: [state.approvalNotifications, state.declineNotifications],
          kaiWrites: await kaiWritesSince(before) };
        results.C5.push(round);
        console.log(`[decision-security] C5 round observed ${JSON.stringify(round)}`);

        const winners = outcomes.filter((o) => o.status === 200);
        const losers = outcomes.filter((o) => o.status !== 200);
        assert.equal(winners.length, 1, "exactly one decision commits");
        assert.deepEqual(losers.map((o) => [o.status, o.body]), [[400, { success: false, error: "application not pending" }]], "the loser is safely refused");
        if (winners[0].action === "approve") {
          assert.equal(state.application.status, "approved");
          assert.equal(state.organizations.length, 1);
          assert.deepEqual(state.memberships.map((m) => [m.org_id, m.role]), [[state.organizations[0].id, "admin"]]);
          assert.equal(state.authority.derivedClientAdminOf.length, 1);
          assert.deepEqual([state.approvalNotifications, state.declineNotifications], [1, 0]);
          assert.deepEqual(round.kaiWrites, ["audit_events", "gk_organization_bindings", "organizations"]);
        } else {
          assert.equal(state.application.status, "declined");
          assert.deepEqual([state.organizations, state.memberships, state.authority], [[], [], NO_AUTHORITY]);
          assert.deepEqual([state.approvalNotifications, state.declineNotifications], [0, 1]);
          assert.deepEqual(round.kaiWrites, []);
        }
      }
    });

    await test("C6: two simultaneous declines of the same pending application decline it once; the other is refused; one notification", async () => {
      const application = await applyAs(USERS.doubleDecline, ORG_NAME(USERS.doubleDecline));
      const outcomes = await decideWithPageToken(sitePage, [{ id: application.id, action: "decline" }, { id: application.id, action: "decline" }]);
      const state = await decisionState(application);
      results.C6 = { outcomes: outcomes.map((o) => [o.status, o.body?.error ?? null]), status: state.application.status,
        notifications: state.declineNotifications };
      console.log(`[decision-security] C6 observed ${JSON.stringify(results.C6)}`);
      assert.deepEqual(outcomes.map((o) => o.status).sort(), [200, 400]);
      assert.equal(outcomes.find((o) => o.status === 400).body.error, "application not pending");
      assert.equal(state.application.status, "declined");
      assert.equal(state.declineNotifications, 1);
    });

    await test("the existing bound organization and its administrator are unchanged by every decision above", async () => {
      const state = await boundOrganizationState();
      assert.deepEqual(state.authority, { gkAdminOf: [boundGk.id], derivedClientAdminOf: [BOUND_KAI] });
      assert.deepEqual(state.memberships, [{ user_id: USERS.boundAdmin, role: "admin", is_active: true }]);
      assert.deepEqual(state.bindings, [{ kai_organization_id: BOUND_KAI, status: "active" }]);
    });

    // =====================================================================
    // D. KAI Sprint 2 disabled
    // =====================================================================
    await test("D: with KAI Sprint 2 disabled, token-less approve and decline are refused, the name-takeover guard still refuses, a legitimate approval works with zero KAI writes, and an approved application cannot be declined", async () => {
      const legacyNew = await applyAs(USERS.legacyNew, ORG_NAME(USERS.legacyNew));
      const legacyTakeover = await applyAs(USERS.legacyTakeover, BOUND_ORG_NAME);
      const forgedTarget = await applyAs(USERS.legacyForged, ORG_NAME(USERS.legacyForged));
      legacyApp = await startRealApplication({ databaseUrl: RUNNER_DATABASE_URL, workdir: WORKDIR, name: "decision-security-legacy",
        smtpPort: smtp.port, env: { KAI_SPRINT2_ENABLED: "false" } });
      const legacySite = await signIn(USERS.site, legacyApp.baseUrl);
      const before = { kai: await allKaiCounts(), bound: await boundOrganizationState(), forged: await decisionState(forgedTarget) };

      const forged = await postDecisions(legacySite, [{ id: forgedTarget.id, action: "approve" }, { id: forgedTarget.id, action: "decline" }]);
      const takeover = await decideWithPageToken(legacySite, [{ id: legacyTakeover.id, action: "approve" }]);
      const approved = await decideOnPage(legacySite, legacyNew.id, "approve");
      const declineApproved = await decideWithPageToken(legacySite, [{ id: legacyNew.id, action: "decline" }]);
      results.D = { forged: forged.map((o) => [o.action, o.status, o.body]), takeover: [takeover[0].status, takeover[0].body?.error],
        approved: [approved.status, approved.body], declineApproved: [declineApproved[0].status, declineApproved[0].body?.error] };
      console.log(`[decision-security] D observed ${JSON.stringify(results.D)}`);

      assert.deepEqual(forged.map((o) => [o.status, o.body]), [[403, CSRF_REFUSAL], [403, CSRF_REFUSAL]]);
      assert.deepEqual(await decisionState(forgedTarget), before.forged);
      assert.deepEqual(results.D.takeover, [409, "organization_name_conflict"]);
      assert.equal((await applicationOf(USERS.legacyTakeover)).status, "pending");
      assert.deepEqual(await resolvedAuthority(USERS.legacyTakeover), NO_AUTHORITY);
      assert.deepEqual(await boundOrganizationState(), before.bound);
      assert.deepEqual(results.D.approved, [200, { success: true, kai_organization: { status: "not_enabled" } }]);
      const [legacyGk] = await gkOrganizationsNamed(legacyNew.org_name);
      assert.deepEqual((await gkMembershipsOf(USERS.legacyNew)).map((m) => [m.org_id, m.role]), [[legacyGk.id, "admin"]]);
      assert.deepEqual(results.D.declineApproved, [400, "application not pending"]);
      assert.equal((await applicationOf(USERS.legacyNew)).status, "approved");
      assert.deepEqual([approvalNotificationsTo(USERS.legacyNew).length, declineNotificationsTo(USERS.legacyNew).length], [1, 0]);
      assert.deepEqual(await kaiWritesSince(before.kai), [], "no KAI write with Sprint 2 disabled");
      contexts.splice(contexts.indexOf(legacySite), 1);
      await legacySite.close();
    });
  } finally {
    console.log(`[decision-security] results ${JSON.stringify(results)}`);
    for (const page of contexts.splice(0)) await page.close().catch(() => {});
    await browser.close();
    await app.stop();
    if (legacyApp) await legacyApp.stop();
    await forgery.close();
    await smtp.close();
    await seedPool.end();
  }
}
