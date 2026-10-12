import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Browser acceptance of Impact Library Team & Access, run only by
 * scripts/kai-client-knowledge-studio-browser-acceptance-local-postgres.js
 * against its ephemeral loopback PostgreSQL. Skipped otherwise.
 *
 * Real: the Get Kinder organization-admin -> active KAI binding derivation,
 * stored memberships, resolveKaiActorContext, the access-capabilities read,
 * the access-administration router and services (roster, role change, JOIN-3
 * approval), every audit write, the built frontend bundle, and a real
 * headless Chrome driven over the DevTools protocol.
 * Simulated: only the Get Kinder session login (req.user from a harness
 * cookie on this loopback app, as the route tests set req.user).
 */

const RUNNER_DATABASE_URL = process.env.KAI_CLIENT_BROWSER_ACCEPTANCE_DATABASE_URL;
const CHROME = process.env.KAI_CLIENT_BROWSER_ACCEPTANCE_CHROME;
const WORKDIR = process.env.KAI_CLIENT_BROWSER_ACCEPTANCE_WORKDIR;

function assertLoopbackDatabaseUrl(urlString) {
  const host = new URL(urlString).hostname.toLowerCase();
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error(`browser acceptance refused a non-loopback database URL host: ${host}`);
  }
}

test("browser acceptance isolation: a non-loopback runner URL is refused", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
});

if (!RUNNER_DATABASE_URL || !CHROME || !WORKDIR) {
  test("Team & Access browser acceptance requires its runner", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_DATABASE_URL);
  await runBrowserAcceptance();
}

// ---------------------------------------------------------------------------
// Minimal Chrome DevTools protocol client (Node's built-in WebSocket).
// ---------------------------------------------------------------------------

async function launchChrome() {
  const profileDir = join(WORKDIR, "chrome-profile-team-access");
  mkdirSync(profileDir, { recursive: true });
  const child = spawn(CHROME, [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--disable-extensions",
    "--disable-background-networking",
    "about:blank",
  ], { stdio: "ignore" });
  const portFile = join(profileDir, "DevToolsActivePort");
  for (let attempt = 0; attempt < 100 && !existsSync(portFile); attempt += 1) await new Promise((r) => setTimeout(r, 100));
  const [port] = readFileSync(portFile, "utf8").split("\n");
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  const listeners = new Set();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(`${message.error.message}`));
      else resolve(message.result);
      return;
    }
    for (const listener of listeners) listener(message);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return {
    send,
    listeners,
    async close() {
      try { await send("Browser.close"); } catch { /* already closing */ }
      socket.close();
      child.kill("SIGKILL");
    },
  };
}

async function openPage(browser, { baseUrl, legacyUserId, width = 1440, height = 900 }) {
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const requests = [];
  const byId = new Map();
  const exceptions = [];
  const listener = (message) => {
    if (message.sessionId !== sessionId) return;
    const { method, params } = message;
    if (method === "Network.requestWillBeSent" && params.type !== "Document" && params.request.url.includes("/api/")) {
      const entry = { url: params.request.url, method: params.request.method, status: null, done: false };
      byId.set(params.requestId, entry);
      requests.push(entry);
    } else if (method === "Network.responseReceived" && byId.has(params.requestId)) {
      byId.get(params.requestId).status = params.response.status;
    } else if ((method === "Network.loadingFinished" || method === "Network.loadingFailed") && byId.has(params.requestId)) {
      byId.get(params.requestId).done = true;
    } else if (method === "Runtime.exceptionThrown") {
      exceptions.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text);
    }
  };
  browser.listeners.add(listener);
  for (const domain of ["Page", "Network", "Runtime"]) await browser.send(`${domain}.enable`, {}, sessionId);
  await browser.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 768 }, sessionId);
  await browser.send("Network.setCookie", { name: "kai_harness_user", value: String(legacyUserId), url: baseUrl }, sessionId);

  const evaluate = async (expression) => {
    const result = await browser.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (result.exceptionDetails) throw new Error(`evaluate failed: ${result.exceptionDetails.text} ${expression.slice(0, 160)}`);
    return result.result.value;
  };
  const text = () => evaluate("document.body ? document.body.innerText : ''");
  const idle = async () => {
    let quietSince = Date.now();
    for (let i = 0; i < 300; i += 1) {
      await new Promise((r) => setTimeout(r, 50));
      if (requests.some((request) => !request.done)) quietSince = Date.now();
      else if (Date.now() - quietSince > 400) return;
    }
    throw new Error("network never went idle");
  };
  const waitFor = async (label, predicateExpression, { timeout = 15000 } = {}) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await evaluate(predicateExpression)) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`timed out waiting for ${label}\n--- page ---\n${(await text()).slice(0, 3000)}`);
  };
  const waitForText = (needle, options) => waitFor(`text: ${needle}`, `document.body && document.body.innerText.includes(${JSON.stringify(needle)})`, options);
  const clickWhere = async (label, finderExpression) => {
    const clicked = await evaluate(`(() => { const el = (${finderExpression})(); if (!el) return false; el.click(); return true; })()`);
    if (!clicked) throw new Error(`no visible control: ${label}\n--- page ---\n${(await text()).slice(0, 2500)}`);
    await idle();
  };
  const visibleControls = (selector) => `[...document.querySelectorAll(${JSON.stringify(selector)})].filter((el) => el.offsetParent !== null)`;
  return {
    requests: () => [...requests],
    mark: () => requests.length,
    requestsSince: (mark) => requests.slice(mark),
    exceptions,
    evaluate,
    text,
    idle,
    waitFor,
    waitForText,
    clickWhere,
    navLabels: () => evaluate(`${visibleControls(".gk-shell-nav-group .gk-shell-nav-item")}.map((el) => el.innerText.trim())`),
    clickNav: (label) => clickWhere(`nav ${label}`, `() => ${visibleControls(".gk-shell-nav-group .gk-shell-nav-item")}.find((el) => el.innerText.trim() === ${JSON.stringify(label)})`),
    hasOrgMenuButton: () => evaluate(`Boolean(document.querySelector(".gk-shell-org-switcher-btn"))`),
    async orgMenuItems() {
      if (!(await this.hasOrgMenuButton())) return null;
      await clickWhere("organization menu", `() => document.querySelector(".gk-shell-org-switcher-btn")`);
      const items = await evaluate(`[...document.querySelectorAll(".gk-shell-org-switcher-menu button")].map((el) => el.innerText.trim())`);
      await clickWhere("organization menu (close)", `() => document.querySelector(".gk-shell-org-switcher-btn")`);
      return items;
    },
    async orgMenuChoose(label) {
      await clickWhere("organization menu", `() => document.querySelector(".gk-shell-org-switcher-btn")`);
      await clickWhere(`organization menu ${label}`, `() => [...document.querySelectorAll(".gk-shell-org-switcher-menu button")].find((el) => el.innerText.trim() === ${JSON.stringify(label)})`);
    },
    memberRow: (legacyId) => evaluate(`(() => {
      const el = document.querySelector('[data-team-access-member="legacy:${legacyId}"]');
      if (!el) return null;
      const select = el.querySelector("select");
      return { text: el.innerText, role: select ? select.value : null, buttons: [...el.querySelectorAll("button")].map((b) => ({ label: b.innerText.trim(), disabled: b.disabled })) };
    })()`),
    async setMemberRole(legacyId, roleName) {
      const ok = await evaluate(`(() => {
        const el = document.querySelector('[data-team-access-member="legacy:${legacyId}"] select');
        if (!el) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
        setter.call(el, ${JSON.stringify(roleName)});
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      })()`);
      assert.ok(ok, `role select for ${legacyId}`);
    },
    clickMemberButton: (legacyId, label) => clickWhere(`member ${legacyId} ${label}`,
      `() => [...document.querySelectorAll('[data-team-access-member="legacy:${legacyId}"] button')].find((el) => el.innerText.trim() === ${JSON.stringify(label)} && !el.disabled)`),
    clickButton: (label) => clickWhere(`button ${label}`, `() => ${visibleControls("button")}.find((el) => el.innerText.trim() === ${JSON.stringify(label)} && !el.disabled)`),
    async goto(path) {
      await browser.send("Page.navigate", { url: `${baseUrl}${path}` }, sessionId);
      await idle();
    },
    async close() {
      browser.listeners.delete(listener);
      await browser.send("Target.closeTarget", { targetId });
    },
  };
}

// ---------------------------------------------------------------------------
// Acceptance
// ---------------------------------------------------------------------------

async function runBrowserAcceptance() {
  const { Pool } = await import("pg");
  const express = (await import("express")).default;
  const seedPool = new Pool({ connectionString: RUNNER_DATABASE_URL, ssl: false, max: 4 });

  const { findOrCreateKaiUserByLegacyPublicUserdataId } = await import("../Backend/kai/db/kaiQueries.js");
  const sprint2IntakeApiRouter = (await import("../Backend/kai/routes/sprint2IntakeApi.js")).default;
  const kaiAccessAdministrationApiRouter = (await import("../Backend/kai/routes/kaiAccessAdministrationApi.js")).default;
  const { requireKaiSprint2Enabled } = await import("../Backend/kai/config/kaiSprint2Config.js");
  const { requireKaiSprint2Authenticated } = await import("../Backend/kai/middleware/kaiSprint2Authentication.js");

  const ORG_A = "00000000-0000-4000-8000-0000000a7001";
  const ORG_B = "00000000-0000-4000-8000-0000000b7002";
  const ORG_A_NAME = "Tidewater Synthetic Collective";
  const ORG_B_NAME = "Larchmont Synthetic Trust";
  const USERS = Object.freeze({
    legacyAdmin: 801, // Get Kinder organization admin of Org A's bound GK organization; stored contributor of Org B
    storedAdmin: 802, // stored client_admin of Org A only
    reviewer: 803, // stored client_reviewer of Org A (promoted in case 1)
    contributor: 804, // stored client_contributor of Org A
    requester: 805, // pending join request to Org A
    foreignAdmin: 806, // stored client_admin of Org B
    reviewerStays: 807, // stored client_reviewer of Org A (never changed)
  });
  const email = (legacyId) => `user${legacyId}@tidewater.test`;
  const query = async (sql, params = []) => (await seedPool.query(sql, params)).rows;

  // --- organizations, GK binding, users, memberships, join request --------
  for (const [organizationId, name, code] of [[ORG_A, ORG_A_NAME, "tidewater-synthetic"], [ORG_B, ORG_B_NAME, "larchmont-synthetic"]]) {
    await query("INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES ($1::uuid, $2, $3)", [organizationId, name, code]);
  }
  // A bound organization's display profile reads public.organizations
  // (name, logo_url); logo_url is the production column the GK-binding
  // runner's synthetic mirror also declares.
  await query("ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS logo_url text");
  const [gkOrganization] = await query("INSERT INTO public.organizations (name, status) VALUES ($1, 'approved') RETURNING id", [ORG_A_NAME]);
  await query("INSERT INTO kai.gk_organization_bindings (gk_organization_id, kai_organization_id, status) VALUES ($1, $2::uuid, 'active')", [gkOrganization.id, ORG_A]);
  const kaiUserIds = {};
  for (const legacyId of Object.values(USERS)) {
    await query("INSERT INTO public.userdata (id) VALUES ($1) ON CONFLICT DO NOTHING", [legacyId]);
    const kaiUser = await findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: legacyId, email: email(legacyId) });
    kaiUserIds[legacyId] = kaiUser.user_id;
  }
  await query("INSERT INTO public.user_org_memberships (org_id, user_id, role, is_active) VALUES ($1, $2, 'admin', true)", [gkOrganization.id, USERS.legacyAdmin]);
  for (const [legacyId, organizationId, role] of [
    [USERS.legacyAdmin, ORG_B, "client_contributor"],
    [USERS.storedAdmin, ORG_A, "client_admin"],
    [USERS.reviewer, ORG_A, "client_reviewer"],
    [USERS.contributor, ORG_A, "client_contributor"],
    [USERS.foreignAdmin, ORG_B, "client_admin"],
    [USERS.reviewerStays, ORG_A, "client_reviewer"],
  ]) {
    await query("INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status) VALUES ($1::uuid, $2::uuid, $3, 'active')",
      [organizationId, kaiUserIds[legacyId], role]);
  }
  const [joinRequest] = await query(
    "INSERT INTO kai.organization_join_requests (organization_id, requester_user_id) VALUES ($1::uuid, $2::uuid) RETURNING organization_join_request_id",
    [ORG_A, kaiUserIds[USERS.requester]],
  );

  const membershipsOf = async (organizationId) => Object.fromEntries((await query(
    `SELECT u.legacy_public_userdata_id AS legacy, om.role_name, om.membership_status FROM kai.organization_memberships om
       JOIN kai.users u ON u.user_id = om.user_id WHERE om.organization_id = $1::uuid ORDER BY 1`, [organizationId],
  )).map((row) => [row.legacy, `${row.role_name}/${row.membership_status}`]));
  const auditCount = async () => Number((await query("SELECT count(*)::int AS n FROM kai.audit_events"))[0].n);
  const globalRoleCount = async () => Number((await query("SELECT count(*)::int AS n FROM kai.user_roles"))[0].n);
  const INITIAL_ORG_B = await membershipsOf(ORG_B);

  // --- harness app ---------------------------------------------------------
  const publicDir = new URL("../public/", import.meta.url).pathname;
  const pageShell = (title, rootId, script) => `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${title}</title>
    <link rel="stylesheet" href="/css/style.css" /><link rel="stylesheet" href="/css/gk-design-tokens.css" /></head>
    <body><div id="${rootId}"></div><script src="/js/bundles/entry.js"></script><script>${script}</script></body></html>`;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const match = /(?:^|;\s*)kai_harness_user=(\d+)/.exec(req.headers.cookie || "");
    if (match) req.user = { id: Number(match[1]), email: email(match[1]) };
    req.isAuthenticated = () => Boolean(req.user);
    next();
  });
  app.use("/api/kai/sprint2/intake", requireKaiSprint2Enabled, requireKaiSprint2Authenticated, sprint2IntakeApiRouter);
  app.use("/api/kai/sprint2/access-administration", requireKaiSprint2Enabled, requireKaiSprint2Authenticated, kaiAccessAdministrationApiRouter);
  app.get("/impact-library", (_req, res) => res.send(pageShell("Impact Library", "impact-evidence-library-root", "window.renderImpactEvidenceLibrary();")));
  app.use(express.static(publicDir));
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchChrome();

  const accessPath = (organizationId) => `/api/kai/sprint2/access-administration/organizations/${organizationId}/access`;
  const membershipPath = (organizationId, legacyId) => `/api/kai/sprint2/access-administration/organizations/${organizationId}/memberships/${legacyId}`;
  const FIVE = ["Home", "Knowledge Studio", "Impact Library", "Improvement Plan", "Projects"];

  // Every request the Team & Access UI may make is an existing client-safe
  // or access-administration route; never /admin or global-role assignment.
  function assertNoAdminDashboardOrGlobalRoleRequests(page, label) {
    for (const request of page.requests()) {
      const { pathname } = new URL(request.url);
      assert.doesNotMatch(pathname, /^\/api\/admin|\/global-roles\//, `${label}: ${request.method} ${pathname}`);
    }
  }

  async function probe(page, organizationId, targetLegacyId) {
    return page.evaluate(`(async () => {
      const read = await fetch(${JSON.stringify(accessPath(organizationId))}, { credentials: "same-origin" });
      const write = await fetch(${JSON.stringify(membershipPath(organizationId, targetLegacyId))}, {
        method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role_name: "client_admin", membership_status: "active" }),
      });
      return { read: read.status, readBody: await read.text(), write: write.status };
    })()`);
  }

  try {
    await test("browser (contributor, reviewer): no Team & Access entry point, and direct reads and writes are refused", async () => {
      const auditsBefore = await auditCount();
      for (const legacyId of [USERS.contributor, USERS.reviewerStays]) {
        const page = await openPage(browser, { baseUrl, legacyUserId: legacyId });
        try {
          await page.goto("/impact-library");
          await page.waitForText("Knowledge Studio");
          await page.idle();
          assert.deepEqual(await page.navLabels(), FIVE, `${legacyId}: five sections, no Team & Access`);
          assert.equal(await page.hasOrgMenuButton(), false, `${legacyId}: single organization and no management entry, so no organization menu`);
          assert.ok(!(await page.text()).includes("Manage team & access"));
          assert.ok(!page.requests().some((r) => r.url.includes("/access-administration/organizations/") && r.url.endsWith("/access")),
            `${legacyId}: the roster is never requested`);
          const result = await probe(page, ORG_A, USERS.contributor);
          assert.equal(result.read, 403, `${legacyId} read`);
          assert.ok(!result.readBody.includes(email(USERS.storedAdmin)), "no roster data leaks");
          assert.equal(result.write, 403, `${legacyId} write`);
          assertNoAdminDashboardOrGlobalRoleRequests(page, String(legacyId));
          assert.deepEqual(page.exceptions, []);
        } finally {
          await page.close();
        }
      }
      assert.equal(await auditCount(), auditsBefore, "nothing audited");
      assert.equal((await membershipsOf(ORG_A))[USERS.contributor], "client_contributor/active");
    });

    await test("browser (legacy GK organization admin, active binding): Team & Access from the left navigation; derived authority; join approval; promote a reviewer", async () => {
      const page = await openPage(browser, { baseUrl, legacyUserId: USERS.legacyAdmin });
      try {
        await page.goto("/impact-library");
        await page.waitForText("Knowledge Studio");
        await page.waitFor("Team & Access nav", `[...document.querySelectorAll(".gk-shell-nav-item")].some((el) => el.innerText.trim() === "Team & Access")`);
        const items = await page.orgMenuItems();
        const orgMenuNames = items.filter((item) => item !== "Manage team & access");
        assert.ok(items.includes("Manage team & access"));
        assert.equal(orgMenuNames.length, 2, `both organizations listed: ${items.join(", ")}`);

        await page.clickNav("Team & Access");
        await page.waitForText(`Team & Access for ${ORG_A_NAME}`);
        await page.waitForText(email(USERS.storedAdmin));
        // Derived-only administrator: shown, explained, not editable.
        const self = await page.memberRow(USERS.legacyAdmin);
        assert.ok(self, "the legacy administrator is listed");
        assert.match(self.text, /Administrator/);
        assert.match(self.text, /Get Kinder organization admin/);
        assert.match(self.text, /cannot be changed here/);
        assert.equal(self.role, null, "no role control for derived-only authority");
        assert.deepEqual(self.buttons, []);
        // Other members carry their effective roles and a role control.
        assert.equal((await page.memberRow(USERS.reviewer)).role, "client_reviewer");
        assert.equal((await page.memberRow(USERS.contributor)).role, "client_contributor");
        assert.equal(await page.memberRow(USERS.foreignAdmin), null, "Org B's administrator is not in Org A's roster");

        // Pending join request: approve -> contributor in the roster.
        await page.waitForText(email(USERS.requester));
        const auditsBeforeApproval = await auditCount();
        await page.clickButton(`Approve as contributor`);
        await page.waitFor("requester in roster", `Boolean(document.querySelector('[data-team-access-member="legacy:${USERS.requester}"]'))`);
        assert.equal((await page.memberRow(USERS.requester)).role, "client_contributor");
        assert.equal((await membershipsOf(ORG_A))[USERS.requester], "client_contributor/active");
        assert.equal((await query("SELECT status FROM kai.organization_join_requests WHERE organization_join_request_id = $1::uuid", [joinRequest.organization_join_request_id]))[0].status, "approved");
        assert.ok((await auditCount()) >= auditsBeforeApproval + 2, "membership + decision audits");

        // Promote the reviewer to an additional administrator.
        const mark = page.mark();
        const auditsBeforePromotion = await auditCount();
        await page.setMemberRole(USERS.reviewer, "client_admin");
        await page.clickMemberButton(USERS.reviewer, "Save role");
        await page.waitForText(`${email(USERS.reviewer)} is now an administrator.`);
        const puts = page.requestsSince(mark).filter((r) => r.method === "PUT");
        assert.deepEqual(puts.map((r) => [new URL(r.url).pathname, r.status]), [[membershipPath(ORG_A, USERS.reviewer), 200]]);
        assert.equal((await membershipsOf(ORG_A))[USERS.reviewer], "client_admin/active");
        assert.equal(await auditCount(), auditsBeforePromotion + 1);
        assert.match((await page.memberRow(USERS.reviewer)).text, /Administrator/);

        // Switch to Org B (contributor there): the entry points disappear,
        // the section returns to Home, and Org B's roster is never requested.
        const switchMark = page.mark();
        await page.orgMenuChoose(orgMenuNames.find((name) => name === ORG_B_NAME) || orgMenuNames[1]);
        await page.waitFor("Team & Access hidden for Org B", `![...document.querySelectorAll(".gk-shell-nav-item")].some((el) => el.innerText.trim() === "Team & Access")`);
        await page.idle();
        assert.deepEqual(await page.navLabels(), FIVE);
        assert.ok(!(await page.text()).includes("Team & Access for"), "the Team & Access view is gone");
        assert.ok(!(await page.text()).includes(email(USERS.contributor)), "no Org A roster remains on screen");
        const items2 = await page.orgMenuItems();
        assert.ok(!items2.includes("Manage team & access"));
        const orgBAdministration = new RegExp(`^/api/kai/sprint2/access-administration/organizations/${ORG_B}/`);
        assert.deepEqual(page.requestsSince(switchMark).filter((r) => orgBAdministration.test(new URL(r.url).pathname)).map((r) => r.url), [],
          "no Org B administration read");

        // Back to Org A: the dropdown entry opens the same Team & Access view.
        await page.orgMenuChoose(ORG_A_NAME);
        await page.waitFor("Team & Access back for Org A", `[...document.querySelectorAll(".gk-shell-nav-item")].some((el) => el.innerText.trim() === "Team & Access")`);
        await page.orgMenuChoose("Manage team & access");
        await page.waitForText(`Team & Access for ${ORG_A_NAME}`);
        await page.waitForText(email(USERS.requester));
        assert.deepEqual(await page.navLabels(), [...FIVE, "Team & Access"]);

        assertNoAdminDashboardOrGlobalRoleRequests(page, "legacy admin");
        assert.deepEqual(page.exceptions, []);
      } finally {
        await page.close();
      }
      assert.deepEqual(await membershipsOf(ORG_B), INITIAL_ORG_B, "Org B unchanged");
    });

    await test("browser (Org B administrator): sees only Org B's team; Org A reads and writes are refused", async () => {
      const auditsBefore = await auditCount();
      const page = await openPage(browser, { baseUrl, legacyUserId: USERS.foreignAdmin });
      try {
        await page.goto("/impact-library");
        await page.waitFor("Team & Access nav", `[...document.querySelectorAll(".gk-shell-nav-item")].some((el) => el.innerText.trim() === "Team & Access")`);
        await page.clickNav("Team & Access");
        // Org B has no GK binding, so the existing display-profile read
        // gives it no name (the shell shows "Your organization").
        await page.waitFor("Team & Access view", `document.getElementById("gk-team-access-heading")?.innerText === "Team & Access"`);
        await page.waitForText(email(USERS.foreignAdmin));
        assert.equal((await page.memberRow(USERS.foreignAdmin)).role, "client_admin");
        assert.equal((await page.memberRow(USERS.legacyAdmin)).role, "client_contributor");
        const body = await page.text();
        for (const legacyId of [USERS.storedAdmin, USERS.reviewer, USERS.contributor, USERS.requester]) {
          assert.ok(!body.includes(email(legacyId)), `Org A member ${legacyId} not shown`);
        }
        const result = await probe(page, ORG_A, USERS.contributor);
        assert.equal(result.read, 403);
        assert.ok(!result.readBody.includes(email(USERS.contributor)));
        assert.equal(result.write, 403);
        assertNoAdminDashboardOrGlobalRoleRequests(page, "Org B admin");
        assert.deepEqual(page.exceptions, []);
      } finally {
        await page.close();
      }
      assert.equal(await auditCount(), auditsBefore);
      assert.equal((await membershipsOf(ORG_A))[USERS.contributor], "client_contributor/active");
    });

    await test("browser (single-organization stored admin, phone width): the organization menu holds Manage team & access; removing one's own administrator role asks first, then returns to Home", async () => {
      const page = await openPage(browser, { baseUrl, legacyUserId: USERS.storedAdmin, width: 390, height: 844 });
      try {
        await page.goto("/impact-library");
        await page.waitFor("organization menu", `Boolean(document.querySelector(".gk-shell-org-switcher-btn"))`);
        assert.deepEqual(await page.orgMenuItems(), ["Manage team & access"], "single organization: only the management entry");
        await page.orgMenuChoose("Manage team & access");
        await page.waitForText(`Team & Access for ${ORG_A_NAME}`);
        await page.waitForText(email(USERS.reviewerStays));
        assert.equal(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true, "no horizontal overflow at 390px");

        // Self-demotion: the first click asks for confirmation and sends nothing.
        const mark = page.mark();
        await page.setMemberRole(USERS.storedAdmin, "client_contributor");
        await page.clickMemberButton(USERS.storedAdmin, "Save role");
        await page.waitForText("will no longer be an administrator");
        assert.equal(page.requestsSince(mark).filter((r) => r.method === "PUT").length, 0);
        await page.clickMemberButton(USERS.storedAdmin, "Confirm change");
        await page.waitFor("returned to Home", `!document.body.innerText.includes("Team & Access for")`);
        await page.idle();
        assert.equal((await membershipsOf(ORG_A))[USERS.storedAdmin], "client_contributor/active");
        assert.equal(await page.hasOrgMenuButton(), false, "no management entry any more");
        assert.ok(!(await page.navLabels()).includes("Team & Access"));
        const result = await probe(page, ORG_A, USERS.contributor);
        assert.equal(result.read, 403, "the former administrator is now refused");
        assert.deepEqual(page.exceptions, []);
      } finally {
        await page.close();
      }
    });

    await test("browser acceptance fixture: no GK global role was written and Org B is unchanged", async () => {
      assert.equal(await globalRoleCount(), 0);
      assert.deepEqual(await membershipsOf(ORG_B), INITIAL_ORG_B);
      assert.deepEqual(await membershipsOf(ORG_A), {
        [USERS.storedAdmin]: "client_contributor/active",
        [USERS.reviewer]: "client_admin/active",
        [USERS.contributor]: "client_contributor/active",
        [USERS.requester]: "client_contributor/active",
        [USERS.reviewerStays]: "client_reviewer/active",
      });
    });
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await seedPool.end();
    const { default: ambientPool } = await import("../Backend/db/pg.js");
    await ambientPool.end().catch(() => {});
  }
}
