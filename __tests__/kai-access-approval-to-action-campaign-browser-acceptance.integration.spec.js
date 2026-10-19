import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Assembled approval-to-action diagnostic campaign, run only by
 *   node scripts/kai-client-knowledge-studio-browser-acceptance-local-postgres.js \
 *     __tests__/kai-access-approval-to-action-campaign-browser-acceptance.integration.spec.js
 * against that runner's ephemeral loopback PostgreSQL. Skipped otherwise.
 *
 * One campaign across the whole review chain, with separate authenticated
 * sessions per actor and two synthetic review organizations (plus the
 * runner's smoke-seeded evidence organization for client follow-ups):
 *
 *   J1 working GK baseline, and a platform superuser without a GK role
 *   J2 GK reviewer provisioned through the governed routes (global-only,
 *      organization-only, full), then the reviewer's own review
 *   J3 mixed-role reviewer (global gk_reviewer + client_admin membership)
 *   J4 bound organization administrator (binding-derived client_admin)
 *   J5 downstream GK review: P1-08 source review in the GK Studio for the
 *      actors P1-08 authorizes (and no decision for those it refuses),
 *      P1-08 -> P2-01 evidence, P2-12 evidence review -> P2-02/P2-03 claim
 *      proposal
 *   J6 client approval: join request -> approval -> client_reviewer ->
 *      client follow-up completion
 *   J7 revocation and isolation
 *   J8 owner decision B/E: a delegated GK administrator provisioned through
 *      the governed routes adds organization gk_operator in Team & Access;
 *      that operator promotes a source in the GK Studio; targeted revocation
 *      then ends it while the client role and history remain
 *
 * Each case asserts the behavior the controlling contract or an accepted
 * owner decision requires. Where the governing authority is itself open,
 * the case asserts only the invariants (structured refusal, no unauthorized
 * write, correct tenant) and records the observed outcome in `results`.
 *
 * Real: every KAI router/service/read model and the /api/admin router on the
 * runner cluster, resolveKaiActorContext with real memberships, global roles,
 * GK organization-admin bindings, and superuser authority, the built bundle,
 * the repository's own ensureAdmin page gate (Backend/middleware/ensureAdmin.js,
 * the middleware index.js applies to /admin and /gk-admin/kai-review-cockpit),
 * and a real headless Chrome with one isolated browser context per actor.
 * Simulated: the Get Kinder session login (req.user, including is_admin,
 * from a harness cookie); the P1-03..P1-05 rows of each synthetic file (the
 * P1 worker's output); the "start review work" step for files reviewed from
 * the GK Studio queue (the real P1-06 service called directly); the
 * evidence -> claim -> claim-gap follow-up chain on the smoke organization
 * (real services called directly); and the baseline roles listed on USERS.
 * Every role or membership under test in J2/J3/J6 is written by the governed
 * administration route.
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

test("approval-to-action campaign isolation: a non-loopback runner URL is refused", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
});

test("approval-to-action campaign: index.js gates the GK review cockpit page and /admin with ensureAdmin", () => {
  const indexSource = readFileSync(new URL("../index.js", import.meta.url), "utf8");
  assert.match(indexSource, /app\.get\("\/gk-admin\/kai-review-cockpit",\s*ensureAuthenticated,\s*ensureAdmin,/);
  assert.match(indexSource, /app\.get\("\/admin",\s*ensureAuthenticated,\s*ensureAdmin,/);
  assert.match(indexSource, /app\.get\("\/impact-library",\s*ensureAuthenticated,\s*\(req, res\)/);
});

if (!RUNNER_DATABASE_URL || !CHROME || !WORKDIR) {
  test("approval-to-action campaign requires its runner", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_DATABASE_URL);
  await runBrowserAcceptance();
}

// ---------------------------------------------------------------------------
// Minimal Chrome DevTools protocol client (Node's built-in WebSocket), the
// same shape as the other Knowledge Studio acceptance specs.
// ---------------------------------------------------------------------------

async function launchChrome() {
  const profileDir = join(WORKDIR, "chrome-profile-approval-to-action");
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

async function openPage(browser, { baseUrl, legacyUserId }) {
  // An isolated browser context per actor session: the harness login cookie
  // is per-context, so two sessions never share state.
  const { browserContextId } = await browser.send("Target.createBrowserContext", { disposeOnDetach: true });
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const requests = [];
  const byId = new Map();
  const exceptions = [];
  const listener = (message) => {
    if (message.sessionId !== sessionId) return;
    const { method, params } = message;
    if (method === "Network.requestWillBeSent" && params.type !== "Document" && params.request.url.includes("/api/")) {
      const entry = { url: params.request.url, method: params.request.method, status: null, done: false };
      requests.push(entry);
      byId.set(params.requestId, entry);
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
  await browser.send("Network.setCookie", { name: "kai_harness_user", value: String(legacyUserId), url: baseUrl }, sessionId);

  const evaluate = async (expression) => {
    const result = await browser.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (result.exceptionDetails) throw new Error(`evaluate failed: ${result.exceptionDetails.text} ${expression.slice(0, 120)}`);
    return result.result.value;
  };
  const text = () => evaluate("document.body ? document.body.innerText : ''");
  const idle = async () => {
    let quietSince = Date.now();
    for (let i = 0; i < 400; i += 1) {
      await new Promise((r) => setTimeout(r, 50));
      if (requests.some((request) => !request.done)) quietSince = Date.now();
      else if (Date.now() - quietSince > 500) return;
    }
    throw new Error(`network never went idle: ${JSON.stringify(requests.filter((request) => !request.done))}`);
  };
  const waitFor = async (predicate, description, { timeout = 15000 } = {}) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`timed out waiting for ${description}\n--- page ---\n${(await text()).slice(0, 4000)}`);
  };
  const waitForText = (needle, options) => waitFor(async () => (await text()).includes(needle), `text: ${needle}`, options);
  const clickWhere = async (description, finder) => {
    const clicked = await evaluate(`(() => { const el = (${finder})(); if (!el) return false; el.click(); return true; })()`);
    if (!clicked) throw new Error(`no visible control: ${description}\n--- page ---\n${(await text()).slice(0, 3000)}`);
  };
  const visibleButton = (label) => evaluate(`Boolean([...document.querySelectorAll("button")]
    .find((el) => el.offsetParent !== null && !el.disabled && el.innerText.trim() === ${JSON.stringify(label)}))`);
  const setSelect = async (selectorExpression, value) => {
    const ok = await evaluate(`(() => {
      const el = (${selectorExpression})();
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return el.value === ${JSON.stringify(value)};
    })()`);
    assert.ok(ok, `select set to ${value}`);
  };
  return {
    requests: () => requests.slice(),
    mark: () => requests.length,
    requestsSince: (mark) => requests.slice(mark),
    exceptions,
    clickWhere,
    setSelectWhere: setSelect,
    evaluate,
    text,
    idle,
    waitFor,
    waitForText,
    visibleButton,
    pathname: () => evaluate("location.pathname"),
    activeTab: () => evaluate(`(() => { const el = document.querySelector(".nav-tabs button.active"); return el ? el.innerText.trim() : null; })()`),
    clickNav: (label) => clickWhere(`nav ${label}`, `() => [...document.querySelectorAll("[role=button], a, button")]
      .filter((el) => el.offsetParent !== null).find((el) => el.innerText.trim() === ${JSON.stringify(label)})`),
    clickTab: (label) => clickWhere(`tab ${label}`, `() => [...document.querySelectorAll(".nav-tabs button")]
      .filter((el) => el.offsetParent !== null).find((el) => el.innerText.trim() === ${JSON.stringify(label)})`),
    clickButton: (label) => clickWhere(`button ${label}`, `() => [...document.querySelectorAll("button")]
      .filter((el) => el.offsetParent !== null && !el.disabled).find((el) => el.innerText.trim() === ${JSON.stringify(label)})`),
    clickLink: (label) => clickWhere(`link ${label}`, `() => [...document.querySelectorAll("a")]
      .filter((el) => el.offsetParent !== null).find((el) => el.innerText.trim() === ${JSON.stringify(label)})`),
    linkHref: (label) => evaluate(`(() => {
      const el = [...document.querySelectorAll("a")].find((a) => a.offsetParent !== null && a.innerText.trim() === ${JSON.stringify(label)});
      return el ? el.getAttribute("href") : null;
    })()`),
    // Sets the decision form's <select> on the row whose label is `rowLabel`.
    setFormRow: (rowLabel, value) => setSelect(`() => {
      const label = [...document.querySelectorAll(".col-7")].find((el) => el.offsetParent !== null && el.innerText.trim() === ${JSON.stringify(rowLabel)});
      return label && label.parentElement.querySelector("select");
    }`, value),
    // The cockpit's <label>Text <select/></label> controls.
    selectByLabel: (labelText, value) => setSelect(`() => {
      const label = [...document.querySelectorAll("label")].find((el) => el.innerText.trim().startsWith(${JSON.stringify(labelText)}));
      return label && label.querySelector("select");
    }`, value),
    selectProject: (engagementId) => setSelect(`() => document.getElementById("gk-shell-project-select")`, engagementId),
    clickFileReviewAction: (intakeFileId) => clickWhere(`sensitivity review action for ${intakeFileId}`,
      `() => [...document.querySelectorAll('button[data-sensitivity-review-file="${intakeFileId}"]')]
        .find((el) => el.offsetParent !== null && !el.disabled)`),
    fileReviewActionIds: () => evaluate(`[...document.querySelectorAll("button[data-sensitivity-review-file]")]
      .filter((el) => el.offsetParent !== null).map((el) => el.getAttribute("data-sensitivity-review-file")).sort()`),
    pipelineFileText: (intakeFileId) => evaluate(`(() => {
      const el = document.querySelector('[data-pipeline-file="${intakeFileId}"]');
      return el ? el.innerText : null;
    })()`),
    // Synthetic evidence statements repeat across files, so an item is found
    // by its evidence item id, not its text.
    clickInEvidenceItem: (evidenceItemId, label) => evaluate(`(() => {
      const li = document.querySelector(${JSON.stringify(`li.list-group-item[data-evidence-item-id="${evidenceItemId}"]`)});
      const button = li && [...li.querySelectorAll("button")].find((el) => el.innerText.trim() === ${JSON.stringify(label)} && !el.disabled);
      if (!button) return false;
      button.click();
      return true;
    })()`),
    // A same-origin request from this session (its cookie), for direct-route checks.
    fetchJson: (method, path, body) => evaluate(`(async () => {
      const response = await fetch(${JSON.stringify(`${baseUrl}${path}`)}, {
        method: ${JSON.stringify(method)},
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        ${body === undefined ? "" : `body: ${JSON.stringify(JSON.stringify(body))},`}
      });
      let parsed = null;
      try { parsed = await response.json(); } catch { parsed = null; }
      return {
        status: response.status,
        errorCode: parsed?.error?.code ?? (typeof parsed?.error === "string" ? parsed.error : null),
        blockers: Array.isArray(parsed?.blockers) ? parsed.blockers.map((b) => [b.validator_key, b.blocking_reason]) : null,
        blockingReason: Array.isArray(parsed?.blockers) ? parsed.blockers[0]?.blocking_reason ?? null : null,
        data: parsed?.data ?? null,
      };
    })()`),
    // /admin -> Organizations -> KAI Access modal.
    clickOrganizationKaiAccess: (organizationName) => clickWhere(`KAI Access for ${organizationName}`, `() => [...document.querySelectorAll("tr")]
      .filter((tr) => tr.offsetParent !== null && tr.innerText.includes(${JSON.stringify(organizationName)}))
      .map((tr) => [...tr.querySelectorAll("button")].find((b) => b.innerText.trim() === "KAI Access")).find(Boolean)`),
    modalRoleOptions: () => evaluate(`[...document.querySelectorAll(".admin-edit-card .border-top select option")].map((o) => o.value)`),
    async modalGrant(emailAddress, roleName) {
      const ok = await evaluate(`(() => {
        const input = document.querySelector('.admin-edit-card input[type="email"]');
        if (!input) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, ${JSON.stringify(emailAddress)});
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })()`);
      assert.ok(ok, "grant email input");
      await setSelect(`() => document.querySelector(".admin-edit-card .border-top select")`, roleName);
      await clickWhere("Grant KAI Access", `() => [...document.querySelectorAll(".admin-edit-card button")].find((b) => b.innerText.trim() === "Grant KAI Access" && !b.disabled)`);
    },
    accessRowText: (legacyId) => evaluate(`(() => {
      const el = document.querySelector('[data-kai-access-row="legacy:${legacyId}"]');
      return el ? el.innerText : null;
    })()`),
    activate: () => browser.send("Page.bringToFront", {}, sessionId),
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
// Campaign
// ---------------------------------------------------------------------------

async function runBrowserAcceptance() {
  const { Pool } = await import("pg");
  const express = (await import("express")).default;
  const seedPool = new Pool({ connectionString: RUNNER_DATABASE_URL, ssl: false, max: 4 });
  const { findOrCreateKaiUserByLegacyPublicUserdataId } = await import("../Backend/kai/db/kaiQueries.js");
  const { ensureSensitivityReviewQueueItem } = await import("../Backend/kai/services/kaiReviewQueueService.js");
  const { extractEvidenceFromSourceVersion } = await import("../Backend/kai/services/kaiEvidenceLineageService.js");
  const { proposeClaim } = await import("../Backend/kai/services/kaiClaimProposalService.js");
  const { generateClaimGapFollowups } = await import("../Backend/kai/services/kaiClaimGapFollowupService.js");
  const sprint2IntakeApiRouter = (await import("../Backend/kai/routes/sprint2IntakeApi.js")).default;
  const kaiAccessAdministrationApiRouter = (await import("../Backend/kai/routes/kaiAccessAdministrationApi.js")).default;
  const adminApiRouter = (await import("../routes/adminApi.js")).default;
  const { requireKaiSprint2Enabled } = await import("../Backend/kai/config/kaiSprint2Config.js");
  const { requireKaiSprint2Authenticated } = await import("../Backend/kai/middleware/kaiSprint2Authentication.js");
  const { ensureAdmin } = await import("../Backend/middleware/ensureAdmin.js");
  const query = async (sql, params = []) => (await seedPool.query(sql, params)).rows;
  const ENV = { KAI_SPRINT2_ENABLED: "true" };
  const noAudit = () => ({ prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } });

  const ORG_A = "00000000-0000-4000-8000-0000000da0a1";
  const ORG_B = "00000000-0000-4000-8000-0000000da0b2";
  const ORG_C = "00000000-0000-4000-8000-000000000001"; // runner smoke-seeded evidence organization
  const ORG_A_NAME = "Tidewater Synthetic Pantry";
  const ORG_B_NAME = "Larkspur Synthetic Shelter";
  const ORG_C_NAME = "Harbourline Synthetic Society";
  const PROJECT_A = "7d000000-0000-4000-8000-0000000da0a1";
  const PROJECT_A2 = "7d000000-0000-4000-8000-0000000da0a2";
  const PROJECT_B = "7d000000-0000-4000-8000-0000000da0b2";
  const PROJECT_C = "7d000000-0000-4000-8000-0000000da0c3";
  const BATCH_A = "11000000-0000-4000-8000-0000000da0a1";
  const BATCH_A2 = "11000000-0000-4000-8000-0000000da0a2";
  const BATCH_B = "11000000-0000-4000-8000-0000000da0b2";
  const FILES = Object.freeze({
    superGk: "21000000-0000-4000-8000-0000000da101",
    reviewer: "21000000-0000-4000-8000-0000000da102",
    mixed: "21000000-0000-4000-8000-0000000da103",
    bound: "21000000-0000-4000-8000-0000000da104",
    probe: "21000000-0000-4000-8000-0000000da105",
    otherOrg: "21000000-0000-4000-8000-0000000da106",
    projectTwo: "21000000-0000-4000-8000-0000000da107",
  });
  const NAMES = Object.freeze({
    superGk: "synthetic_tidewater_pantry_visits.csv",
    reviewer: "synthetic_tidewater_hamper_deliveries.csv",
    mixed: "synthetic_tidewater_volunteer_hours.csv",
    bound: "synthetic_tidewater_referrals.csv",
    probe: "synthetic_tidewater_waitlist.csv",
    otherOrg: "synthetic_larkspur_bed_nights.csv",
    projectTwo: "synthetic_tidewater_project_two.csv",
  });
  const FIELD_KEYS = ["households_served", "programme_month"];
  const USERS = Object.freeze({
    superGk: 2301, // site admin; Get Kinder admin of Org A's bound organization (derived client_admin); global gk_admin (baseline)
    superNoRole: 2302, // site admin; stored client_contributor of Org A; no global KAI role, no binding
    superGkStored: 2303, // site admin; global gk_admin (baseline); gk_reviewer membership of Org A granted in J5
    reviewer: 2304, // ordinary account; made a GK reviewer of Org A in J2 through the governed routes
    reviewerOrgOnly: 2305, // ordinary account; gk_reviewer organization role of Org A only (J2)
    mixed: 2306, // stored client_admin of Org A (baseline); global gk_reviewer granted in J3
    boundAdmin: 2307, // Get Kinder admin of Org A's bound organization (derived client_admin); no global role, not a site admin
    storedAdmin: 2308, // stored client_admin of Org A, no binding
    otherOrgReviewer: 2309, // stored gk_reviewer of Org B + global gk_reviewer (baseline)
    gkOperator: 2310, // stored gk_operator of Org A + global gk_operator (baseline; no governed writer exists for this pair)
    adminC: 2311, // stored client_admin of Org C
    newMember: 2312, // ordinary account; joins Org C in J6
    freshNotNull: 2313, // ordinary account; first KAI request under the deployed NOT NULL email mirror (J2-0)
    freshNullable: 2314, // ordinary account; first KAI request under the runner's nullable mirror (J2-0)
    memberA: 2315, // ordinary account; stored client_contributor of Org A (P3 organization-facing readback)
    clientReviewerA: 2316, // ordinary account; stored client_contributor of Org A, made client_reviewer by Team & Access in P3
    mixedOperator: 2318, // global GK operator + stored client_admin; no organization GK grant
    memberB: 2317, // ordinary account; stored client_contributor of Org B (P3 isolation)
    gkDelegate: 2319, // ordinary account; made a delegated GK administrator of Org A through the governed routes in J8
    governedOperator: 2320, // ordinary account; client_contributor + global gk_operator (superuser), organization gk_operator (delegate) in J8
    newGkAdmin: 2321, // ordinary account, no KAI role; made a delegated GK administrator of Org A from /admin in J9
    opsRecipient: 2322, // ordinary account; Org A client_contributor (superuser, /admin) then organization gk_operator (J9 delegate)
    revRecipient: 2323, // ordinary account; Org A client_contributor (superuser, /admin) then organization gk_reviewer (J9 delegate)
    staffAdmin: 2324, // ordinary account, no KAI role; made a delegated GK administrator of Org A in Team & Access (J10)
    staffOperatorNew: 2325, // verified account that never used KAI; onboarded as an operator by email in J11
    staffReviewerNew: 2326, // verified account that never used KAI; onboarded as a reviewer by email in J11
    unverifiedStaff: 2327, // registered but never verified its Get Kinder email (J11 negative)
  });
  const SITE_ADMINS = new Set([USERS.superGk, USERS.superNoRole, USERS.superGkStored]);
  const FIRST_SIGN_IN = new Set([USERS.reviewer, USERS.reviewerOrgOnly, USERS.newMember, USERS.freshNotNull, USERS.freshNullable,
    USERS.staffOperatorNew, USERS.staffReviewerNew, USERS.unverifiedStaff]);
  const email = (legacyId) => `user${legacyId}@tidewater.test`;

  // --- legacy Get Kinder columns the real /api/admin routes select ----------
  await query(`ALTER TABLE public.userdata ADD COLUMN IF NOT EXISTS email text, ADD COLUMN IF NOT EXISTS firstname text,
                 ADD COLUMN IF NOT EXISTS lastname text`);
  await query(`ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS website text, ADD COLUMN IF NOT EXISTS applied_at timestamptz,
                 ADD COLUMN IF NOT EXISTS approved_at timestamptz, ADD COLUMN IF NOT EXISTS funding_class text,
                 ADD COLUMN IF NOT EXISTS subsidy_eligible boolean, ADD COLUMN IF NOT EXISTS subsidy_cap_percent numeric,
                 ADD COLUMN IF NOT EXISTS manual_override_only boolean, ADD COLUMN IF NOT EXISTS funding_notes text,
                 ADD COLUMN IF NOT EXISTS rep_user_id integer, ADD COLUMN IF NOT EXISTS logo_url text,
                 ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()`);

  // --- organizations, binding, projects, batches ---------------------------
  await query(`INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES
                 ($1::uuid, $3, 'tidewater-synthetic'), ($2::uuid, $4, 'larkspur-synthetic')`, [ORG_A, ORG_B, ORG_A_NAME, ORG_B_NAME]);
  await query(`INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES ($1::uuid, $2, 'harbourline-synthetic')
               ON CONFLICT (organization_id) DO NOTHING`, [ORG_C, ORG_C_NAME]);
  const [gkOrganization] = await query("INSERT INTO public.organizations (name, status) VALUES ($1, 'approved') RETURNING id", [ORG_A_NAME]);
  await query("INSERT INTO kai.gk_organization_bindings (gk_organization_id, kai_organization_id, status) VALUES ($1, $2::uuid, 'active')", [gkOrganization.id, ORG_A]);
  for (const [engagementId, organizationId, code] of [[PROJECT_A, ORG_A, "Project Tidewater"], [PROJECT_A2, ORG_A, "Project Tidewater Two"], [PROJECT_B, ORG_B, "Project Larkspur"], [PROJECT_C, ORG_C, "Project Harbourline Campaign"]]) {
    await query("INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code, project_metadata) VALUES ($1::uuid, $2::uuid, $3, '{}'::jsonb)",
      [engagementId, organizationId, code]);
  }
  for (const [batchId, organizationId, engagementId, code] of [[BATCH_A, ORG_A, PROJECT_A, "tidewater-2026"], [BATCH_A2, ORG_A, PROJECT_A2, "tidewater-two-2026"], [BATCH_B, ORG_B, PROJECT_B, "larkspur-2026"]]) {
    await query(`INSERT INTO kai.intake_batches (intake_batch_id, organization_id, engagement_id, batch_code, processing_status, review_status)
                 VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'received', 'not_reviewed')`, [batchId, organizationId, engagementId, code]);
  }

  // --- users ----------------------------------------------------------------
  for (const legacyId of Object.values(USERS)) {
    await query("INSERT INTO public.userdata (id, email, firstname, lastname) VALUES ($1, $2, 'Synthetic', $3) ON CONFLICT (id) DO NOTHING",
      [legacyId, email(legacyId), `User ${legacyId}`]);
  }
  // Every account signs in through verified Get Kinder login except this one.
  await query("UPDATE public.userdata SET email_verified = false WHERE id = $1", [USERS.unverifiedStaff]);
  const kaiUserIds = {};
  for (const [key, legacyId] of Object.entries(USERS)) {
    if (FIRST_SIGN_IN.has(legacyId)) continue;
    kaiUserIds[key] = (await findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: legacyId, email: email(legacyId) })).user_id;
  }
  for (const legacyId of [USERS.superGk, USERS.boundAdmin]) {
    await query("INSERT INTO public.user_org_memberships (org_id, user_id, role, is_active) VALUES ($1, $2, 'admin', true)", [gkOrganization.id, legacyId]);
  }
  const insertMembership = (organizationId, key, role) => query(
    "INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status) VALUES ($1::uuid, $2::uuid, $3, 'active')",
    [organizationId, kaiUserIds[key], role]);
  const insertGlobalRole = (key, role) => query(
    "INSERT INTO kai.user_roles (user_id, role_id) SELECT $1::uuid, role_id FROM kai.roles WHERE role_name = $2", [kaiUserIds[key], role]);
  await insertMembership(ORG_A, "superNoRole", "client_contributor");
  await insertMembership(ORG_A, "mixed", "client_admin");
  await insertMembership(ORG_A, "mixedOperator", "client_admin");
  await insertMembership(ORG_A, "storedAdmin", "client_admin");
  await insertMembership(ORG_B, "otherOrgReviewer", "gk_reviewer");
  await insertMembership(ORG_A, "gkOperator", "gk_operator");
  await insertMembership(ORG_C, "adminC", "client_admin");
  await insertMembership(ORG_A, "memberA", "client_contributor");
  await insertMembership(ORG_A, "clientReviewerA", "client_contributor");
  await insertMembership(ORG_B, "memberB", "client_contributor");
  await insertGlobalRole("superGk", "gk_admin");
  await insertGlobalRole("superGkStored", "gk_admin");
  await insertGlobalRole("otherOrgReviewer", "gk_reviewer");
  await insertGlobalRole("gkOperator", "gk_operator");
  const serviceActor = (key, role, organizationId) => ({
    actorType: "human",
    actorUserId: kaiUserIds[key],
    source: "public.userdata",
    kaiRoles: [role],
    platformSuperuser: false,
    organizationMemberships: [{ organization_id: organizationId, membership_status: "active", role_name: role }],
  });

  /** P1-03..P1-05 rows of one fresh confirmed Project file (the P1 worker's output). */
  async function seedFreshFile({ organizationId, batchId, engagementId, intakeFileId, name, checksumChar }) {
    const checksum = checksumChar.repeat(64);
    await query(
      `INSERT INTO kai.intake_files (intake_file_id, intake_batch_id, organization_id, engagement_id, original_filename, safe_filename,
         checksum, hash_algorithm, upload_state, object_version_id, verified_checksum, verified_size_bytes, verified_at,
         mime_type, file_size_bytes, malware_scan_status, review_status, file_policy_status, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $5, $6, 'sha256', 'confirmed', 'synthetic-v1', $6, 512, now(),
         'text/csv', 512, 'clean', 'not_reviewed', 'passed', now())`,
      [intakeFileId, batchId, organizationId, engagementId, name, checksum],
    );
    const [run] = await query(
      `INSERT INTO kai.intake_parser_runs (organization_id, intake_file_id, parser_name, parser_version, checksum, parser_status, started_at)
       VALUES ($1::uuid, $2::uuid, 'kai_local_profiling_kernel', '1.0.0', $3, 'running', now()) RETURNING parser_run_id::text`,
      [organizationId, intakeFileId, checksum],
    );
    const profile = {
      status: "profiled", format: "csv",
      counts: { row_count: 1, column_count: FIELD_KEYS.length, field_count: FIELD_KEYS.length },
      fields: FIELD_KEYS.map((key) => ({ field_key: key })),
    };
    const [fileProfile] = await query(
      `INSERT INTO kai.intake_file_profiles (organization_id, intake_file_id, parser_run_id, parser_name, parser_version, checksum, profile, profile_canonical_sha256)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'kai_local_profiling_kernel', '1.0.0', $4, $5::jsonb, encode(digest($5::jsonb::text, 'sha256'), 'hex'))
       RETURNING file_profile_id::text, profile_canonical_sha256`,
      [organizationId, intakeFileId, run.parser_run_id, checksum, JSON.stringify(profile)],
    );
    await query("UPDATE kai.intake_parser_runs SET parser_status = 'completed', completed_at = now(), output_profile_id = $2::uuid WHERE parser_run_id = $1::uuid",
      [run.parser_run_id, fileProfile.file_profile_id]);
    const [dictionary] = await query(
      `INSERT INTO kai.data_dictionaries (organization_id, intake_file_id, file_profile_id, profile_canonical_sha256)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4) RETURNING data_dictionary_id::text`,
      [organizationId, intakeFileId, fileProfile.file_profile_id, fileProfile.profile_canonical_sha256],
    );
    for (const key of FIELD_KEYS) {
      await query(
        `INSERT INTO kai.data_dictionary_fields (data_dictionary_id, organization_id, file_profile_id, profile_field_key, field_label_safe, data_type)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $4, 'number')`,
        [dictionary.data_dictionary_id, organizationId, fileProfile.file_profile_id, key],
      );
    }
    const [sensitivity] = await query(
      `INSERT INTO kai.intake_sensitivity_profiles (organization_id, intake_file_id, file_profile_id, data_dictionary_id, profile_canonical_sha256)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5) RETURNING intake_sensitivity_profile_id::text`,
      [organizationId, intakeFileId, fileProfile.file_profile_id, dictionary.data_dictionary_id, fileProfile.profile_canonical_sha256],
    );
    return sensitivity.intake_sensitivity_profile_id;
  }
  // The "start review work" step for GK Studio queue reviews: the real P1-06
  // service, called just before that file's case so the Review Queue holds
  // one open sensitivity item at a time.
  async function openReviewWork(organizationId, profileId) {
    const actor = organizationId === ORG_A ? serviceActor("gkOperator", "gk_operator", ORG_A) : serviceActor("otherOrgReviewer", "gk_reviewer", ORG_B);
    const ensured = await ensureSensitivityReviewQueueItem(
      { organizationId, intakeSensitivityProfileId: profileId, actorContext: actor, now: new Date().toISOString() },
      { env: ENV, metadataOnlyAudit: noAudit() },
    );
    assert.equal(ensured.ok, true, JSON.stringify(ensured));
    return ensured.data.reviewQueueItem;
  }
  const profiles = {};
  for (const [key, organizationId, batchId, engagementId, checksumChar] of [
    ["superGk", ORG_A, BATCH_A, PROJECT_A, "1"], ["reviewer", ORG_A, BATCH_A, PROJECT_A, "2"], ["mixed", ORG_A, BATCH_A, PROJECT_A, "3"],
    ["bound", ORG_A, BATCH_A, PROJECT_A, "4"], ["probe", ORG_A, BATCH_A, PROJECT_A, "5"], ["otherOrg", ORG_B, BATCH_B, PROJECT_B, "6"],
    ["projectTwo", ORG_A, BATCH_A2, PROJECT_A2, "7"],
  ]) {
    profiles[key] = await seedFreshFile({ organizationId, batchId, engagementId, intakeFileId: FILES[key], name: NAMES[key], checksumChar });
  }

  // --- J6 client follow-ups on the smoke organization (real services) ------
  const gkReviewerC = {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-0000000dac01",
    source: "public.userdata",
    organizationMemberships: [{ organization_id: ORG_C, membership_status: "active", role_name: "gk_reviewer" }],
  };
  const SEED_NOW = new Date().toISOString();
  const [smokeVersion] = await query(
    "SELECT source_version_id FROM kai.source_versions WHERE organization_id = $1::uuid AND is_current = true ORDER BY source_version_id LIMIT 1", [ORG_C]);
  assert.equal((await extractEvidenceFromSourceVersion(
    { organizationId: ORG_C, sourceVersionId: smokeVersion.source_version_id, actorContext: gkReviewerC, now: SEED_NOW },
    { env: ENV, metadataOnlyAudit: noAudit() },
  )).ok, true);
  const [smokeEvidence] = await query(
    `SELECT evidence_item_id FROM kai.evidence_items e WHERE organization_id = $1::uuid
       AND NOT EXISTS (SELECT 1 FROM kai.claims c WHERE c.organization_id = e.organization_id AND c.evidence_item_id = e.evidence_item_id)
     ORDER BY evidence_item_id LIMIT 1`, [ORG_C]);
  const proposedC = await proposeClaim({ organizationId: ORG_C, evidenceItemId: smokeEvidence.evidence_item_id, actorContext: gkReviewerC, now: SEED_NOW },
    { env: ENV, metadataOnlyAudit: noAudit() });
  assert.equal(proposedC.ok, true, JSON.stringify(proposedC));
  const followupClaimId = proposedC.data.claim.claim_id;
  assert.equal((await generateClaimGapFollowups({ organizationId: ORG_C, claimId: followupClaimId, actorContext: gkReviewerC, now: SEED_NOW },
    { env: ENV, metadataOnlyAudit: noAudit() })).ok, true);
  async function followupQueue() {
    return query(
      `SELECT cfi.client_followup_item_id::text, rq.review_queue_item_id::text, rq.queue_status, rq.review_status, rq.updated_at
         FROM kai.client_followup_items cfi
         JOIN kai.review_queue_items rq ON rq.organization_id = cfi.organization_id AND rq.queue_type = 'client_followup'
          AND rq.target_object_type = 'client_followup_item' AND rq.target_object_id = cfi.client_followup_item_id
        WHERE cfi.organization_id = $1::uuid AND cfi.claim_id = $2::uuid ORDER BY cfi.dimension_key`,
      [ORG_C, followupClaimId]);
  }
  assert.ok((await followupQueue()).length >= 3, "at least three follow-ups (member completion, superuser probe, post-revocation denial)");

  // --- harness app ---------------------------------------------------------
  const publicDir = new URL("../public/", import.meta.url).pathname;
  const pageShell = (title, rootId, script) => `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${title}</title>
    <link rel="stylesheet" href="/css/style.css" /><link rel="stylesheet" href="/css/gk-design-tokens.css" /></head>
    <body><div id="${rootId}"></div><script src="/js/bundles/entry.js"></script><script>${script}</script></body></html>`;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const match = /(?:^|;\s*)kai_harness_user=(\d+)/.exec(req.headers.cookie || "");
    if (match) {
      const id = Number(match[1]);
      // Get Kinder site-admin authority (ensureAdmin / isAdminRequest) is
      // req.user.is_admin, as deserialized from public.userdata in production.
      req.user = { id, email: email(id), is_admin: SITE_ADMINS.has(id) };
    }
    req.isAuthenticated = () => Boolean(req.user);
    next();
  });
  app.use("/api/kai/sprint2/intake", requireKaiSprint2Enabled, requireKaiSprint2Authenticated, sprint2IntakeApiRouter);
  app.use("/api/kai/sprint2/access-administration", requireKaiSprint2Enabled, requireKaiSprint2Authenticated, kaiAccessAdministrationApiRouter);
  app.use("/api/admin", adminApiRouter);
  app.get("/", (_req, res) => res.send("<!DOCTYPE html><html><head><title>Get Kinder</title></head><body><main>Get Kinder home (harness)</main></body></html>"));
  app.get("/impact-library", (_req, res) => res.send(pageShell("Impact Library", "impact-evidence-library-root", "window.renderImpactEvidenceLibrary();")));
  // The same page gates as index.js (pinned by the source test above): the
  // repository's real ensureAdmin on /admin and the GK review cockpit page.
  app.get("/admin", ensureAdmin, (_req, res) => res.send(pageShell("Admin", "admin-root", "window.renderAdmin('#admin-root');")));
  app.get("/gk-admin/kai-review-cockpit", ensureAdmin, (_req, res) => res.send(pageShell("KAI Review Cockpit", "kai-review-cockpit-root",
    "window.renderKaiReviewCockpit('#kai-review-cockpit-root');")));
  app.get("/kai/client-followups", (req, res) => {
    const organizationId = typeof req.query.organizationId === "string" ? req.query.organizationId : "";
    res.send(pageShell("KAI Client Follow-ups", "kai-client-followup-review-root",
      `window.renderKaiClientFollowupReview("#kai-client-followup-review-root", ${JSON.stringify({ organizationId })});`));
  });
  app.use(express.static(publicDir));
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchChrome();

  const INTAKE = "/api/kai/sprint2/intake";
  const COCKPIT = `${INTAKE}/admin/review-cockpit`;
  const ACCESS = "/api/kai/sprint2/access-administration";
  const cockpitCapabilitiesPath = (organizationId) => `${COCKPIT}/capabilities?organization_id=${organizationId}`;
  const accessCapabilitiesPath = (organizationId) => `${INTAKE}/admin/organizations/${organizationId}/access-capabilities`;
  const profilePath = (profileId, organizationId = ORG_A) => `${COCKPIT}/sensitivity-profiles/${profileId}?organization_id=${organizationId}`;
  const decisionPath = (profileId, organizationId = ORG_A) => `${COCKPIT}/sensitivity-profiles/${profileId}/decision?organization_id=${organizationId}`;
  const reviewWorkPath = (profileId, organizationId = ORG_A) => `${COCKPIT}/sensitivity-profiles/${profileId}/review-work?organization_id=${organizationId}`;
  const sourceQueuePath = (organizationId = ORG_A) => `${COCKPIT}/queue?organization_id=${organizationId}&queue_type=source_candidate_review&queue_status=open`;
  const candidatePath = (candidateId, organizationId = ORG_A) => `${COCKPIT}/source-candidates/${candidateId}?organization_id=${organizationId}`;
  const candidateDecisionPath = (candidateId, organizationId = ORG_A) => `${COCKPIT}/source-candidates/${candidateId}/decision?organization_id=${organizationId}`;
  const evidenceReviewPath = (organizationId, evidenceItemId, reviewQueueItemId) =>
    `${INTAKE}/admin/organizations/${organizationId}/evidence-items/${evidenceItemId}/evidence-review/${reviewQueueItemId}/complete`;
  const internalAcceptancePath = (organizationId, claimId, dimensionKey) =>
    `${INTAKE}/admin/organizations/${organizationId}/claims/${claimId}/coverage-dimensions/${dimensionKey}/internal-acceptance`;
  const followupsPath = (organizationId) => `${INTAKE}/admin/organizations/${organizationId}/client-followups`;
  const followupCompletePath = (followupId) => `${INTAKE}/admin/organizations/${ORG_C}/claims/${followupClaimId}/client-followups/${followupId}/complete`;
  const membershipPath = (organizationId, legacyId) => `${ACCESS}/organizations/${organizationId}/memberships/${legacyId}`;
  // Repair 1 delegated GK staff onboarding / offboarding.
  const staffPath = (organizationId, legacyId = null) => `${ACCESS}/organizations/${organizationId}/gk-staff${legacyId === null ? "" : `/${legacyId}`}`;
  const staffRevokePath = (organizationId, legacyId, roleName) => `${staffPath(organizationId, legacyId)}/roles/${roleName}/revoke`;
  const globalRolePath = (legacyId) => `${ACCESS}/global-roles/${legacyId}`;
  const pipelinePath = (organizationId = ORG_A, engagementId = PROJECT_A) => `${INTAKE}/admin/organizations/${organizationId}/engagements/${engagementId}/client-evidence-pipeline`;
  const pathOf = (r) => new URL(r.url).pathname;
  const writes = (requests) => requests.filter((r) => r.method !== "GET").map((r) => [r.method, pathOf(r), r.status]);
  const REVIEWED_SNAPSHOT = Object.freeze({
    reviewed_personal_data_status: "present",
    reviewed_minor_data_status: "absent",
    reviewed_health_housing_justice_immigration_status: "absent",
    reviewed_indigenous_governance_status: "unknown",
    reviewed_staff_notes_status: "absent",
    reviewed_story_testimonial_status: "absent",
    reviewed_small_cell_risk_status: "unknown",
    reviewed_financial_records_status: "absent",
    reviewed_consent_basis_status: "unknown",
    reviewed_allowed_use_status: "unknown",
    reviewed_llm_processing_allowed: false,
    reviewed_product_learning_allowed: false,
    reviewed_public_use_allowed: false,
    reviewed_funder_use_allowed: false,
  });
  const FAKE_DECISION_BODY = Object.freeze({
    expected_updated_at: "2026-01-01T00:00:00.000Z",
    review_queue_item_id: "31000000-0000-4000-8000-0000000da999",
    decision: "needs_more_information",
  });
  const PROMOTE_BODY = Object.freeze({ outcome: "promoted", reviewed_source_type: "organization_primary_record" });

  // Every kai table's row count, plus a content fingerprint of the tables a
  // refused request must never touch in place.
  async function allKaiCounts() {
    const counts = {};
    for (const { table_name: table } of await query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'kai' AND table_type = 'BASE TABLE' ORDER BY table_name",
    )) {
      counts[table] = (await query(`SELECT count(*)::int AS count FROM kai.${table}`))[0].count;
    }
    const [fingerprint] = await query(`SELECT
      (SELECT md5(coalesce(string_agg(review_queue_item_id::text || queue_status || coalesce(review_status, '') || updated_at::text, ',' ORDER BY review_queue_item_id), '')) FROM kai.review_queue_items) AS queue,
      (SELECT md5(coalesce(string_agg(intake_source_candidate_id::text || candidate_status, ',' ORDER BY intake_source_candidate_id), '')) FROM kai.intake_source_candidates) AS candidates,
      (SELECT md5(coalesce(string_agg(organization_id::text || user_id::text || role_name || membership_status, ',' ORDER BY organization_id, user_id, role_name), '')) FROM kai.organization_memberships) AS memberships,
      (SELECT md5(coalesce(string_agg(user_id::text || role_id::text || active::text || coalesce(revoked_at::text, ''), ',' ORDER BY user_id, role_id), '')) FROM kai.user_roles) AS roles`);
    counts.__fingerprint = fingerprint;
    return counts;
  }
  const changedTables = (before, after) => Object.keys(after).filter((table) => table !== "__fingerprint" && after[table] !== before[table]).sort();
  async function assertNothingWritten(before, label) {
    const after = await allKaiCounts();
    assert.deepEqual(changedTables(before, after), [], `${label}: no table row count changed`);
    assert.deepEqual(after.__fingerprint, before.__fingerprint, `${label}: no queue, candidate, membership, or role row changed in place`);
  }
  async function sensitivityQueue(profileId, organizationId = ORG_A) {
    const [row] = await query(
      `SELECT review_queue_item_id::text, queue_status, review_status, updated_at FROM kai.review_queue_items
        WHERE organization_id = $1::uuid AND queue_type = 'sensitivity_review' AND target_object_id = $2::uuid`, [organizationId, profileId]);
    return row || null;
  }
  async function decisionRows(profileId, organizationId = ORG_A) {
    return query(
      `SELECT decision_outcome, decided_by::text, decided_by_role FROM kai.intake_sensitivity_review_decisions
        WHERE organization_id = $1::uuid AND intake_sensitivity_profile_id = $2::uuid ORDER BY created_at`, [organizationId, profileId]);
  }
  async function candidateFor(profileId, organizationId = ORG_A) {
    const [row] = await query(
      `SELECT c.intake_source_candidate_id::text, c.candidate_status, c.created_by::text, q.review_queue_item_id::text AS queue_item, q.queue_status
         FROM kai.intake_source_candidates c
         LEFT JOIN kai.review_queue_items q ON q.organization_id = c.organization_id AND q.queue_type = 'source_candidate_review'
          AND q.target_object_id = c.intake_source_candidate_id
        WHERE c.organization_id = $1::uuid AND c.intake_sensitivity_profile_id = $2::uuid`, [organizationId, profileId]);
    return row || null;
  }
  async function evidenceForCandidate(candidateId, organizationId = ORG_A) {
    return query(
      `SELECT e.evidence_item_id::text, e.statement, e.evidence_review_status, q.review_queue_item_id::text AS queue_item, q.queue_status, q.updated_at
         FROM kai.source_versions v
         JOIN kai.evidence_items e ON e.organization_id = v.organization_id AND e.source_version_id = v.source_version_id
         JOIN kai.review_queue_items q ON q.organization_id = e.organization_id AND q.queue_type = 'evidence_review' AND q.target_object_id = e.evidence_item_id
        WHERE v.organization_id = $1::uuid AND v.intake_source_candidate_id = $2::uuid ORDER BY e.evidence_item_id`, [organizationId, candidateId]);
  }
  async function auditActions(actorKaiUserId) {
    return (await query("SELECT action FROM kai.audit_events WHERE actor_user_id = $1::uuid ORDER BY audit_event_id", [actorKaiUserId])).map((row) => row.action);
  }
  function findFile(data, intakeFileId) {
    let found = null;
    const walk = (value) => {
      if (found || !value || typeof value !== "object") return;
      if (value.intakeFileId === intakeFileId && typeof value.currentStage !== "undefined") { found = value; return; }
      for (const child of Array.isArray(value) ? value : Object.values(value)) walk(child);
    };
    walk(data);
    return found;
  }

  async function openKnowledgeStudio(page) {
    await page.goto("/impact-library");
    await page.waitForText("Knowledge Studio");
    await page.clickNav("Knowledge Studio");
    await page.waitFor(async () => page.evaluate(`Boolean(document.querySelector(".nav-tabs"))`), "Knowledge Studio tabs");
    await page.idle();
  }
  // GK Knowledge Studio -> Reviews -> the Review Queue sensitivity entry ->
  // the Processing card, then 'reviewed' through the existing decision route.
  async function reviewFromGkQueue(page, profileId) {
    await openKnowledgeStudio(page);
    await page.clickTab("Reviews");
    await page.waitForText("Sensitivity / allowed-use");
    await page.waitFor(() => page.visibleButton("Review sensitivity & allowed use"), "the Review Queue sensitivity entry");
    await page.clickButton("Review sensitivity & allowed use");
    await page.waitFor(() => page.visibleButton("Submit review"), "the sensitivity review card's decision form", { timeout: 8000 });
    await page.idle();
    await page.setFormRow("Personal data", "present");
    await page.setFormRow("Minor data", "absent");
    const mark = page.mark();
    await page.clickButton("Submit review");
    await page.waitForText("Review recorded.");
    await page.idle();
    assert.deepEqual(writes(page.requestsSince(mark)), [["POST", `${COCKPIT}/sensitivity-profiles/${profileId}/decision`, 200]],
      "exactly the existing decision route");
  }
  async function decideReviewedByApi(page, profileId) {
    const queue = await sensitivityQueue(profileId);
    return page.fetchJson("POST", decisionPath(profileId), {
      expected_updated_at: new Date(queue.updated_at).toISOString(),
      review_queue_item_id: queue.review_queue_item_id,
      decision: "reviewed",
      reviewed_snapshot: REVIEWED_SNAPSHOT,
    });
  }
  // Drives the GK review cockpit page to the open source-candidate item and
  // presses Promote; returns the requests issued after the press.
  async function promoteThroughCockpit(page, candidateId) {
    await page.goto("/gk-admin/kai-review-cockpit");
    await page.waitForText("KAI internal review cockpit");
    await page.waitFor(async () => page.evaluate(`(() => {
      const button = [...document.querySelectorAll("button")].find((el) => el.innerText.trim() === "Load queue");
      return Boolean(button && !button.disabled);
    })()`), "Load queue enabled (organization bootstrapped)");
    await page.selectByLabel("Queue type", "source_candidate_review");
    await page.selectByLabel("Queue status", "open");
    await page.clickButton("Load queue");
    await page.waitForText("source_candidate_review");
    await page.idle();
    const openRows = await page.evaluate(`[...document.querySelectorAll(".kai-cockpit-queue tbody tr")].length`);
    let found = false;
    for (let row = 0; row < openRows && !found; row += 1) {
      await page.evaluate(`document.querySelectorAll(".kai-cockpit-queue tbody tr")[${row}].querySelector("button").click()`);
      await page.idle();
      found = (await page.text()).includes(candidateId);
    }
    assert.ok(found, `the candidate ${candidateId} is in the open source_candidate_review queue (${openRows} open)`);
    // The decision controls render only when the detail reports
    // decision_controls_enabled; the submit label follows the chosen outcome.
    const hasOutcomeControl = await page.evaluate(`Boolean([...document.querySelectorAll("label")]
      .find((el) => el.innerText.trim().startsWith("Decision outcome") && el.querySelector("select")))`);
    if (!hasOutcomeControl) return { controlsOffered: false, requests: [] };
    await page.selectByLabel("Decision outcome", "promoted");
    await page.selectByLabel("Reviewed source type", "organization_primary_record");
    const controlsOffered = await page.visibleButton("Promote");
    if (!controlsOffered) return { controlsOffered, requests: [] };
    const mark = page.mark();
    await page.clickButton("Promote");
    await page.idle();
    await new Promise((r) => setTimeout(r, 300));
    return { controlsOffered, requests: page.requestsSince(mark) };
  }

  // GK Knowledge Studio -> Reviews -> Source review: opens the candidate's
  // open source_candidate_review entry and reports whether the server offered
  // this actor a decision form (decision_controls_enabled).
  async function openSourceReviewInStudio(page, candidateId) {
    await openKnowledgeStudio(page);
    await page.clickTab("Reviews");
    await page.waitForText("Source review");
    const entry = `document.querySelector('[data-source-candidate-id="${candidateId}"] button')`;
    await page.waitFor(async () => page.evaluate(`Boolean(${entry})`), `the open source candidate ${candidateId} in Source review`);
    await page.evaluate(`${entry}.click()`);
    await page.waitFor(async () => page.evaluate(`[...document.querySelectorAll(".kai-cockpit-detail")].some((el) => el.innerText.includes(${JSON.stringify(candidateId)}))`),
      "the candidate's source review detail");
    await page.idle();
    const controlsOffered = await page.evaluate(`Boolean([...document.querySelectorAll("label")]
      .find((el) => el.innerText.trim().startsWith("Decision outcome") && el.querySelector("select")))`);
    return { controlsOffered };
  }
  // Promotes the open candidate from the Studio's source review detail and
  // waits for the authoritative result; returns the requests after the press.
  async function promoteInStudio(page) {
    await page.selectByLabel("Decision outcome", "promoted");
    await page.selectByLabel("Reviewed source type", "organization_primary_record");
    assert.equal(await page.visibleButton("Promote"), true);
    const mark = page.mark();
    await page.clickButton("Promote");
    await page.waitForText("Recorded promoted.");
    await page.waitForText("This candidate already has a final source decision.");
    await page.idle();
    return page.requestsSince(mark);
  }
  async function promotionDecisionRow(candidateId, organizationId = ORG_A) {
    const [row] = await query(
      `SELECT d.decision_status, d.created_by::text AS decided_by, c.candidate_status, q.queue_status,
              v.is_current, d.source_version_id = v.source_version_id AS decided_version
         FROM kai.intake_promotion_decisions d
         JOIN kai.intake_source_candidates c ON c.organization_id = d.organization_id AND c.intake_source_candidate_id = d.intake_source_candidate_id
         JOIN kai.review_queue_items q ON q.organization_id = d.organization_id AND q.review_queue_item_id = d.review_queue_item_id
         LEFT JOIN kai.source_versions v ON v.organization_id = d.organization_id AND v.intake_source_candidate_id = d.intake_source_candidate_id
        WHERE d.organization_id = $1::uuid AND d.intake_source_candidate_id = $2::uuid`, [organizationId, candidateId]);
    return row || null;
  }
  async function currentSourceVersionCount(candidateId, organizationId = ORG_A) {
    return (await query(
      "SELECT count(*)::int AS count FROM kai.source_versions WHERE organization_id = $1::uuid AND intake_source_candidate_id = $2::uuid AND is_current",
      [organizationId, candidateId]))[0].count;
  }
  // The full UI promotion proof shared by J5-1 and J5-3.
  async function assertStudioPromotion(page, actorKey, candidate, label) {
    const candidateId = candidate.intake_source_candidate_id;
    const before = await allKaiCounts();
    const auditBefore = await auditActions(kaiUserIds[actorKey]);
    const { controlsOffered } = await openSourceReviewInStudio(page, candidateId);
    assert.equal(controlsOffered, true, `${label}: the server offers this authorized actor the P1-08 decision`);
    const requests = await promoteInStudio(page);
    assert.deepEqual(writes(requests), [["POST", candidateDecisionPath(candidateId).split("?")[0], 200]], `${label}: exactly the existing decision route`);
    const changed = changedTables(before, await allKaiCounts());
    for (const table of ["intake_promotion_decisions", "sources", "source_versions", "evidence_items", "audit_events"]) {
      assert.ok(changed.includes(table), `${label}: ${table} written`);
    }
    const decision = await promotionDecisionRow(candidateId);
    assert.deepEqual(
      [decision.decision_status, decision.decided_by, decision.candidate_status, decision.queue_status, decision.is_current, decision.decided_version],
      ["promoted", kaiUserIds[actorKey], "promoted", "resolved", true, true],
      `${label}: decision, attribution, candidate, queue, and current version`,
    );
    assert.equal(await currentSourceVersionCount(candidateId), 1, `${label}: exactly one current source version`);
    const newAudit = (await auditActions(kaiUserIds[actorKey])).slice(auditBefore.length);
    assert.ok(newAudit.length > 0, `${label}: audited as this actor`);
    const evidence = await evidenceForCandidate(candidateId);
    assert.equal(evidence.length, 2, `${label}: P2-01 created the evidence`);
    for (const row of evidence) assert.deepEqual([row.evidence_review_status, row.queue_status], ["needs_gk_review", "open"]);
    const pageText = await page.text();
    assert.ok(pageText.includes("2 evidence item(s) created, awaiting GK evidence review."), `${label}: the P2-01 outcome is reported`);
    assert.ok(!(await page.evaluate(`Boolean(document.querySelector('[data-source-candidate-id="${candidateId}"]'))`)), `${label}: the decided candidate leaves the open list`);
    return { changed, newAudit };
  }

  const results = {};
  const pages = [];
  const session = async (legacyUserId) => {
    const page = await openPage(browser, { baseUrl, legacyUserId });
    pages.push(page);
    // A same-origin document (no KAI request) so direct-route checks can
    // fetch before the actor's first product page load.
    await page.goto("/");
    return page;
  };
  try {
    const superGkPage = await session(USERS.superGk);
    const superNoRolePage = await session(USERS.superNoRole);
    const storedAdminPage = await session(USERS.storedAdmin);

    // =====================================================================
    // J1. Working GK baseline
    // =====================================================================
    await test("J1-1: the working superuser review: GK Studio sensitivity review -> decision -> P1-07 candidate; admitted by global gk_admin + derived membership", async () => {
      await openReviewWork(ORG_A, profiles.superGk);
      await superGkPage.goto("/impact-library");
      await superGkPage.waitForText("Knowledge Studio");
      const access = await superGkPage.fetchJson("GET", accessCapabilitiesPath(ORG_A));
      const cockpit = await superGkPage.fetchJson("GET", cockpitCapabilitiesPath(ORG_A));
      assert.deepEqual([access.status, access.data.internalKnowledgeWorkspace, cockpit.data.can_manage_sensitivity_review], [200, true, true]);
      const before = await allKaiCounts();
      await reviewFromGkQueue(superGkPage, profiles.superGk);
      assert.deepEqual(await decisionRows(profiles.superGk), [{ decision_outcome: "reviewed", decided_by: kaiUserIds.superGk, decided_by_role: "gk_admin" }]);
      const candidate = await candidateFor(profiles.superGk);
      assert.deepEqual([candidate.candidate_status, candidate.created_by, candidate.queue_status], ["needs_gk_review", kaiUserIds.superGk, "open"]);
      assert.deepEqual(changedTables(before, await allKaiCounts()),
        ["audit_events", "intake_sensitivity_review_decisions", "intake_source_candidates", "review_queue_items", "upload_lifecycle_audit"]);
      results.J1_1 = "PASS: reviewed by superuser as gk_admin (global role; membership = derived client_admin); P1-07 candidate + open source_candidate_review item";
    });

    await test("J1-2: a platform superuser without a GK role mounts the GK Studio, but every sensitivity route refuses them, writing nothing", async () => {
      await superNoRolePage.goto("/impact-library");
      await superNoRolePage.waitForText("Knowledge Studio");
      const access = await superNoRolePage.fetchJson("GET", accessCapabilitiesPath(ORG_A));
      const cockpit = await superNoRolePage.fetchJson("GET", cockpitCapabilitiesPath(ORG_A));
      const before = await allKaiCounts();
      const decision = await superNoRolePage.fetchJson("POST", decisionPath(profiles.probe), FAKE_DECISION_BODY);
      const work = await superNoRolePage.fetchJson("POST", reviewWorkPath(profiles.probe), {});
      await assertNothingWritten(before, "superuser without GK role");
      results.J1_2 = {
        internalKnowledgeWorkspace: access.data?.internalKnowledgeWorkspace,
        cockpit: cockpit.data?.can_manage_sensitivity_review,
        decision: [decision.status, decision.errorCode, decision.blockingReason],
        reviewWork: [work.status, work.errorCode, work.blockingReason],
      };
      console.log(`[campaign] J1-2 superuser without GK role: ${JSON.stringify(results.J1_2)}`);
      assert.equal(access.data.internalKnowledgeWorkspace, true, "the GK Studio mounts (full-request actor carries site-admin authority)");
      assert.equal(cockpit.data.can_manage_sensitivity_review, false, "the cockpit (id-only actor) does not carry it");
      assert.equal(decision.status, 403);
      assert.equal(work.status, 403);
    });

    // =====================================================================
    // J2. GK reviewer provisioning through the governed routes
    // =====================================================================
    await test("J2-0: a never-provisioned account's first KAI request is an id-only route: it must provision (or refuse) consistently with the email-forwarding routes", async () => {
      // Mirrors, for new rows only, the USER_CONFIRMED deployed contract that
      // kai.users.email is NOT NULL (this plan, 2026-09-24); removed below.
      await query("ALTER TABLE kai.users ADD CONSTRAINT campaign_mirror_users_email_not_null CHECK (email IS NOT NULL) NOT VALID");
      const outcomes = {};
      try {
        const freshPage = await session(USERS.freshNotNull);
        outcomes.organizationsFirst = await freshPage.fetchJson("GET", `${INTAKE}/admin/organizations`);
        outcomes.rowAfterOrganizations = (await query("SELECT email FROM kai.users WHERE legacy_public_userdata_id = $1", [USERS.freshNotNull]))[0] ?? null;
        outcomes.onboardingStatus = await freshPage.fetchJson("GET", `${INTAKE}/admin/organization-onboarding/status`);
        outcomes.organizationsSecond = await freshPage.fetchJson("GET", `${INTAKE}/admin/organizations`);
        outcomes.rowAfterOnboarding = (await query("SELECT email FROM kai.users WHERE legacy_public_userdata_id = $1", [USERS.freshNotNull]))[0] ?? null;
      } finally {
        await query("ALTER TABLE kai.users DROP CONSTRAINT campaign_mirror_users_email_not_null");
      }
      // Under the nullable mirror the same id-only first request persists a
      // NULL email that no later sign-in fills (existing rows are returned as-is).
      const nullablePage = await session(USERS.freshNullable);
      outcomes.nullableOrganizationsFirst = (await nullablePage.fetchJson("GET", `${INTAKE}/admin/organizations`)).status;
      outcomes.nullableRow = (await query("SELECT email FROM kai.users WHERE legacy_public_userdata_id = $1", [USERS.freshNullable]))[0] ?? null;
      await nullablePage.fetchJson("GET", `${INTAKE}/admin/organization-onboarding/status`);
      outcomes.nullableRowAfterOnboarding = (await query("SELECT email FROM kai.users WHERE legacy_public_userdata_id = $1", [USERS.freshNullable]))[0] ?? null;
      results.J2_0 = {
        notNullMirror: {
          organizationsFirst: [outcomes.organizationsFirst.status, outcomes.organizationsFirst.errorCode],
          rowAfterOrganizations: outcomes.rowAfterOrganizations,
          onboardingStatus: outcomes.onboardingStatus.status,
          organizationsSecond: outcomes.organizationsSecond.status,
          rowAfterOnboarding: outcomes.rowAfterOnboarding,
        },
        nullableMirror: { organizationsFirst: outcomes.nullableOrganizationsFirst, row: outcomes.nullableRow, rowAfterOnboarding: outcomes.nullableRowAfterOnboarding },
      };
      console.log(`[campaign] J2-0 first KAI request on an id-only route: ${JSON.stringify(results.J2_0)}`);
      assert.equal(outcomes.organizationsFirst.status, 200, "a signed-in account's first KAI request is not refused for lack of a forwarded email");
      assert.equal(outcomes.nullableRow?.email, email(USERS.freshNullable), "an id-only first request never persists a KAI identity without the account email");
    });

    const reviewerPage = await session(USERS.reviewer);
    await test("J2-1: first sign-in provisions the reviewer's KAI identity with their account email and no access", async () => {
      await reviewerPage.goto("/impact-library");
      await reviewerPage.idle();
      const [mapping] = await query("SELECT user_id::text, status, email FROM kai.users WHERE legacy_public_userdata_id = $1", [USERS.reviewer]);
      kaiUserIds.reviewer = mapping.user_id;
      const organizations = await reviewerPage.fetchJson("GET", `${INTAKE}/admin/organizations`);
      const cockpit = await reviewerPage.fetchJson("GET", cockpitCapabilitiesPath(ORG_A));
      results.J2_1 = { status: mapping.status, email: mapping.email, organizations: organizations.data?.items?.length, cockpit: cockpit.data?.can_manage_sensitivity_review,
        firstLoadKaiRequests: reviewerPage.requests().slice(0, 6).map((r) => [r.method, pathOf(r), r.status]) };
      console.log(`[campaign] J2-1 first sign-in: ${JSON.stringify(results.J2_1)}`);
      // Every concurrent first-load KAI request forwards the account email
      // (J2-0 isolates the id-only route), so whichever provisions wins.
      assert.equal(mapping.status, "active");
      assert.equal(mapping.email, email(USERS.reviewer), "a real first page load provisions the account email");
      assert.deepEqual([organizations.data.items.length, cockpit.data.can_manage_sensitivity_review], [0, false]);
    });

    await test("J2-2: global-only state: the superuser grants global gk_reviewer (governed route, audited); the reviewer still has no organization and no review access", async () => {
      const before = await allKaiCounts();
      const grant = await superGkPage.fetchJson("PUT", globalRolePath(USERS.reviewer), { role_name: "gk_reviewer", action: "assign" });
      assert.equal(grant.status, 200, JSON.stringify(grant));
      assert.deepEqual(changedTables(before, await allKaiCounts()), ["audit_events", "user_roles"]);
      assert.ok((await auditActions(kaiUserIds.superGk)).includes("global_kai_role_assigned"));
      const organizations = await reviewerPage.fetchJson("GET", `${INTAKE}/admin/organizations`);
      const access = await reviewerPage.fetchJson("GET", accessCapabilitiesPath(ORG_A));
      const cockpit = await reviewerPage.fetchJson("GET", cockpitCapabilitiesPath(ORG_A));
      const probeBefore = await allKaiCounts();
      const work = await reviewerPage.fetchJson("POST", reviewWorkPath(profiles.probe), {});
      await assertNothingWritten(probeBefore, "global-only reviewer");
      results.J2_2 = { organizations: organizations.data?.items?.length, access: [access.status, access.blockingReason], cockpit: cockpit.data?.can_manage_sensitivity_review, reviewWork: [work.status, work.blockingReason] };
      console.log(`[campaign] J2-2 global-only: ${JSON.stringify(results.J2_2)}`);
      assert.equal(organizations.data.items.length, 0);
      assert.equal(access.status, 403);
      assert.equal(cockpit.data.can_manage_sensitivity_review, false);
      assert.deepEqual([work.status, work.blockingReason], [403, "missing_active_organization_membership"]);
    });

    await test("J2-3: full state: the superuser adds the gk_reviewer organization role (governed route, audited); the reviewer sees the organization and review capability", async () => {
      const before = await allKaiCounts();
      const grant = await superGkPage.fetchJson("PUT", membershipPath(ORG_A, USERS.reviewer), { role_name: "gk_reviewer", membership_status: "active" });
      assert.equal(grant.status, 200, JSON.stringify(grant));
      assert.deepEqual(changedTables(before, await allKaiCounts()), ["audit_events", "organization_memberships"]);
      assert.ok((await auditActions(kaiUserIds.superGk)).includes("organization_membership_assigned"));
      const organizations = await reviewerPage.fetchJson("GET", `${INTAKE}/admin/organizations`);
      const access = await reviewerPage.fetchJson("GET", accessCapabilitiesPath(ORG_A));
      const cockpit = await reviewerPage.fetchJson("GET", cockpitCapabilitiesPath(ORG_A));
      assert.deepEqual(organizations.data.items.map((item) => item.organization_id), [ORG_A]);
      assert.deepEqual([access.data.internalKnowledgeWorkspace, access.data.organizationAccessManagement, access.data.clientFollowupReview], [true, false, false]);
      assert.equal(cockpit.data.can_manage_sensitivity_review, true);
      const projects = await reviewerPage.fetchJson("GET", `${INTAKE}/admin/organizations/${ORG_A}/engagements`);
      assert.equal(projects.status, 200);
      assert.ok(projects.data.items.some((p) => p.engagement_id === PROJECT_A));
      assert.equal(access.data.projectManagement, false, "selecting a project grants no mutation");
      results.J2_3 = "PASS: organization ORG_A listed; GK Studio; cockpit capability; no Team & Access or follow-up capability";
    });

    await test("J2-4: the provisioned reviewer completes a sensitivity review in the GK Studio; decision, audit, and the P1-07 handoff persist; the client sees Source review waiting", async () => {
      await openReviewWork(ORG_A, profiles.reviewer);
      const before = await allKaiCounts();
      await reviewFromGkQueue(reviewerPage, profiles.reviewer);
      assert.deepEqual(await decisionRows(profiles.reviewer), [{ decision_outcome: "reviewed", decided_by: kaiUserIds.reviewer, decided_by_role: "gk_reviewer" }]);
      const candidate = await candidateFor(profiles.reviewer);
      assert.deepEqual([candidate.candidate_status, candidate.created_by, candidate.queue_status], ["needs_gk_review", kaiUserIds.reviewer, "open"]);
      assert.deepEqual(changedTables(before, await allKaiCounts()),
        ["audit_events", "intake_sensitivity_review_decisions", "intake_source_candidates", "review_queue_items", "upload_lifecycle_audit"]);
      // The viewer is the organization's stored client_admin, which now holds
      // the P1-08 step itself (owner decision 2026-10-19).
      const pipeline = await storedAdminPage.fetchJson("GET", pipelinePath());
      const file = findFile(pipeline.data, FILES.reviewer);
      assert.deepEqual([file.currentStage, file.responsibleParty, file.nextAction], ["source_review", "client", "promote_source"]);
      results.J2_4 = `PASS: reviewed by reviewer (gk_reviewer); candidate ${candidate.intake_source_candidate_id}; client pipeline source_review, the organization administrator's promote_source`;
    });

    const reviewerOrgOnlyPage = await session(USERS.reviewerOrgOnly);
    await test("J2-5: organization-only state: gk_reviewer organization role granted before first sign-in; GK Studio and P1-06 review work, but no sensitivity decision", async () => {
      const grant = await superGkPage.fetchJson("PUT", membershipPath(ORG_A, USERS.reviewerOrgOnly), { role_name: "gk_reviewer", membership_status: "active" });
      assert.equal(grant.status, 200, JSON.stringify(grant));
      await reviewerOrgOnlyPage.goto("/impact-library");
      await reviewerOrgOnlyPage.idle();
      const [mapping] = await query("SELECT user_id::text, status, email FROM kai.users WHERE legacy_public_userdata_id = $1", [USERS.reviewerOrgOnly]);
      kaiUserIds.reviewerOrgOnly = mapping.user_id;
      const access = await reviewerOrgOnlyPage.fetchJson("GET", accessCapabilitiesPath(ORG_A));
      const cockpit = await reviewerOrgOnlyPage.fetchJson("GET", cockpitCapabilitiesPath(ORG_A));
      const before = await allKaiCounts();
      const decision = await reviewerOrgOnlyPage.fetchJson("POST", decisionPath(profiles.probe), FAKE_DECISION_BODY);
      await assertNothingWritten(before, "organization-only reviewer decision");
      const work = await reviewerOrgOnlyPage.fetchJson("POST", reviewWorkPath(profiles.probe), {});
      results.J2_5 = { email: mapping.email, internalKnowledgeWorkspace: access.data?.internalKnowledgeWorkspace, cockpit: cockpit.data?.can_manage_sensitivity_review,
        decision: [decision.status, decision.blockingReason], reviewWork: [work.status, work.data?.replayed] };
      console.log(`[campaign] J2-5 organization-only: ${JSON.stringify(results.J2_5)}`);
      assert.equal(mapping.email, email(USERS.reviewerOrgOnly));
      assert.equal(access.data.internalKnowledgeWorkspace, true);
      assert.equal(cockpit.data.can_manage_sensitivity_review, false);
      assert.deepEqual([decision.status, decision.blockingReason], [403, "role_not_allowed"]);
      assert.equal(work.status, 201, "P1-06 keeps organization GK-role admission (2026-10-11 owner decision)");
    });

    // =====================================================================
    // J3. Mixed-role reviewer: global gk_reviewer + client_admin membership
    // =====================================================================
    const mixedPage = await session(USERS.mixed);
    await test("J3-1: the mixed-role reviewer (granted global gk_reviewer by the governed route) gets the GK Studio, the sensitivity capability, and completes the decision with handoff", async () => {
      const grant = await superGkPage.fetchJson("PUT", globalRolePath(USERS.mixed), { role_name: "gk_reviewer", action: "assign" });
      assert.equal(grant.status, 200);
      await mixedPage.goto("/impact-library");
      await mixedPage.waitForText("Knowledge Studio");
      const access = await mixedPage.fetchJson("GET", accessCapabilitiesPath(ORG_A));
      const cockpit = await mixedPage.fetchJson("GET", cockpitCapabilitiesPath(ORG_A));
      assert.deepEqual([access.data.internalKnowledgeWorkspace, cockpit.data.can_manage_sensitivity_review], [true, true]);
      await openReviewWork(ORG_A, profiles.mixed);
      const decided = await decideReviewedByApi(mixedPage, profiles.mixed);
      assert.equal(decided.status, 200, JSON.stringify(decided));
      assert.equal(decided.data.source_candidate_handoff.status, "created");
      assert.deepEqual(await decisionRows(profiles.mixed), [{ decision_outcome: "reviewed", decided_by: kaiUserIds.mixed, decided_by_role: "gk_reviewer" }]);
      results.J3_1 = "PASS: GK Studio; cockpit capability; decision gk_reviewer; P1-07 created (client-Studio UI path itself proven by the reachability spec cases 10-11)";
    });

    // =====================================================================
    // J4. Bound organization administrator (binding-derived client_admin)
    // =====================================================================
    const boundAdminPage = await session(USERS.boundAdmin);
    await test("J3-1A: mixed GK reviewer and operator mount their workspace and all selected-view reads, with operation-specific controls", async () => {
      const grant = await superGkPage.fetchJson("PUT", globalRolePath(USERS.mixedOperator), { role_name: "gk_operator", action: "assign" });
      assert.equal(grant.status, 200);
      const operatorPage = await session(USERS.mixedOperator);
      for (const [page, reviewer] of [[mixedPage, true], [operatorPage, false]]) {
        const before = await allKaiCounts();
        const access = await page.fetchJson("GET", accessCapabilitiesPath(ORG_A));
        assert.equal(access.data.internalKnowledgeWorkspace, true);
        assert.equal(access.data.workflowOperations.recordEvidenceReview, reviewer);
        assert.equal(access.data.workflowOperations.recordClaimReview, reviewer);
        // Both hold an organization client_admin membership, which admits
        // P2-01 extraction and P2-03 proposal (owner decision 2026-10-18);
        // P2-02 coverage and P2-10 acceptance stay organization-GK only.
        for (const operation of ["extractEvidence", "proposeClaim"]) {
          assert.equal(access.data.workflowOperations[operation], true, operation);
        }
        for (const operation of ["assessEvidenceCoverage", "acceptCoverageLimitation"]) {
          assert.equal(access.data.workflowOperations[operation], false, operation);
        }
        for (const suffix of ["engagements", "claim-library/candidates", "evidence-library/candidates", "sources", "requirements", "review-queue", `engagements/${PROJECT_A}/funder-requirements`]) {
          const read = await page.fetchJson("GET", `${INTAKE}/admin/organizations/${ORG_A}/${suffix}`);
          assert.equal(read.status, 200, `${suffix}: ${JSON.stringify(read)}`);
        }
        await openKnowledgeStudio(page);
        await page.selectProject(PROJECT_A);
        await page.clickTab("Evidence");
        await page.idle();
        assert.equal(await page.evaluate('document.getElementById("gk-shell-project-select").value'), PROJECT_A);
        for (const label of ["View coverage assessment", "Accept internal limitation for selected dimension"]) {
          assert.equal(await page.visibleButton(label), false, label);
        }
        await assertNothingWritten(before, "mixed GK workspace and readback");
        const cross = await page.fetchJson("GET", accessCapabilitiesPath(ORG_B));
        assert.equal(cross.status, 403);
      }
      // A failed or malformed refresh is unknown, never a confirmed client.
      for (const malformed of [false, true]) {
        await mixedPage.activate();
        await mixedPage.idle();
        await new Promise((resolve) => setTimeout(resolve, 1100));
        await mixedPage.evaluate(`(() => { const original = window.fetch; window.restoreAccessFetch = () => { window.fetch = original; };
          window.fetch = (...args) => String(args[0]).includes('/access-capabilities')
            ? Promise.resolve(new Response(JSON.stringify(${malformed ? '{ ok: true, data: {} }' : '{ ok: false }'}), { status: ${malformed ? 200 : 503}, headers: { 'Content-Type': 'application/json' } }))
            : original(...args);
          window.dispatchEvent(new Event('focus'));
        })()`);
        try {
          await mixedPage.waitForText("Workspace access could not be confirmed.");
          assert.equal(await mixedPage.evaluate('Boolean(document.querySelector(".nav-tabs"))'), false);
        } finally {
          await mixedPage.evaluate("window.restoreAccessFetch()");
        }
        await mixedPage.clickButton("Retry access check");
        await mixedPage.waitFor(async () => mixedPage.evaluate('Boolean(document.querySelector(".nav-tabs"))'), "workspace restored from authoritative capabilities");
      }
    });

    await test("J4-1: the bound organization administrator starts review work and records 'reviewed' from client Knowledge Studio Reviews; attributed client_admin; P1-07 created by them", async () => {
      await boundAdminPage.goto("/impact-library");
      await boundAdminPage.waitForText("Knowledge Studio");
      const access = await boundAdminPage.fetchJson("GET", accessCapabilitiesPath(ORG_A));
      const cockpit = await boundAdminPage.fetchJson("GET", cockpitCapabilitiesPath(ORG_A));
      assert.deepEqual([access.data.internalKnowledgeWorkspace, access.data.organizationAccessManagement, cockpit.data.can_manage_sensitivity_review], [false, true, true]);
      await openKnowledgeStudio(boundAdminPage);
      await boundAdminPage.waitFor(async () => boundAdminPage.evaluate(`Boolean(document.getElementById("gk-shell-project-select"))`), "project selector");
      await boundAdminPage.selectProject(PROJECT_A);
      await boundAdminPage.waitFor(async () => Boolean(await boundAdminPage.pipelineFileText(FILES.bound)), "pipeline entry");
      await boundAdminPage.clickTab("Reviews");
      await boundAdminPage.waitFor(async () => (await boundAdminPage.fileReviewActionIds()).includes(FILES.bound), "the bound file's review action");
      const reviewsText = await boundAdminPage.text();
      results.J4_1_access_text = (reviewsText.match(/Your [^\n]*sensitivity reviews here[^\n]*/) || [null])[0];
      console.log(`[campaign] J4-1 bound admin access text: ${results.J4_1_access_text}`);
      await boundAdminPage.clickFileReviewAction(FILES.bound);
      await boundAdminPage.waitFor(() => boundAdminPage.visibleButton("Start review work"), "the explicit start action");
      let mark = boundAdminPage.mark();
      await boundAdminPage.clickButton("Start review work");
      await boundAdminPage.waitFor(() => boundAdminPage.visibleButton("Submit review"), "decision form after review work");
      await boundAdminPage.idle();
      assert.deepEqual(writes(boundAdminPage.requestsSince(mark)), [["POST", `${COCKPIT}/sensitivity-profiles/${profiles.bound}/review-work`, 201]]);
      await boundAdminPage.setFormRow("Personal data", "present");
      await boundAdminPage.setFormRow("Minor data", "absent");
      const before = await allKaiCounts();
      mark = boundAdminPage.mark();
      await boundAdminPage.clickButton("Submit review");
      await boundAdminPage.waitForText("Sensitivity decision recorded.");
      await boundAdminPage.idle();
      assert.deepEqual(writes(boundAdminPage.requestsSince(mark)), [["POST", `${COCKPIT}/sensitivity-profiles/${profiles.bound}/decision`, 200]]);
      assert.deepEqual(await decisionRows(profiles.bound), [{ decision_outcome: "reviewed", decided_by: kaiUserIds.boundAdmin, decided_by_role: "client_admin" }]);
      const candidate = await candidateFor(profiles.bound);
      assert.deepEqual([candidate.candidate_status, candidate.created_by, candidate.queue_status], ["needs_gk_review", kaiUserIds.boundAdmin, "open"]);
      assert.deepEqual(changedTables(before, await allKaiCounts()),
        ["audit_events", "intake_sensitivity_review_decisions", "intake_source_candidates", "review_queue_items", "upload_lifecycle_audit"]);
      assert.ok((await boundAdminPage.text()).includes("Source-candidate handoff completed"));
      assert.deepEqual(boundAdminPage.exceptions, []);
      results.J4_1 = "PASS: client Studio panel -> review-work 201 -> decision 200 (client_admin) -> P1-07 candidate created by the bound admin";
    });

    await test("J4-2: the bound administrator may decide its organization's source candidate (owner decision 2026-10-18) but not list the GK source review queue; reads write nothing", async () => {
      const candidate = await candidateFor(profiles.bound);
      const before = await allKaiCounts();
      const queue = await boundAdminPage.fetchJson("GET", sourceQueuePath());
      const detail = await boundAdminPage.fetchJson("GET", candidatePath(candidate.intake_source_candidate_id));
      await assertNothingWritten(before, "bound administrator source review reads");
      results.J4_2 = { queue: queue.status, detail: [detail.status, detail.data?.decision_controls_enabled] };
      console.log(`[campaign] J4-2 bound admin source review: ${JSON.stringify(results.J4_2)}`);
      // The promotion itself is proven by kai-client-admin-source-promotion-browser-acceptance;
      // it is not made here so this candidate stays pending for J5-5.
      assert.deepEqual([queue.status, detail.status, detail.data.decision_controls_enabled], [403, 200, true]);
    });

    await test("J4-3: a stored-only client_admin (no binding) holds its organization's sensitivity authority (owner decision 2026-10-19); a forged decision is still refused and writes nothing", async () => {
      const cockpit = await storedAdminPage.fetchJson("GET", cockpitCapabilitiesPath(ORG_A));
      const before = await allKaiCounts();
      // A fabricated queue item and stamp: admitted as administrator, refused by the ledger.
      const decision = await storedAdminPage.fetchJson("POST", decisionPath(profiles.probe), FAKE_DECISION_BODY);
      await assertNothingWritten(before, "stored client_admin forged decision");
      assert.equal(cockpit.data.can_manage_sensitivity_review, true);
      // Refused by the decision ledger's own checks of the forged item, not by role.
      assert.notEqual(decision.status, 200);
      assert.notEqual(decision.blockingReason, "role_not_allowed", JSON.stringify(decision));
      assert.notEqual(decision.blockingReason, "missing_active_organization_membership", JSON.stringify(decision));
      results.J4_3 = `PASS: capability true; forged decision ${decision.status} ${decision.errorCode} (not a role refusal); nothing written`;
    });

    // =====================================================================
    // J5. Downstream GK review: P1-08 source review and promotion
    // =====================================================================
    await test("J5-1: the provisioned non-superuser GK reviewer discovers, opens, and promotes the pending source candidate in the GK Studio; decision, attribution, lineage, audit, and P2-01 evidence persist", async () => {
      const candidate = await candidateFor(profiles.reviewer);
      const { changed, newAudit } = await assertStudioPromotion(reviewerPage, "reviewer", candidate, "J5-1");
      // The client's own pipeline moves past source review to the next actual stage.
      const pipeline = await storedAdminPage.fetchJson("GET", pipelinePath());
      const file = findFile(pipeline.data, FILES.reviewer);
      assert.deepEqual([file.currentStage, file.responsibleParty], ["evidence_review", "get_kinder"]);
      // The administrative cockpit page keeps its site-admin gate.
      await reviewerPage.goto("/gk-admin/kai-review-cockpit");
      const cockpitPageLandedOn = await reviewerPage.pathname();
      assert.equal(cockpitPageLandedOn, "/");
      assert.deepEqual(reviewerPage.exceptions, []);
      results.J5_1 = { changed, newAudit, clientStage: [file.currentStage, file.responsibleParty], cockpitPageLandedOn };
      console.log(`[campaign] J5-1 GK reviewer source review in the Studio: ${JSON.stringify(results.J5_1)}`);
    });

    await test("J5-2: the same reviewer's direct P1-08 request after the UI promotion is an authorized identical replay: detail reports the final decision with no controls, lineage is current, and the replay writes nothing", async () => {
      const candidate = await candidateFor(profiles.reviewer);
      assert.deepEqual([candidate.candidate_status, candidate.queue_status], ["promoted", "resolved"]);
      const queue = await reviewerPage.fetchJson("GET", sourceQueuePath());
      assert.equal(queue.status, 200);
      assert.ok(!queue.data.items.some((item) => item.target_object_id === candidate.intake_source_candidate_id && item.queue_status === "open"), "no longer open work");
      const detail = await reviewerPage.fetchJson("GET", candidatePath(candidate.intake_source_candidate_id));
      assert.deepEqual([detail.status, detail.data.promotion_decision.decision_status, detail.data.decision_controls_enabled], [200, "promoted", false]);
      const [lineage] = await query(
        `SELECT v.is_current, d.source_version_id = v.source_version_id AS decided, d.created_by::text AS decided_by
           FROM kai.source_versions v JOIN kai.intake_promotion_decisions d ON d.organization_id = v.organization_id
            AND d.intake_source_candidate_id = v.intake_source_candidate_id
          WHERE v.organization_id = $1::uuid AND v.intake_source_candidate_id = $2::uuid`, [ORG_A, candidate.intake_source_candidate_id]);
      assert.deepEqual([lineage.is_current, lineage.decided, lineage.decided_by], [true, true, kaiUserIds.reviewer]);
      const replayBefore = await allKaiCounts();
      const replay = await reviewerPage.fetchJson("POST", candidateDecisionPath(candidate.intake_source_candidate_id), PROMOTE_BODY);
      assert.deepEqual([replay.status, replay.data?.replayed, replay.data?.evidence_extraction_handoff?.status], [200, true, "replayed"]);
      await assertNothingWritten(replayBefore, "P1-08 replay");
      assert.equal(await currentSourceVersionCount(candidate.intake_source_candidate_id), 1);
      results.J5_2 = "PASS: detail final with no controls; lineage current and attributed to the reviewer; identical replay 200 replayed, handoff replayed, nothing written";
    });

    const gkOperatorPage = await session(USERS.gkOperator);
    await test("J5-3: an organization + global gk_operator (not a site admin) discovers, opens, and completes source review in the GK Studio, attributed to them", async () => {
      const candidate = await candidateFor(profiles.superGk);
      const { changed, newAudit } = await assertStudioPromotion(gkOperatorPage, "gkOperator", candidate, "J5-3");
      await gkOperatorPage.goto("/gk-admin/kai-review-cockpit");
      const cockpitPageLandedOn = await gkOperatorPage.pathname();
      assert.equal(cockpitPageLandedOn, "/", "the administrative cockpit page keeps its site-admin gate");
      assert.deepEqual(gkOperatorPage.exceptions, []);
      results.J5_3 = { changed, newAudit, cockpitPageLandedOn };
      console.log(`[campaign] J5-3 gk_operator source review in the Studio: ${JSON.stringify(results.J5_3)}`);
    });

    await test("J5-4: a superuser with global gk_admin and only a derived client_admin membership: the global role adds no P1-08 authority, and the binding-derived administrator half admits the decision (owner decision 2026-10-18); reads write nothing", async () => {
      const candidate = await candidateFor(profiles.mixed);
      assert.deepEqual([candidate.candidate_status, candidate.queue_status], ["needs_gk_review", "open"], "a pending candidate");
      const before = await allKaiCounts();
      const studio = await openSourceReviewInStudio(superGkPage, candidate.intake_source_candidate_id);
      const detail = await superGkPage.fetchJson("GET", candidatePath(candidate.intake_source_candidate_id));
      await assertNothingWritten(before, "superuser source review reads");
      results.J5_4 = { studioControlsOffered: studio.controlsOffered, detail: [detail.status, detail.data?.decision_controls_enabled] };
      console.log(`[campaign] J5-4 superuser (global gk_admin, derived client_admin): ${JSON.stringify(results.J5_4)}`);
      assert.equal(studio.controlsOffered, true, "the decision form follows P1-08's own answer");
      assert.deepEqual([detail.status, detail.data.decision_controls_enabled], [200, true]);
      // No decision is made here: the candidate stays pending for J5-5.
    });

    const superGkStoredPage = await session(USERS.superGkStored);
    await test("J5-5: the only working UI path - a superuser with global gk_admin AND a gk_reviewer organization role - promotes the bound admin's candidate in the cockpit", async () => {
      const grant = await superGkPage.fetchJson("PUT", membershipPath(ORG_A, USERS.superGkStored), { role_name: "gk_reviewer", membership_status: "active" });
      assert.equal(grant.status, 200);
      const candidate = await candidateFor(profiles.bound);
      const before = await allKaiCounts();
      const { controlsOffered, requests } = await promoteThroughCockpit(superGkStoredPage, candidate.intake_source_candidate_id);
      assert.equal(controlsOffered, true);
      assert.deepEqual(writes(requests), [["POST", candidateDecisionPath(candidate.intake_source_candidate_id).split("?")[0], 200]]);
      await superGkStoredPage.waitForText("Recorded promoted.");
      assert.ok(changedTables(before, await allKaiCounts()).includes("evidence_items"));
      const evidence = await evidenceForCandidate(candidate.intake_source_candidate_id);
      assert.equal(evidence.length, 2);
      results.J5_5 = "PASS: cockpit Promote 200 -> P2-01 created 2 evidence items for the bound admin's candidate";
    });

    await test("J5-6: the reviewer completes P2-12 evidence review in the GK Studio Evidence tab; the claim-proposal handoff creates a review-gated claim", async () => {
      const candidate = await candidateFor(profiles.reviewer);
      const [first] = await evidenceForCandidate(candidate.intake_source_candidate_id);
      await openKnowledgeStudio(reviewerPage);
      await reviewerPage.clickTab("Evidence");
      await reviewerPage.waitForText(first.statement);
      await reviewerPage.idle();
      assert.ok(await reviewerPage.clickInEvidenceItem(first.evidence_item_id, "Review evidence"), "Review evidence offered");
      await reviewerPage.waitFor(async () => reviewerPage.evaluate(`Boolean(document.querySelector('[aria-label="Evidence review"]'))`), "review panel");
      assert.ok(await reviewerPage.evaluate(`(() => { const el = document.getElementById("evidence-library-review-decision-supported"); if (!el) return false; el.click(); return el.checked; })()`));
      const before = await allKaiCounts();
      const mark = reviewerPage.mark();
      assert.ok(await reviewerPage.clickInEvidenceItem(first.evidence_item_id, "Record Evidence Review Decision"));
      await reviewerPage.waitForText("Evidence review decision recorded: supported.");
      await reviewerPage.idle();
      const posted = writes(reviewerPage.requestsSince(mark));
      assert.equal(posted.length, 1, "the browser records exactly one evidence decision");
      assert.deepEqual([posted[0][0], posted[0][2]], ["POST", 200]);
      const postedMatch = /\/evidence-items\/([0-9a-f-]+)\/evidence-review\/([0-9a-f-]+)\/complete$/.exec(posted[0][1]);
      assert.ok(postedMatch, "the browser used the governed evidence-review route");
      const reviewedEvidenceId = postedMatch[1];
      assert.equal(reviewedEvidenceId, first.evidence_item_id, "the reviewer file's own evidence item was reviewed");
      const changed = changedTables(before, await allKaiCounts());
      console.log(`[campaign] J5-6 evidence review changed tables: ${JSON.stringify(changed)}`);
      const [claim] = await query("SELECT claim_id::text, created_by::text FROM kai.claims WHERE organization_id = $1::uuid AND evidence_item_id = $2::uuid", [ORG_A, reviewedEvidenceId]);
      assert.ok(claim, "a review-gated claim was proposed");
      const [decision] = await query("SELECT decided_by::text, decided_by_role FROM kai.evidence_review_decisions WHERE organization_id = $1::uuid AND evidence_item_id = $2::uuid", [ORG_A, reviewedEvidenceId]);
      assert.deepEqual([decision.decided_by, decision.decided_by_role], [kaiUserIds.reviewer, "gk_reviewer"]);
      results.reviewerClaimId = claim.claim_id;
      results.J5_6 = `PASS: P2-12 supported by gk_reviewer in the GK Studio; claim ${claim.claim_id} proposed`;
    });

    await test("J5-7: P2-10 records eligible coverage acceptance or returns the object-level human-review blocker", async () => {
      assert.ok(results.reviewerClaimId, "prerequisite J5-6");
      // P2-10 requires the claim's own human review first (P2-09).
      const [claimQueue] = await query(
        `SELECT review_queue_item_id::text, updated_at FROM kai.review_queue_items
          WHERE organization_id = $1::uuid AND queue_type = 'claim_review' AND target_object_id = $2::uuid`, [ORG_A, results.reviewerClaimId]);
      const claimReview = await reviewerPage.fetchJson("POST",
        `${INTAKE}/admin/organizations/${ORG_A}/claims/${results.reviewerClaimId}/claim-review/${claimQueue.review_queue_item_id}/complete`,
        { expected_updated_at: new Date(claimQueue.updated_at).toISOString(), decision: "approved", approved_audiences: ["internal"] });
      assert.equal(claimReview.status, 200, JSON.stringify(claimReview));
      const [claimDecision] = await query("SELECT decided_by::text, decided_by_role FROM kai.claim_review_decisions WHERE organization_id = $1::uuid AND claim_id = $2::uuid",
        [ORG_A, results.reviewerClaimId]);
      assert.deepEqual([claimDecision.decided_by, claimDecision.decided_by_role], [kaiUserIds.reviewer, "gk_reviewer"]);
      // P2-10 accepts a limitation only for a dimension with a P2-04 gap item:
      // the reviewer first generates the claim's gap follow-ups (the GK
      // Studio "Generate gap followups" route).
      const gaps = await reviewerPage.fetchJson("POST", `${INTAKE}/admin/organizations/${ORG_A}/claims/${results.reviewerClaimId}/claim-gap-followups`, {});
      assert.ok([200, 201].includes(gaps.status), JSON.stringify(gaps));
      const outcomes = [];
      for (const key of ["denominator_clarity", "definition_clarity", "time_period_clarity", "missingness"]) {
        const accepted = await reviewerPage.fetchJson("POST", internalAcceptancePath(ORG_A, results.reviewerClaimId, key), {});
        outcomes.push([key, accepted.status, accepted.errorCode]);
        if (accepted.status === 201 || accepted.status === 200) break;
      }
      console.log(`[campaign] J5-7 reviewer P2-10: ${JSON.stringify(outcomes)}`);
      const [row] = await query("SELECT decided_by::text, decided_by_role FROM kai.coverage_review_decisions WHERE organization_id = $1::uuid AND claim_id = $2::uuid ORDER BY created_at LIMIT 1",
        [ORG_A, results.reviewerClaimId]);
      results.J5_7 = { outcomes, row };
      if (outcomes.some(([, status]) => status === 201 || status === 200)) {
        assert.deepEqual([row?.decided_by, row?.decided_by_role], [kaiUserIds.reviewer, "gk_reviewer"]);
      } else {
        assert.ok(outcomes.every(([, status, errorCode]) => status === 409 && errorCode === "human_review_incomplete"),
          "the traceability validator blocks coverage acceptance until linked human review is complete");
        assert.equal(row, undefined, "no coverage decision is recorded after an eligibility refusal");
      }
    });

    // =====================================================================
    // J3 (continued). The mixed-role reviewer downstream
    // =====================================================================
    await test("J3-2: the mixed-role reviewer's global gk_reviewer role is still not P1-08 authority; its stored organization client_admin grant now is (owner decision 2026-10-19) - reads only, writing nothing", async () => {
      const candidate = await candidateFor(profiles.mixed);
      const before = await allKaiCounts();
      const detail = await mixedPage.fetchJson("GET", candidatePath(candidate.intake_source_candidate_id));
      const access = await mixedPage.fetchJson("GET", accessCapabilitiesPath(ORG_A));
      await assertNothingWritten(before, "mixed-role source review reads");
      results.J3_2 = { detail: [detail.status, detail.data?.decision_controls_enabled], promoteSource: access.data?.workflowOperations?.promoteSource };
      console.log(`[campaign] J3-2 mixed P1-08: ${JSON.stringify(results.J3_2)}`);
      // The promotion itself is proven by kai-source-to-impact-workflow-browser-acceptance;
      // it is not made here so this candidate stays pending for the later steps.
      assert.deepEqual([detail.status, detail.data.decision_controls_enabled, access.data.workflowOperations.promoteSource], [200, true, true]);
    });

    await test("J3-3: the mixed-role reviewer's P2-12 evidence review is admitted; its claim-proposal handoff must succeed for the same human or the decision must be refused", async () => {
      const candidate = await candidateFor(profiles.reviewer);
      const [, second] = await evidenceForCandidate(candidate.intake_source_candidate_id);
      const evidenceLibrary = await mixedPage.fetchJson("GET", `${INTAKE}/admin/organizations/${ORG_A}/evidence-library/candidates`);
      const claimLibrary = await mixedPage.fetchJson("GET", `${INTAKE}/admin/organizations/${ORG_A}/claim-library/candidates`);
      assert.deepEqual([evidenceLibrary.status, claimLibrary.status], [200, 200],
        "the two GK Studio work lists admit the effective reviewer with exact-organization access");
      await openKnowledgeStudio(mixedPage);
      await mixedPage.selectProject(PROJECT_A);
      await mixedPage.clickTab("Evidence");
      await mixedPage.idle();
      assert.ok(await mixedPage.clickInEvidenceItem(second.evidence_item_id, "Review evidence"));
      await mixedPage.waitFor(async () => mixedPage.evaluate(`Boolean(document.getElementById("evidence-library-review-decision-supported"))`), "mixed reviewer decision");
      await mixedPage.evaluate(`document.getElementById("evidence-library-review-decision-supported").click()`);
      await mixedPage.evaluate(`(() => { const original = window.fetch; window.fetch = async (...args) => {
        const response = await original(...args);
        if (String(args[0]).includes("/evidence-review/") && args[1]?.method === "POST") {
          const body = await response.clone().json(); window.evidenceDecisionResponse = { status: response.status, data: body.data };
        }
        return response;
      }; })()`);
      const before = await allKaiCounts();
      const reviewMark = mixedPage.mark();
      assert.ok(await mixedPage.clickInEvidenceItem(second.evidence_item_id, "Record Evidence Review Decision"));
      await mixedPage.waitForText("KAI proposed an internal-only claim");
      await mixedPage.idle();
      const reviewed = await mixedPage.evaluate("window.evidenceDecisionResponse");
      for (const suffix of ["/evidence-library/candidates", "/claim-library/candidates", "/review-queue"]) {
        assert.ok(mixedPage.requestsSince(reviewMark).some((r) => r.url.includes(suffix) && r.status === 200), `persisted readback: ${suffix}`);
      }
      const changed = changedTables(before, await allKaiCounts());
      const [claim] = await query("SELECT claim_id::text FROM kai.claims WHERE organization_id = $1::uuid AND evidence_item_id = $2::uuid", [ORG_A, second.evidence_item_id]);
      const [row] = await query("SELECT decided_by::text, decided_by_role, decision_outcome FROM kai.evidence_review_decisions WHERE organization_id = $1::uuid AND evidence_item_id = $2::uuid",
        [ORG_A, second.evidence_item_id]);
      results.J3_3 = { evidenceLibrary: evidenceLibrary.status, claimLibrary: claimLibrary.status, status: reviewed.status, decision: row ?? null, decidedByMixed: row?.decided_by === kaiUserIds.mixed, handoff: reviewed.data?.claim_proposal_handoff ?? null, claimCreated: Boolean(claim), changed };
      console.log(`[campaign] J3-3 mixed P2-12: ${JSON.stringify(results.J3_3)}`);
      assert.ok(reviewed.status === 403 || reviewed.data?.claim_proposal_handoff?.status === "created",
        "the evidence-review decision and its server-side claim proposal must agree on who is authorized");

      // Decision C Option A (owner-accepted 2026-10-13): the committed human
      // decision continues into the governed P2-02/P2-03 work it authorizes.
      assert.equal(reviewed.status, 200);
      assert.deepEqual(changed, ["audit_events", "claim_evidence_links", "claims", "evidence_review_decisions", "review_queue_items", "upload_lifecycle_audit"]);
      const decisions = await query("SELECT decision_id::text, decided_by::text, decided_by_role FROM kai.evidence_review_decisions WHERE organization_id = $1::uuid AND evidence_item_id = $2::uuid",
        [ORG_A, second.evidence_item_id]);
      assert.deepEqual(decisions.map((d) => [d.decided_by, d.decided_by_role]), [[kaiUserIds.mixed, "gk_reviewer"]], "the human decision is committed exactly once");
      const [claimRow] = await query(
        `SELECT claim_status, claim_review_status, claim_strength, internal_only, public_use_allowed, funder_use_allowed, export_ready, created_by::text
           FROM kai.claims WHERE claim_id = $1::uuid`, [claim.claim_id]);
      assert.deepEqual(Object.values(claimRow), ["proposed", "needs_gk_review", "unassessed", true, false, false, false, kaiUserIds.mixed]);
      const claimQueues = await query(
        `SELECT review_queue_item_id::text, queue_status, updated_at FROM kai.review_queue_items
          WHERE organization_id = $1::uuid AND queue_type = 'claim_review' AND target_object_id = $2::uuid`, [ORG_A, claim.claim_id]);
      assert.deepEqual(claimQueues.map((q) => [q.review_queue_item_id, q.queue_status]), [[reviewed.data.claim_proposal_handoff.claim_review_queue_item_id, "open"]]);
      const [audit] = await query("SELECT actor_user_id::text, metadata FROM kai.audit_events WHERE action = 'claim_proposed' AND metadata->>'object_id' = $1", [claim.claim_id]);
      assert.deepEqual([audit.actor_user_id, audit.metadata.authority_source, audit.metadata.decision_id, audit.metadata.decided_by_role],
        [kaiUserIds.mixed, "evidence_review_decision", decisions[0].decision_id, "gk_reviewer"], "the claim records the authorizing evidence-review decision");
      const [{ count: autoReviews }] = await query("SELECT count(*)::int AS count FROM kai.claim_review_decisions WHERE claim_id = $1::uuid", [claim.claim_id]);
      assert.equal(autoReviews, 0, "no automatic claim review");

      // The mixed actor gains no direct P2-02 authority. Direct P2-03 is now
      // admitted by its organization client_admin membership (owner decision
      // 2026-10-18); see below.
      const [{ source_version_id: sourceVersionId }] = await query("SELECT source_version_id::text FROM kai.evidence_items WHERE evidence_item_id = $1::uuid", [second.evidence_item_id]);
      const directBefore = await allKaiCounts();
      const directAssess = await mixedPage.fetchJson("GET", `${INTAKE}/admin/organizations/${ORG_A}/source-versions/${sourceVersionId}/evidence-coverage-assessment`);
      const [first] = await evidenceForCandidate(candidate.intake_source_candidate_id);
      const directPropose = await mixedPage.fetchJson("POST", `${INTAKE}/admin/organizations/${ORG_A}/evidence-items/${first.evidence_item_id}/claim-proposal`, {});
      const forgedPropose = await mixedPage.fetchJson("POST", `${INTAKE}/admin/organizations/${ORG_A}/evidence-items/${first.evidence_item_id}/claim-proposal`,
        { internal_handoff: true, decision_bound: true, evidence_review_decision_id: decisions[0].decision_id });
      assert.deepEqual([directAssess.status, directAssess.errorCode, directAssess.blockers?.[0]?.[1]], [403, "authorization_denied", "role_not_allowed"]);
      // `first` already carries the claim J5-6 proposed and J5-7 approved. The
      // direct P2-03 replay of a since-reviewed claim fails the repository's
      // post-write contract for every authorized actor alike (pre-existing,
      // recorded in the ExecPlan); the GK reviewer gets the identical result.
      const reviewerPropose = await reviewerPage.fetchJson("POST", `${INTAKE}/admin/organizations/${ORG_A}/evidence-items/${first.evidence_item_id}/claim-proposal`, {});
      console.log(`[campaign] J3-3 direct P2-03 on a reviewed claim: mixed ${directPropose.status}/${directPropose.errorCode}, GK reviewer ${reviewerPropose.status}/${reviewerPropose.errorCode}`);
      assert.notEqual(directPropose.errorCode, "authorization_denied");
      assert.deepEqual([directPropose.status, directPropose.errorCode], [reviewerPropose.status, reviewerPropose.errorCode]);
      assert.ok([400, 403, 422].includes(forgedPropose.status), JSON.stringify(forgedPropose));
      assert.deepEqual(changedTables(directBefore, await allKaiCounts()), [], "the direct requests write nothing");

      // Client-safe presentation: the unreviewed proposal is not an Impact Fact.
      const facts = await mixedPage.fetchJson("GET", `${INTAKE}/admin/organizations/${ORG_A}/impact-facts`);
      assert.ok(!JSON.stringify(facts.data ?? {}).includes(claim.claim_id), "the proposed claim is not an approved Impact Fact");

      await mixedPage.clickTab("Reviews");
      await mixedPage.waitForText(`Claim ${claim.claim_id}`);
      // The separate human claim review by an independently authorized GK reviewer.
      await openKnowledgeStudio(reviewerPage);
      await reviewerPage.clickTab("Reviews");
      await reviewerPage.waitForText(`Claim ${claim.claim_id}`);
      const library = await reviewerPage.fetchJson("GET", `${INTAKE}/admin/organizations/${ORG_A}/claim-library/candidates`);
      const listed = library.data?.items?.find((item) => item.claimId === claim.claim_id);
      assert.ok(listed, "the GK reviewer discovers the proposed claim");
      const claimReview = await reviewerPage.fetchJson("POST",
        `${INTAKE}/admin/organizations/${ORG_A}/claims/${claim.claim_id}/claim-review/${claimQueues[0].review_queue_item_id}/complete`,
        { expected_updated_at: new Date(claimQueues[0].updated_at).toISOString(), decision: "approved", approved_audiences: ["internal"] });
      assert.equal(claimReview.status, 200, JSON.stringify(claimReview));
      const claimDecisions = await query("SELECT decided_by::text, decided_by_role FROM kai.claim_review_decisions WHERE claim_id = $1::uuid", [claim.claim_id]);
      assert.deepEqual(claimDecisions.map((d) => [d.decided_by, d.decided_by_role]), [[kaiUserIds.reviewer, "gk_reviewer"]]);
      results.J3_3.continuation = { audit: audit.metadata.authority_source, directAssess: directAssess.status, directPropose: directPropose.status, forgedPropose: forgedPropose.status, claimReview: claimReview.status };
      console.log(`[campaign] J3-3 continuation: ${JSON.stringify(results.J3_3.continuation)}`);
    });

    // =====================================================================
    // J6. Client approval and review
    // =====================================================================
    const newMemberPage = await session(USERS.newMember);
    const adminCPage = await session(USERS.adminC);
    let joinRequestId = null;
    await test("J6-1: a new account signs in and requests to join the client organization", async () => {
      await newMemberPage.goto("/impact-library");
      await newMemberPage.idle();
      const [mapping] = await query("SELECT user_id::text, status, email FROM kai.users WHERE legacy_public_userdata_id = $1", [USERS.newMember]);
      kaiUserIds.newMember = mapping.user_id;
      const submitted = await newMemberPage.fetchJson("POST", `${INTAKE}/admin/organization-join/requests`, { organization_id: ORG_C });
      results.J6_1 = { email: mapping.email, submit: [submitted.status, submitted.data?.outcome] };
      console.log(`[campaign] J6-1 join: ${JSON.stringify(results.J6_1)}`);
      assert.ok([200, 201].includes(submitted.status), JSON.stringify(submitted));
      assert.equal(mapping.status, "active");
    });

    await test("J6-2: the organization administrator approves it; exactly one active client_contributor membership; follow-ups still refused", async () => {
      const listed = await adminCPage.fetchJson("GET", `${ACCESS}/organizations/${ORG_C}/join-requests`);
      const request = JSON.stringify(listed.data).match(/"organization_join_request_id":"([0-9a-f-]{36})"/);
      joinRequestId = request && request[1];
      assert.ok(joinRequestId, JSON.stringify(listed));
      const before = await allKaiCounts();
      const approved = await adminCPage.fetchJson("POST", `${ACCESS}/organizations/${ORG_C}/join-requests/${joinRequestId}/approve`);
      assert.equal(approved.status, 200, JSON.stringify(approved));
      console.log(`[campaign] J6-2 approval changed tables: ${JSON.stringify(changedTables(before, await allKaiCounts()))}`);
      const memberships = await query("SELECT role_name, membership_status FROM kai.organization_memberships WHERE organization_id = $1::uuid AND user_id = $2::uuid", [ORG_C, kaiUserIds.newMember]);
      assert.deepEqual(memberships, [{ role_name: "client_contributor", membership_status: "active" }]);
      const access = await newMemberPage.fetchJson("GET", accessCapabilitiesPath(ORG_C));
      const list = await newMemberPage.fetchJson("GET", followupsPath(ORG_C));
      assert.deepEqual([access.data.clientFollowupReview, access.data.internalKnowledgeWorkspace, list.status], [false, false, 403]);
      results.J6_2 = "PASS: approved -> client_contributor/active; no follow-up capability; list 403";
    });

    await test("J6-3: Team & Access makes the member client_reviewer; they complete a follow-up from the follow-up page with client_reviewer attribution", async () => {
      const promoted = await adminCPage.fetchJson("PUT", membershipPath(ORG_C, USERS.newMember), { role_name: "client_reviewer", membership_status: "active" });
      assert.equal(promoted.status, 200);
      const access = await newMemberPage.fetchJson("GET", accessCapabilitiesPath(ORG_C));
      assert.deepEqual([access.data.clientFollowupReview, access.data.internalKnowledgeWorkspace], [true, false]);
      await newMemberPage.goto(`/kai/client-followups?organizationId=${ORG_C}`);
      await newMemberPage.waitForText("Client Follow-ups");
      await newMemberPage.clickButton("Load follow-ups");
      await newMemberPage.waitFor(() => newMemberPage.visibleButton("Mark reviewed"), "an open follow-up");
      await newMemberPage.idle();
      const before = await allKaiCounts();
      const mark = newMemberPage.mark();
      await newMemberPage.clickButton("Mark reviewed");
      await newMemberPage.idle();
      const completions = writes(newMemberPage.requestsSince(mark));
      assert.equal(completions.length, 1);
      assert.equal(completions[0][2], 200);
      const followupId = completions[0][1].split("/client-followups/")[1].replace("/complete", "");
      assert.deepEqual(changedTables(before, await allKaiCounts()), ["audit_events", "upload_lifecycle_audit"]);
      const [lifecycle] = await query(
        "SELECT metadata FROM kai.upload_lifecycle_audit WHERE organization_id = $1::uuid AND metadata->>'client_followup_item_id' = $2 ORDER BY 1 DESC LIMIT 1", [ORG_C, followupId]);
      assert.equal(lifecycle.metadata.decided_by_role, "client_reviewer");
      results.J6_3 = `PASS: follow-up ${followupId} resolved by the approved member as client_reviewer`;
    });

    await test("J6-4: the approved client reviewer cannot perform GK-only review operations, writing nothing", async () => {
      const cockpit = await newMemberPage.fetchJson("GET", cockpitCapabilitiesPath(ORG_C));
      const queue = await newMemberPage.fetchJson("GET", `${COCKPIT}/queue?organization_id=${ORG_C}&queue_type=source_candidate_review`);
      const [evidence] = await query(`SELECT e.evidence_item_id::text, q.review_queue_item_id::text, q.updated_at FROM kai.evidence_items e
        JOIN kai.review_queue_items q ON q.organization_id = e.organization_id AND q.queue_type = 'evidence_review' AND q.target_object_id = e.evidence_item_id
        WHERE e.organization_id = $1::uuid AND q.queue_status = 'open' ORDER BY 1 LIMIT 1`, [ORG_C]);
      const before = await allKaiCounts();
      const review = evidence
        ? await newMemberPage.fetchJson("POST", evidenceReviewPath(ORG_C, evidence.evidence_item_id, evidence.review_queue_item_id),
          { expected_updated_at: new Date(evidence.updated_at).toISOString(), decision: "supported" })
        : { status: null };
      await assertNothingWritten(before, "client reviewer GK operations");
      results.J6_4 = { cockpit: cockpit.data?.can_manage_sensitivity_review, queue: queue.status, evidenceReview: review.status };
      assert.deepEqual([cockpit.data.can_manage_sensitivity_review, queue.status], [false, 403]);
      if (evidence) assert.equal(review.status, 403);
    });

    // =====================================================================
    // J1 (continued). Platform-superuser authority on the full-request routes
    // =====================================================================
    await test("J1-3: the same superuser without a GK role on the full-request routes: P2-12, P2-10, and client follow-up completion (recorded, with attribution)", async () => {
      const boundCandidate = await candidateFor(profiles.bound);
      const boundEvidence = (await evidenceForCandidate(boundCandidate.intake_source_candidate_id)).find((row) => row.queue_status === "open");
      assert.ok(boundEvidence, "one bound-candidate evidence item remains open for the superuser probe");
      const p212Before = await allKaiCounts();
      const p212 = await superNoRolePage.fetchJson("POST", evidenceReviewPath(ORG_A, boundEvidence.evidence_item_id, boundEvidence.queue_item),
        { expected_updated_at: new Date(boundEvidence.updated_at).toISOString(), decision: "supported" });
      const p212Changed = changedTables(p212Before, await allKaiCounts());
      const [p212Row] = await query("SELECT decided_by::text, decided_by_role FROM kai.evidence_review_decisions WHERE organization_id = $1::uuid AND evidence_item_id = $2::uuid",
        [ORG_A, boundEvidence.evidence_item_id]);
      const p210 = [];
      if (results.reviewerClaimId) {
        for (const key of ["missingness", "duplicates", "entity_level_clarity", "coverage_gaps"]) {
          const accepted = await superNoRolePage.fetchJson("POST", internalAcceptancePath(ORG_A, results.reviewerClaimId, key), {});
          p210.push([key, accepted.status, accepted.errorCode]);
          if (accepted.status === 201 || accepted.status === 200) break;
        }
      }
      const p210Rows = await query("SELECT decided_by::text, decided_by_role FROM kai.coverage_review_decisions WHERE organization_id = $1::uuid AND decided_by = $2::uuid",
        [ORG_A, kaiUserIds.superNoRole]);
      const openFollowup = (await followupQueue()).find((row) => row.queue_status !== "resolved");
      const followup = await superNoRolePage.fetchJson("POST", followupCompletePath(openFollowup.client_followup_item_id),
        { expected_updated_at: new Date(openFollowup.updated_at).toISOString() });
      const [followupLifecycle] = await query(
        "SELECT metadata FROM kai.upload_lifecycle_audit WHERE organization_id = $1::uuid AND metadata->>'client_followup_item_id' = $2 ORDER BY 1 DESC LIMIT 1",
        [ORG_C, openFollowup.client_followup_item_id]);
      const superNoRoleMembershipsC = await query("SELECT role_name FROM kai.organization_memberships WHERE organization_id = $1::uuid AND user_id = $2::uuid", [ORG_C, kaiUserIds.superNoRole]);
      results.J1_3 = {
        p212: { status: p212.status, row: p212Row ?? null, handoff: p212.data?.claim_proposal_handoff?.status ?? null, changed: p212Changed },
        p210: { attempts: p210, rows: p210Rows },
        followup: { status: followup.status, decidedByRole: followupLifecycle?.metadata?.decided_by_role ?? null, membershipsInOrgC: superNoRoleMembershipsC },
      };
      console.log(`[campaign] J1-3 superuser without GK role on full-request routes: ${JSON.stringify(results.J1_3)}`);
      // Invariant only (the governing direction is an open owner decision):
      // whatever is admitted is recorded in the requested organization.
      if (p212.status === 200) assert.equal(p212Row.decided_by, kaiUserIds.superNoRole);
    });

    // =====================================================================
    // J7. Revocation and isolation
    // =====================================================================
    // =====================================================================
    // P3. Organization-facing readback and authorization freshness. The
    // ordinary Org A member reads the client Knowledge Studio while GK and
    // client reviewers act in their own sessions. Every case compares the
    // authoritative rows, the client-safe API, and the rendered page.
    // =====================================================================
    const pipelineLogic = await import("../frontend/knowledgeStudio/clientEvidencePipelineLogic.js");
    const memberAPage = await session(USERS.memberA);
    const memberBPage = await session(USERS.memberB);
    const clientReviewerAPage = await session(USERS.clientReviewerA);
    const clientReviewerAStudioPage = await session(USERS.clientReviewerA);
    const impactFactsPath = (organizationId = ORG_A) => `${INTAKE}/admin/organizations/${organizationId}/impact-facts`;
    const followupCompletePathFor = (organizationId, claimId, followupId) =>
      `${INTAKE}/admin/organizations/${organizationId}/claims/${claimId}/client-followups/${followupId}/complete`;
    // "Returning" to a page: the window regains focus (the app revalidates on
    // focus/visibility, throttled to one run per second).
    async function returnTo(page) {
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await page.evaluate(`window.dispatchEvent(new Event("focus"))`);
      await page.idle();
    }
    async function authoritativeFile(intakeFileId) {
      const [row] = await query(
        `SELECT f.engagement_id::text AS engagement_id, f.organization_id::text AS organization_id,
                (SELECT d.decision_outcome FROM kai.intake_sensitivity_review_decisions d
                   JOIN kai.intake_sensitivity_profiles s ON s.organization_id = d.organization_id AND s.intake_sensitivity_profile_id = d.intake_sensitivity_profile_id
                  WHERE s.organization_id = f.organization_id AND s.intake_file_id = f.intake_file_id
                    AND NOT EXISTS (SELECT 1 FROM kai.intake_sensitivity_review_decisions n WHERE n.organization_id = d.organization_id AND n.supersedes_decision_id = d.decision_id)
                  ORDER BY d.created_at DESC LIMIT 1) AS sensitivity_decision,
                (SELECT c.candidate_status FROM kai.intake_source_candidates c WHERE c.organization_id = f.organization_id AND c.intake_file_id = f.intake_file_id LIMIT 1) AS candidate_status,
                (SELECT q.queue_status FROM kai.intake_source_candidates c JOIN kai.review_queue_items q ON q.organization_id = c.organization_id
                    AND q.queue_type = 'source_candidate_review' AND q.target_object_id = c.intake_source_candidate_id
                  WHERE c.organization_id = f.organization_id AND c.intake_file_id = f.intake_file_id LIMIT 1) AS source_queue_status,
                (SELECT p.decision_status FROM kai.intake_source_candidates c JOIN kai.intake_promotion_decisions p ON p.organization_id = c.organization_id
                    AND p.intake_source_candidate_id = c.intake_source_candidate_id
                  WHERE c.organization_id = f.organization_id AND c.intake_file_id = f.intake_file_id LIMIT 1) AS promotion_decision,
                (SELECT count(*)::int FROM kai.intake_source_candidates c JOIN kai.source_versions v ON v.organization_id = c.organization_id
                    AND v.intake_source_candidate_id = c.intake_source_candidate_id AND v.is_current
                  WHERE c.organization_id = f.organization_id AND c.intake_file_id = f.intake_file_id) AS current_versions,
                (SELECT coalesce(array_agg(e.evidence_review_status ORDER BY e.evidence_review_status), ARRAY[]::text[])
                   FROM kai.intake_source_candidates c JOIN kai.source_versions v ON v.organization_id = c.organization_id
                    AND v.intake_source_candidate_id = c.intake_source_candidate_id AND v.is_current
                   JOIN kai.evidence_items e ON e.organization_id = v.organization_id AND e.source_version_id = v.source_version_id
                  WHERE c.organization_id = f.organization_id AND c.intake_file_id = f.intake_file_id) AS evidence_statuses
           FROM kai.intake_files f WHERE f.intake_file_id = $1::uuid`, [intakeFileId]);
      return row;
    }
    const apiFile = (pipeline, key) => findFile(pipeline.data, FILES[key]);
    const currentStageOf = (file) => file.stages.find((stage) => stage.key === file.currentStage);
    const renderedWaitingLine = (key, file) =>
      `${NAMES[key]}: ${pipelineLogic.PIPELINE_STAGE_LABELS[file.currentStage]} (${pipelineLogic.stageStatusLabel(currentStageOf(file))})`;
    async function openClientProject(page, engagementId, tab) {
      await openKnowledgeStudio(page);
      await page.waitFor(async () => page.evaluate(`Boolean(document.getElementById("gk-shell-project-select"))`), "project selector");
      await page.selectProject(engagementId);
      await page.idle();
      await page.clickTab(tab);
      await page.idle();
    }
    async function openClientTab(page, tab) {
      await page.clickTab(tab === "Evidence" ? "Files" : "Evidence");
      await page.idle();
      await page.clickTab(tab);
      await page.idle();
    }
    // Every reason the API reports for this project, rendered as the Evidence tab renders it.
    const evidenceReasonLines = (pipeline) =>
      pipeline.data.summary.reasons.filter((entry) => entry.reason !== "complete")
        .map((entry) => pipelineLogic.pipelineReasonMessage(entry.reason, entry.fileCount));
    async function openFollowups(page, organizationId) {
      await page.goto(`/kai/client-followups?organizationId=${organizationId}`);
      await page.waitForText("Client Follow-ups");
      await page.clickButton("Load follow-ups");
      await page.idle();
    }
    const markReviewedCount = (page) => page.evaluate(`[...document.querySelectorAll("button")].filter((el) => el.offsetParent !== null && el.innerText.trim() === "Mark reviewed").length`);
    async function openFollowupsFor(claimId) {
      return query(
        `SELECT cf.client_followup_item_id::text, cf.dimension_key, rq.queue_status, rq.updated_at FROM kai.client_followup_items cf
           JOIN kai.review_queue_items rq ON rq.organization_id = cf.organization_id AND rq.queue_type = 'client_followup'
            AND rq.target_object_type = 'client_followup_item' AND rq.target_object_id = cf.client_followup_item_id
          WHERE cf.organization_id = $1::uuid AND cf.claim_id = $2::uuid ORDER BY cf.dimension_key`, [ORG_A, claimId]);
    }
    async function followupDecisionAudit(followupId) {
      const [row] = await query(
        "SELECT metadata FROM kai.upload_lifecycle_audit WHERE organization_id = $1::uuid AND metadata->>'client_followup_item_id' = $2 ORDER BY 1 DESC LIMIT 1",
        [ORG_A, followupId]);
      return row?.metadata || null;
    }
    // Delivers matching responses late (the request itself is sent at once),
    // to prove a superseded response never replaces the selected context.
    async function delayResponses(page, fragment, ms) {
      await page.evaluate(`(() => {
        if (!window.__p3OriginalFetch) window.__p3OriginalFetch = window.fetch;
        const original = window.__p3OriginalFetch;
        window.__p3Delayed = window.__p3Delayed || 0;
        window.fetch = async (...args) => {
          const response = await original(...args);
          if (String(args[0]).includes(${JSON.stringify(fragment)})) {
            window.__p3Delayed += 1;
            await new Promise((resolve) => setTimeout(resolve, ${ms}));
          }
          return response;
        };
        return true;
      })()`);
    }
    const restoreFetch = (page) => page.evaluate(`(() => { if (window.__p3OriginalFetch) window.fetch = window.__p3OriginalFetch; return true; })()`);
    const hamperClaimId = () => results.reviewerClaimId;
    // J5-6 reviews the first GK Studio evidence item carrying the reviewer
    // file's statement, and every synthetic file's statements are identical,
    // so the claim's file is read from its lineage rather than assumed.
    async function fileKeyForClaim(claimId) {
      const [row] = await query(
        `SELECT c.intake_file_id::text FROM kai.claims cl
           JOIN kai.evidence_items e ON e.organization_id = cl.organization_id AND e.evidence_item_id = cl.evidence_item_id
           JOIN kai.source_versions v ON v.organization_id = e.organization_id AND v.source_version_id = e.source_version_id
           JOIN kai.intake_source_candidates c ON c.organization_id = v.organization_id AND c.intake_source_candidate_id = v.intake_source_candidate_id
          WHERE cl.organization_id = $1::uuid AND cl.claim_id = $2::uuid`, [ORG_A, claimId]);
      return Object.keys(FILES).find((key) => FILES[key] === row?.intake_file_id) || null;
    }

    await test("P3-A: an ordinary Org A member sees each file's actual sensitivity and source state - authoritative rows, client-safe API, and rendered page agree", async () => {
      const authoritative = {};
      for (const key of ["probe", "mixed", "superGk", "bound", "reviewer"]) authoritative[key] = await authoritativeFile(FILES[key]);
      for (const row of Object.values(authoritative)) assert.deepEqual([row.organization_id, row.engagement_id], [ORG_A, PROJECT_A]);
      // S0: no sensitivity decision. S1: reviewed, candidate pending in an open source-review item, nothing promoted.
      assert.deepEqual([authoritative.probe.sensitivity_decision, authoritative.probe.candidate_status], [null, null]);
      assert.deepEqual(
        [authoritative.mixed.sensitivity_decision, authoritative.mixed.candidate_status, authoritative.mixed.source_queue_status, authoritative.mixed.promotion_decision, authoritative.mixed.current_versions],
        ["reviewed", "needs_gk_review", "open", null, 0]);
      // S2: promoted with one current version; both extracted evidence items await GK review.
      assert.deepEqual(
        [authoritative.superGk.candidate_status, authoritative.superGk.promotion_decision, authoritative.superGk.current_versions, authoritative.superGk.evidence_statuses],
        ["promoted", "promoted", 1, ["needs_gk_review", "needs_gk_review"]]);

      const pipeline = await memberAPage.fetchJson("GET", pipelinePath(ORG_A, PROJECT_A));
      assert.equal(pipeline.status, 200);
      const stageOf = (key) => [apiFile(pipeline, key).currentStage, apiFile(pipeline, key).currentStatus, apiFile(pipeline, key).responsibleParty];
      assert.deepEqual(stageOf("probe"), ["sensitivity_review", "waiting_for_get_kinder", "get_kinder"]);
      assert.deepEqual(stageOf("mixed"), ["source_review", "waiting_for_get_kinder", "get_kinder"]);
      assert.deepEqual(stageOf("superGk"), ["evidence_review", "waiting_for_get_kinder", "get_kinder"]);
      const mixedStages = Object.fromEntries(apiFile(pipeline, "mixed").stages.map((stage) => [stage.key, stage.status]));
      assert.deepEqual([mixedStages.sensitivity_review, mixedStages.source_review, mixedStages.evidence_extraction], ["complete", "waiting_for_get_kinder", "not_started"],
        "sensitivity reviewed is not source promoted");
      const superGkStages = Object.fromEntries(apiFile(pipeline, "superGk").stages.map((stage) => [stage.key, stage]));
      assert.deepEqual([superGkStages.source_review.status, superGkStages.evidence_extraction.status, superGkStages.evidence_extraction.count, superGkStages.evidence_review.count],
        ["complete", "complete", 2, 2], "source promoted and evidence extracted, review still pending");
      assert.equal(findFile(pipeline.data, FILES.projectTwo), null, "Project A2's file is not attributed to Project A");
      assert.equal(findFile(pipeline.data, FILES.otherOrg), null);

      await openClientProject(memberAPage, PROJECT_A, "Reviews");
      await memberAPage.waitForText(renderedWaitingLine("superGk", apiFile(pipeline, "superGk")));
      const body = await memberAPage.text();
      const waitingOnGetKinder = ["probe", "mixed", "superGk", "bound", "reviewer"].filter((key) => apiFile(pipeline, key).responsibleParty === "get_kinder");
      assert.ok(waitingOnGetKinder.length >= 4);
      for (const key of waitingOnGetKinder) {
        assert.ok(body.includes(renderedWaitingLine(key, apiFile(pipeline, key))), `rendered: ${renderedWaitingLine(key, apiFile(pipeline, key))}`);
      }
      assert.deepEqual(await memberAPage.fileReviewActionIds(), [], "an ordinary member is asked to perform no Get Kinder review");
      assert.equal(await memberAPage.visibleButton("Promote"), false);
      assert.deepEqual(memberAPage.exceptions, []);
      results.P3_A = Object.fromEntries(["probe", "mixed", "superGk", "bound", "reviewer"].map((key) => [NAMES[key], stageOf(key)]));
      console.log(`[campaign] P3-A member A file stages: ${JSON.stringify(results.P3_A)}`);
    });

    await test("P3-B: a promoted source with pending evidence is not shown as reviewed evidence, and a rejected source is not shown as promoted", async () => {
      const pipeline = await memberAPage.fetchJson("GET", pipelinePath(ORG_A, PROJECT_A));
      const facts = await memberAPage.fetchJson("GET", impactFactsPath());
      assert.deepEqual([facts.status, facts.data.items], [200, []], "no governed-eligible Impact Fact exists yet");
      assert.deepEqual(pipeline.data.reviewedImpactFacts, []);
      const pendingEvidence = await query(
        `SELECT e.evidence_item_id::text FROM kai.evidence_items e WHERE e.organization_id = $1::uuid AND e.evidence_review_status = 'needs_gk_review'`, [ORG_A]);
      const payloads = JSON.stringify([pipeline.data, facts.data]);
      for (const { evidence_item_id: id } of pendingEvidence) assert.ok(!payloads.includes(id), "no pending evidence id reaches a client payload");
      await openClientTab(memberAPage, "Evidence");
      for (const line of evidenceReasonLines(pipeline)) await memberAPage.waitForText(line);
      const evidenceText = await memberAPage.text();
      assert.ok(evidenceText.includes("No reviewed evidence for this project yet."));
      assert.ok(!evidenceText.includes("Reviewed for internal use"), "nothing pending is presented as reviewed");

      // The GK operator rejects the pending candidate in the GK Studio.
      const candidate = await candidateFor(profiles.mixed);
      const before = await allKaiCounts();
      const { controlsOffered } = await openSourceReviewInStudio(gkOperatorPage, candidate.intake_source_candidate_id);
      assert.equal(controlsOffered, true);
      await gkOperatorPage.selectByLabel("Decision outcome", "rejected");
      const mark = gkOperatorPage.mark();
      await gkOperatorPage.clickButton("Reject");
      await gkOperatorPage.waitForText("Recorded rejected.");
      assert.deepEqual(writes(gkOperatorPage.requestsSince(mark)), [["POST", candidateDecisionPath(candidate.intake_source_candidate_id).split("?")[0], 200]]);
      assert.ok(changedTables(before, await allKaiCounts()).includes("intake_promotion_decisions"));
      const rejected = await authoritativeFile(FILES.mixed);
      assert.deepEqual([rejected.candidate_status, rejected.promotion_decision, rejected.current_versions], ["rejected", "rejected", 0]);
      const [decision] = await query("SELECT created_by::text FROM kai.intake_promotion_decisions WHERE organization_id = $1::uuid AND intake_source_candidate_id = $2::uuid",
        [ORG_A, candidate.intake_source_candidate_id]);
      assert.equal(decision.created_by, kaiUserIds.gkOperator);

      // The member returns to the page: the pipeline is re-read and the rejected source is closed, not promoted.
      await returnTo(memberAPage);
      const after = await memberAPage.fetchJson("GET", pipelinePath(ORG_A, PROJECT_A));
      assert.deepEqual([apiFile(after, "mixed").currentStage, apiFile(after, "mixed").currentStatus, apiFile(after, "mixed").reason],
        ["source_review", "closed", "source_not_promoted"]);
      await memberAPage.waitForText(pipelineLogic.pipelineReasonMessage("source_not_promoted", 1));
      results.P3_B = { pendingEvidence: pendingEvidence.length, rejected: [apiFile(after, "mixed").currentStage, apiFile(after, "mixed").currentStatus] };
    });

    let pantryReviewedEvidenceId = null;
    await test("P3-C: an authorized GK evidence review is recorded with attribution, audit, and lineage; the client sees one item still pending and no Impact Fact before its claim is reviewed", async () => {
      const [target] = await query(
        `SELECT e.evidence_item_id::text, e.source_version_id::text, q.review_queue_item_id::text, q.updated_at
           FROM kai.intake_source_candidates c
           JOIN kai.source_versions v ON v.organization_id = c.organization_id AND v.intake_source_candidate_id = c.intake_source_candidate_id AND v.is_current
           JOIN kai.evidence_items e ON e.organization_id = v.organization_id AND e.source_version_id = v.source_version_id
           JOIN kai.review_queue_items q ON q.organization_id = e.organization_id AND q.queue_type = 'evidence_review' AND q.target_object_id = e.evidence_item_id
          WHERE c.organization_id = $1::uuid AND c.intake_file_id = $2::uuid AND q.queue_status = 'open'
          ORDER BY e.evidence_item_id LIMIT 1`, [ORG_A, FILES.superGk]);
      assert.ok(target, "a pending pantry evidence item");
      const auditBefore = await auditActions(kaiUserIds.reviewer);
      const reviewed = await reviewerPage.fetchJson("POST", evidenceReviewPath(ORG_A, target.evidence_item_id, target.review_queue_item_id),
        { expected_updated_at: new Date(target.updated_at).toISOString(), decision: "supported" });
      assert.equal(reviewed.status, 200, JSON.stringify(reviewed));
      pantryReviewedEvidenceId = target.evidence_item_id;
      const [decision] = await query(
        "SELECT decided_by::text, decided_by_role, decision_outcome FROM kai.evidence_review_decisions WHERE organization_id = $1::uuid AND evidence_item_id = $2::uuid",
        [ORG_A, target.evidence_item_id]);
      assert.deepEqual([decision.decided_by, decision.decided_by_role, decision.decision_outcome], [kaiUserIds.reviewer, "gk_reviewer", "supported"]);
      assert.ok((await auditActions(kaiUserIds.reviewer)).length > auditBefore.length, "audited as the reviewer");
      const [lineage] = await query(
        `SELECT e.evidence_review_status, v.is_current, c.intake_file_id::text FROM kai.evidence_items e
           JOIN kai.source_versions v ON v.organization_id = e.organization_id AND v.source_version_id = e.source_version_id
           JOIN kai.intake_source_candidates c ON c.organization_id = v.organization_id AND c.intake_source_candidate_id = v.intake_source_candidate_id
          WHERE e.organization_id = $1::uuid AND e.evidence_item_id = $2::uuid`, [ORG_A, target.evidence_item_id]);
      assert.deepEqual([lineage.evidence_review_status, lineage.is_current, lineage.intake_file_id], ["reviewed", true, FILES.superGk]);
      const [claim] = await query("SELECT claim_id::text, claim_review_status FROM kai.claims WHERE organization_id = $1::uuid AND evidence_item_id = $2::uuid",
        [ORG_A, target.evidence_item_id]);
      assert.equal(claim?.claim_review_status, "needs_gk_review", "reviewed evidence proposes a claim; it is not an approved claim");

      await returnTo(memberAPage);
      const pipeline = await memberAPage.fetchJson("GET", pipelinePath(ORG_A, PROJECT_A));
      const pantry = apiFile(pipeline, "superGk");
      assert.deepEqual([pantry.currentStage, pantry.currentStatus, currentStageOf(pantry).count], ["evidence_review", "waiting_for_get_kinder", 1],
        "the other extracted item is still pending");
      const facts = await memberAPage.fetchJson("GET", impactFactsPath());
      assert.ok(!facts.data.items.some((fact) => fact.claimId === claim.claim_id), "the unreviewed claim is not an Impact Fact");
      await openClientTab(memberAPage, "Evidence");
      for (const line of evidenceReasonLines(pipeline)) await memberAPage.waitForText(line);
      assert.ok(!(await memberAPage.text()).includes("Reviewed for internal use"));
      results.P3_C = { evidence: target.evidence_item_id, claim: claim.claim_id, pantryPending: currentStageOf(pantry).count };
    });

    await test("P3-F: Team & Access makes an Org A member client_reviewer; they complete follow-ups through the governed route with client_reviewer attribution, and the member's readback reflects it; an ordinary member gets no follow-up action", async () => {
      const claimId = hamperClaimId();
      assert.ok(claimId, "prerequisite J5-6");
      const open = (await openFollowupsFor(claimId)).filter((row) => row.queue_status !== "resolved" && row.queue_status !== "cancelled");
      assert.equal(open.length, 4, "four genuine client follow-ups are pending");
      const memberList = await memberAPage.fetchJson("GET", followupsPath(ORG_A));
      const memberAccess = await memberAPage.fetchJson("GET", accessCapabilitiesPath(ORG_A));
      assert.deepEqual([memberList.status, memberAccess.data.clientFollowupReview], [403, false], "no follow-up action without client-review authority");

      const promoted = await storedAdminPage.fetchJson("PUT", membershipPath(ORG_A, USERS.clientReviewerA), { role_name: "client_reviewer", membership_status: "active" });
      assert.equal(promoted.status, 200, JSON.stringify(promoted));
      await openFollowups(clientReviewerAPage, ORG_A);
      await clientReviewerAPage.waitFor(async () => (await markReviewedCount(clientReviewerAPage)) === 4, "the four open follow-ups");
      const completedIds = [];
      for (let index = 0; index < 3; index += 1) {
        const before = await allKaiCounts();
        const mark = clientReviewerAPage.mark();
        await clientReviewerAPage.clickButton("Mark reviewed");
        await clientReviewerAPage.waitFor(async () => (await markReviewedCount(clientReviewerAPage)) === 3 - index, "the completed follow-up leaves the actionable list");
        const posted = writes(clientReviewerAPage.requestsSince(mark));
        assert.equal(posted.length, 1);
        assert.equal(posted[0][2], 200);
        const followupId = posted[0][1].split("/client-followups/")[1].replace("/complete", "");
        completedIds.push(followupId);
        assert.deepEqual(changedTables(before, await allKaiCounts()), ["audit_events", "upload_lifecycle_audit"]);
        const audit = await followupDecisionAudit(followupId);
        assert.equal(audit.decided_by_role, "client_reviewer");
      }
      const states = await openFollowupsFor(claimId);
      assert.deepEqual(states.filter((row) => completedIds.includes(row.client_followup_item_id)).map((row) => row.queue_status), ["resolved", "resolved", "resolved"]);

      await returnTo(memberAPage);
      const pipeline = await memberAPage.fetchJson("GET", pipelinePath(ORG_A, PROJECT_A));
      const hamper = apiFile(pipeline, await fileKeyForClaim(claimId));
      assert.deepEqual([hamper.currentStage, hamper.currentStatus, currentStageOf(hamper).count], ["impact_fact_review", "waiting_for_client", 1],
        "one follow-up still needs a client answer");
      results.P3_F = { completed: completedIds.length, hamper: [hamper.currentStage, hamper.currentStatus, currentStageOf(hamper).count] };
    });

    await test("P3-H: revoking client_reviewer in another session removes the completion action when the reviewer returns, a direct completion is refused writing nothing, and other capabilities remain; re-granting restores it", async () => {
      const claimId = hamperClaimId();
      const [remaining] = (await openFollowupsFor(claimId)).filter((row) => row.queue_status !== "resolved" && row.queue_status !== "cancelled");
      assert.ok(remaining, "one follow-up is still open");
      assert.equal(await markReviewedCount(clientReviewerAPage), 1, "the authorized form is open");
      await openKnowledgeStudio(clientReviewerAStudioPage);
      await clientReviewerAStudioPage.clickTab("Gaps");
      await clientReviewerAStudioPage.waitForText("Answer follow-up questions");

      const revoked = await storedAdminPage.fetchJson("PUT", membershipPath(ORG_A, USERS.clientReviewerA), { role_name: "client_contributor", membership_status: "active" });
      assert.equal(revoked.status, 200, JSON.stringify(revoked));

      await returnTo(clientReviewerAPage);
      await clientReviewerAPage.waitFor(async () => (await markReviewedCount(clientReviewerAPage)) === 0, "the completion action removed after revalidation");
      await returnTo(clientReviewerAStudioPage);
      await clientReviewerAStudioPage.waitFor(async () => !(await clientReviewerAStudioPage.text()).includes("Answer follow-up questions"),
        "the Studio's follow-up entry removed after revalidation");

      const before = await allKaiCounts();
      const direct = await clientReviewerAPage.fetchJson("POST", followupCompletePathFor(ORG_A, claimId, remaining.client_followup_item_id),
        { expected_updated_at: new Date(remaining.updated_at).toISOString() });
      await assertNothingWritten(before, "revoked client reviewer completion");
      assert.equal(direct.status, 403, JSON.stringify(direct));
      const stillReads = await clientReviewerAPage.fetchJson("GET", pipelinePath(ORG_A, PROJECT_A));
      assert.equal(stillReads.status, 200, "the unrevoked membership still reads the project");

      const regranted = await storedAdminPage.fetchJson("PUT", membershipPath(ORG_A, USERS.clientReviewerA), { role_name: "client_reviewer", membership_status: "active" });
      assert.equal(regranted.status, 200);
      await openFollowups(clientReviewerAPage, ORG_A);
      await clientReviewerAPage.waitFor(async () => (await markReviewedCount(clientReviewerAPage)) === 1, "the action back after re-grant");
      await clientReviewerAPage.clickButton("Mark reviewed");
      await clientReviewerAPage.waitFor(async () => (await markReviewedCount(clientReviewerAPage)) === 0, "the last follow-up completed");
      assert.equal((await followupDecisionAudit(remaining.client_followup_item_id)).decided_by_role, "client_reviewer");
      results.P3_H = { direct: [direct.status, direct.errorCode], stillReads: stillReads.status };
    });

    await test("P3-D: a reviewed claim blocked by coverage is shown as not currently usable; after GK acceptance it becomes an Impact Fact for the internal audience only, shown to the member on return", async () => {
      const claimId = hamperClaimId();
      const claimFileKey = await fileKeyForClaim(claimId);
      const pipelineBlocked = await memberAPage.fetchJson("GET", pipelinePath(ORG_A, PROJECT_A));
      const blockedFile = apiFile(pipelineBlocked, claimFileKey);
      // Authoritative: the file's other claims. A claim still awaiting GK
      // review keeps the file at Impact Fact review with Get Kinder; with
      // none, the reviewed-but-ineligible claim is "not currently eligible".
      const [{ pending: otherClaimsPendingReview }] = await query(
        `SELECT count(*)::int AS pending FROM kai.claims cl
           JOIN kai.evidence_items e ON e.organization_id = cl.organization_id AND e.evidence_item_id = cl.evidence_item_id
           JOIN kai.source_versions v ON v.organization_id = e.organization_id AND v.source_version_id = e.source_version_id AND v.is_current
           JOIN kai.intake_source_candidates c ON c.organization_id = v.organization_id AND c.intake_source_candidate_id = v.intake_source_candidate_id
          WHERE cl.organization_id = $1::uuid AND c.intake_file_id = $2::uuid AND cl.claim_review_status = 'needs_gk_review'`, [ORG_A, FILES[claimFileKey]]);
      const expectedBlocked = otherClaimsPendingReview > 0
        ? ["impact_fact_review", "waiting_for_get_kinder", "impact_fact_review_pending"]
        : ["impact_fact_review", "not_currently_eligible", "not_currently_eligible"];
      assert.deepEqual([blockedFile.currentStage, blockedFile.currentStatus, blockedFile.reason], expectedBlocked);
      await openClientTab(memberAPage, "Evidence");
      await memberAPage.waitForText(pipelineLogic.pipelineReasonMessage(expectedBlocked[2], 1));
      assert.ok(!(await memberAPage.text()).includes("Reviewed for internal use"), "the blocked claim is not shown as usable");
      const internalBefore = await reviewerPage.fetchJson("GET", `${INTAKE}/admin/organizations/${ORG_A}/claims/${claimId}/traceability?requested_audience=internal`);
      assert.equal(internalBefore.data.eligible, false);
      assert.ok(internalBefore.data.blockerCodes.includes("coverage_dimension_unresolved"));

      const accepted = [];
      for (const [dimensionKey, value] of Object.entries(internalBefore.data.dimensions)) {
        if (value.assessment_status !== "unresolved" || value.internal_limitation_accepted) continue;
        const response = await reviewerPage.fetchJson("POST", internalAcceptancePath(ORG_A, claimId, dimensionKey), {});
        assert.ok([200, 201].includes(response.status), `${dimensionKey}: ${JSON.stringify(response)}`);
        accepted.push(dimensionKey);
      }
      const internalAfter = await reviewerPage.fetchJson("GET", `${INTAKE}/admin/organizations/${ORG_A}/claims/${claimId}/traceability?requested_audience=internal`);
      const funder = await reviewerPage.fetchJson("GET", `${INTAKE}/admin/organizations/${ORG_A}/claims/${claimId}/traceability?requested_audience=funder`);
      assert.equal(internalAfter.data.eligible, true, JSON.stringify(internalAfter.data.blockerCodes));
      assert.equal(funder.data.eligible, false, "approved for internal use is not approved for every audience");
      const expectedLimitations = Object.entries(internalAfter.data.dimensions)
        .filter(([, value]) => value.assessment_status === "unresolved" && value.internal_limitation_accepted).map(([key]) => key).sort();

      // Return to the page: the facts and the project pipeline are re-read in place.
      await returnTo(memberAPage);
      const facts = await memberAPage.fetchJson("GET", impactFactsPath());
      assert.deepEqual(facts.data.items.map((fact) => fact.claimId), [claimId], "exactly the eligible claim");
      const [fact] = facts.data.items;
      assert.deepEqual([...fact.limitationDimensionKeys].sort(), expectedLimitations);
      const [claimRow] = await query("SELECT statement FROM kai.claims WHERE organization_id = $1::uuid AND claim_id = $2::uuid", [ORG_A, claimId]);
      assert.equal(fact.statement, claimRow.statement);
      await memberAPage.waitForText("Reviewed for internal use");
      const text = await memberAPage.text();
      assert.ok(text.includes(claimRow.statement));
      for (const key of expectedLimitations) assert.ok(text.includes(`Known limitation: ${key.replace(/_/g, " ")}`), key);
      const pipeline = await memberAPage.fetchJson("GET", pipelinePath(ORG_A, PROJECT_A));
      const hamper = apiFile(pipeline, claimFileKey);
      assert.deepEqual([hamper.currentStage, hamper.currentStatus, hamper.reviewedImpactFactCount], [null, "complete", 1]);
      assert.ok(!pipeline.data.reviewedImpactFacts.some((entry) => entry.claimId === results.P3_C.claim), "the pantry claim awaiting review is not an Impact Fact");

      // The organization-wide view (no project) and the Impact Library show the same fact.
      await memberAPage.clickNav("Impact Library");
      await memberAPage.waitForText(claimRow.statement);
      const generated = await memberAPage.fetchJson("GET", `${INTAKE}/admin/organizations/${ORG_A}/engagements/${PROJECT_A}/client-generated-drafts`);
      assert.deepEqual(memberAPage.exceptions, []);
      results.P3_D = { claimFile: NAMES[claimFileKey], blocked: expectedBlocked, accepted, eligibleInternal: true, eligibleFunder: false, limitations: expectedLimitations, generatedDraftsRead: generated.status };
      console.log(`[campaign] P3-D claim readback: ${JSON.stringify(results.P3_D)}`);
    });

    await test("P3-E: gaps, coverage limitations, and follow-up requirements appear only as client-safe status; no GK notes, gap text, reviewer ids, or blocked evidence reach the member", async () => {
      const claimId = hamperClaimId();
      const facts = await memberAPage.fetchJson("GET", impactFactsPath());
      for (const fact of facts.data.items) assert.deepEqual(Object.keys(fact).sort(), ["claimId", "claimType", "limitationDimensionKeys", "statement"]);
      const coverage = await query("SELECT dimension_key, decided_by::text FROM kai.coverage_review_decisions WHERE organization_id = $1::uuid AND claim_id = $2::uuid", [ORG_A, claimId]);
      assert.ok(coverage.length >= results.P3_D.accepted.length);
      const pipeline = await memberAPage.fetchJson("GET", pipelinePath(ORG_A, PROJECT_A));
      const payloads = JSON.stringify([facts.data, pipeline.data]);
      const forbidden = [
        ...(await query("SELECT client_followup_item_id::text AS id FROM kai.client_followup_items WHERE organization_id = $1::uuid", [ORG_A])).map((row) => row.id),
        ...(await query("SELECT evidence_item_id::text AS id FROM kai.evidence_items WHERE organization_id = $1::uuid", [ORG_A])).map((row) => row.id),
        ...coverage.map((row) => row.decided_by),
        kaiUserIds.reviewer, kaiUserIds.gkOperator, kaiUserIds.clientReviewerA,
      ];
      for (const id of forbidden) assert.ok(!payloads.includes(id), `client payload carries no ${id}`);
      await memberAPage.clickNav("Knowledge Studio");
      await memberAPage.waitFor(async () => memberAPage.evaluate(`Boolean(document.querySelector(".nav-tabs"))`), "Knowledge Studio tabs");
      await memberAPage.clickTab("Gaps");
      await memberAPage.idle();
      const gapsText = await memberAPage.text();
      assert.ok(gapsText.includes("Get Kinder reviewers identify evidence gaps and risks"));
      assert.ok(!gapsText.includes("Answer follow-up questions"), "no follow-up action for an ordinary member");
      results.P3_E = { factKeys: ["claimId", "claimType", "limitationDimensionKeys", "statement"], coverageDecisions: coverage.length };
    });

    await test("P3-G: project switching and a full reload keep each project's files and facts; Org B sees only its own project", async () => {
      await openClientProject(memberAPage, PROJECT_A2, "Evidence");
      const a2 = await memberAPage.fetchJson("GET", pipelinePath(ORG_A, PROJECT_A2));
      assert.deepEqual(a2.data.files.map((file) => file.intakeFileId), [FILES.projectTwo]);
      assert.deepEqual(a2.data.reviewedImpactFacts, []);
      await memberAPage.waitForText("No reviewed evidence for this project yet.");
      assert.ok(!(await memberAPage.text()).includes("Reviewed for internal use"), "Project A's fact is not attributed to Project A2");

      await memberAPage.goto("/impact-library");
      await openClientProject(memberAPage, PROJECT_A, "Evidence");
      await memberAPage.waitForText("Reviewed for internal use");
      await memberAPage.clickTab("Reviews");
      await memberAPage.idle();
      assert.ok(!(await memberAPage.text()).includes(NAMES.projectTwo));

      await openClientProject(memberBPage, PROJECT_B, "Reviews");
      const b = await memberBPage.fetchJson("GET", pipelinePath(ORG_B, PROJECT_B));
      assert.deepEqual(b.data.files.map((file) => file.intakeFileId), [FILES.otherOrg]);
      const bText = await memberBPage.text();
      for (const key of ["probe", "mixed", "superGk", "bound", "reviewer", "projectTwo"]) assert.ok(!bText.includes(NAMES[key]), `Org B sees no ${NAMES[key]}`);
      assert.deepEqual(memberBPage.exceptions, []);
      results.P3_G = { a2: a2.data.files.length, b: b.data.files.length };
    });

    await test("P3-I: late responses for a superseded project or follow-up organization are discarded", async () => {
      await openClientProject(memberAPage, PROJECT_A, "Reviews");
      await memberAPage.waitFor(async () => (await memberAPage.text()).includes(NAMES.probe), "Project A loaded");
      await delayResponses(memberAPage, `/engagements/${PROJECT_A}/client-evidence-pipeline`, 2500);
      await memberAPage.selectProject(PROJECT_A2);
      await memberAPage.idle();
      await memberAPage.selectProject(PROJECT_A);
      await new Promise((resolve) => setTimeout(resolve, 150));
      await memberAPage.selectProject(PROJECT_A2);
      await memberAPage.waitForText(NAMES.projectTwo);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const settled = await memberAPage.text();
      assert.ok(settled.includes(NAMES.projectTwo));
      for (const key of ["probe", "superGk", "bound"]) assert.ok(!settled.includes(NAMES[key]), `the late Project A response did not replace Project A2 (${NAMES[key]})`);
      assert.ok(await memberAPage.evaluate("window.__p3Delayed || 0") >= 1, "a Project A response was actually delivered late");
      await restoreFetch(memberAPage);

      await clientReviewerAPage.goto(`/kai/client-followups?organizationId=${ORG_A}`);
      await clientReviewerAPage.waitForText("Client Follow-ups");
      await delayResponses(clientReviewerAPage, `/organizations/${ORG_A}/client-followups`, 2500);
      await clientReviewerAPage.clickButton("Load follow-ups");
      await clientReviewerAPage.evaluate(`(() => {
        const input = document.querySelector("input.form-control");
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, ${JSON.stringify(ORG_C)});
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })()`);
      // The late Org A answer arrives while the field already names Org C: it
      // must not appear as Org C's follow-ups (nor offer actions for them).
      await new Promise((resolve) => setTimeout(resolve, 3000));
      assert.ok(await clientReviewerAPage.evaluate("window.__p3Delayed || 0") >= 1, "the Org A follow-up response was actually delivered late");
      const afterLateResponse = await clientReviewerAPage.text();
      assert.ok(!afterLateResponse.includes(`Claim ${hamperClaimId()}`), "the late Org A list is not shown under Org C");
      assert.equal(await markReviewedCount(clientReviewerAPage), 0);
      await clientReviewerAPage.clickButton("Load follow-ups");
      await clientReviewerAPage.idle();
      assert.ok(!(await clientReviewerAPage.text()).includes(`Claim ${hamperClaimId()}`));
      assert.ok(await clientReviewerAPage.evaluate(`Boolean(document.querySelector(".alert-warning"))`), "the Org C refusal is what is shown");
      await restoreFetch(clientReviewerAPage);
      results.P3_I = "PASS: superseded project pipeline and follow-up list responses discarded";
    });

    await test("P3-J: wrong-organization, revoked, and ordinary actors get no other organization's, GK-only, or blocked objects through the API or the page", async () => {
      const memberBReads = await Promise.all([
        memberBPage.fetchJson("GET", pipelinePath(ORG_A, PROJECT_A)),
        memberBPage.fetchJson("GET", impactFactsPath(ORG_A)),
        memberBPage.fetchJson("GET", followupsPath(ORG_A)),
      ]);
      assert.deepEqual(memberBReads.map((read) => read.status), [403, 403, 403]);
      const memberAReads = await Promise.all([
        memberAPage.fetchJson("GET", pipelinePath(ORG_B, PROJECT_B)),
        memberAPage.fetchJson("GET", sourceQueuePath()),
        memberAPage.fetchJson("GET", `${INTAKE}/admin/organizations/${ORG_A}/claims/${hamperClaimId()}/traceability?requested_audience=internal`),
        memberAPage.fetchJson("GET", candidatePath((await candidateFor(profiles.superGk)).intake_source_candidate_id)),
      ]);
      assert.deepEqual(memberAReads.map((read) => read.status), [403, 403, 403, 403]);
      const facts = await memberAPage.fetchJson("GET", impactFactsPath());
      const blockedClaims = await query("SELECT claim_id::text FROM kai.claims WHERE organization_id = $1::uuid AND claim_id <> $2::uuid", [ORG_A, hamperClaimId()]);
      for (const { claim_id: id } of blockedClaims) assert.ok(!facts.data.items.some((fact) => fact.claimId === id), `ineligible claim ${id} withheld`);
      const memberBFacts = await memberBPage.fetchJson("GET", impactFactsPath(ORG_B));
      assert.deepEqual([memberBFacts.status, memberBFacts.data.items], [200, []]);
      results.P3_J = { memberB: memberBReads.map((read) => read.status), memberA: memberAReads.map((read) => read.status), withheld: blockedClaims.length };
    });

    await test("J7-0: switching between two projects in the same organization changes only the scoped client file and review actions", async () => {
      await openKnowledgeStudio(boundAdminPage);
      await boundAdminPage.waitFor(() => boundAdminPage.evaluate(`(() => {
        const select = document.getElementById("gk-shell-project-select");
        return Boolean(select && [...select.options].some((option) => option.value === "${PROJECT_A}")
          && [...select.options].some((option) => option.value === "${PROJECT_A2}"));
      })()`), "both organization projects in the project selector");
      await boundAdminPage.selectProject(PROJECT_A);
      await boundAdminPage.idle();
      await boundAdminPage.clickTab("Reviews");
      await boundAdminPage.idle();
      const firstActions = await boundAdminPage.fileReviewActionIds();
      const firstPipeline = await boundAdminPage.fetchJson("GET", pipelinePath(ORG_A, PROJECT_A));
      assert.equal(firstPipeline.status, 200);
      assert.ok(findFile(firstPipeline.data, FILES.probe), "project one contains its own pending file");
      assert.equal(findFile(firstPipeline.data, FILES.projectTwo), null, "project one excludes project two's file");
      assert.ok(!firstActions.includes(FILES.projectTwo));

      await boundAdminPage.selectProject(PROJECT_A2);
      await boundAdminPage.idle();
      await boundAdminPage.clickTab("Reviews");
      await boundAdminPage.idle();
      const secondActions = await boundAdminPage.fileReviewActionIds();
      const secondPipeline = await boundAdminPage.fetchJson("GET", pipelinePath(ORG_A, PROJECT_A2));
      assert.equal(secondPipeline.status, 200);
      assert.ok(findFile(secondPipeline.data, FILES.projectTwo), "project two contains its own pending file");
      assert.equal(findFile(secondPipeline.data, FILES.probe), null, "project two excludes project one's file");
      assert.ok(secondActions.includes(FILES.projectTwo), "the bound admin sees the permitted sensitivity action in project two");
      assert.ok(!secondActions.includes(FILES.probe));
      results.J7_0 = { firstActions, secondActions, firstPipeline: firstPipeline.status, secondPipeline: secondPipeline.status };
    });

    await test("J7-1: an inactive binding removes the bound administrator's (and the superuser's derived) access at once, writing nothing", async () => {
      await query("UPDATE kai.gk_organization_bindings SET status = 'inactive' WHERE kai_organization_id = $1::uuid", [ORG_A]);
      try {
        const cockpit = await boundAdminPage.fetchJson("GET", cockpitCapabilitiesPath(ORG_A));
        const access = await boundAdminPage.fetchJson("GET", accessCapabilitiesPath(ORG_A));
        const superCockpit = await superGkPage.fetchJson("GET", cockpitCapabilitiesPath(ORG_A));
        const before = await allKaiCounts();
        const decision = await boundAdminPage.fetchJson("POST", decisionPath(profiles.probe), FAKE_DECISION_BODY);
        const work = await boundAdminPage.fetchJson("POST", reviewWorkPath(profiles.probe), {});
        await assertNothingWritten(before, "inactive binding");
        results.J7_1 = { cockpit: cockpit.data?.can_manage_sensitivity_review, access: access.status, superCockpit: superCockpit.data?.can_manage_sensitivity_review, decision: decision.status, work: work.status };
        assert.deepEqual([cockpit.data.can_manage_sensitivity_review, access.status, superCockpit.data.can_manage_sensitivity_review, decision.status, work.status],
          [false, 403, false, 403, 403]);
      } finally {
        await query("UPDATE kai.gk_organization_bindings SET status = 'active' WHERE kai_organization_id = $1::uuid", [ORG_A]);
      }
      const restored = await boundAdminPage.fetchJson("GET", cockpitCapabilitiesPath(ORG_A));
      assert.equal(restored.data.can_manage_sensitivity_review, true, "capability returns with the binding (no stale cache)");
    });

    await test("J7-2: a deactivated KAI identity is refused everywhere, writing nothing", async () => {
      await query("UPDATE kai.users SET status = 'inactive' WHERE user_id = $1::uuid", [kaiUserIds.reviewer]);
      try {
        const access = await reviewerPage.fetchJson("GET", accessCapabilitiesPath(ORG_A));
        const cockpit = await reviewerPage.fetchJson("GET", cockpitCapabilitiesPath(ORG_A));
        const candidate = await candidateFor(profiles.mixed);
        const before = await allKaiCounts();
        const promote = await reviewerPage.fetchJson("POST", candidateDecisionPath(candidate.intake_source_candidate_id), PROMOTE_BODY);
        await assertNothingWritten(before, "inactive identity");
        results.J7_2 = { access: [access.status, access.errorCode], cockpit: cockpit.data?.can_manage_sensitivity_review, promote: [promote.status, promote.errorCode] };
        assert.equal(access.status, 403);
        assert.equal(cockpit.data.can_manage_sensitivity_review, false);
        assert.equal(promote.status, 403);
      } finally {
        await query("UPDATE kai.users SET status = 'active' WHERE user_id = $1::uuid", [kaiUserIds.reviewer]);
      }
    });

    const otherOrgPage = await session(USERS.otherOrgReviewer);
    await test("J7-3: cross-organization: a full GK reviewer of Org B is refused on Org A objects, and the Org A reviewer on Org B's profile, writing nothing", async () => {
      await otherOrgPage.goto("/impact-library");
      await otherOrgPage.idle();
      const candidate = await candidateFor(profiles.mixed);
      const evidence = await evidenceForCandidate((await candidateFor(profiles.bound)).intake_source_candidate_id);
      const open = evidence.find((row) => row.queue_status === "open");
      const before = await allKaiCounts();
      const outcomes = {
        cockpit: (await otherOrgPage.fetchJson("GET", cockpitCapabilitiesPath(ORG_A))).data?.can_manage_sensitivity_review,
        detail: (await otherOrgPage.fetchJson("GET", candidatePath(candidate.intake_source_candidate_id))).status,
        promote: (await otherOrgPage.fetchJson("POST", candidateDecisionPath(candidate.intake_source_candidate_id), PROMOTE_BODY)).status,
        evidenceReview: open ? (await otherOrgPage.fetchJson("POST", evidenceReviewPath(ORG_A, open.evidence_item_id, open.queue_item),
          { expected_updated_at: new Date(open.updated_at).toISOString(), decision: "supported" })).status : null,
        orgAProfileViaOrgB: (await otherOrgPage.fetchJson("GET", profilePath(profiles.mixed, ORG_B))).status,
        reviewerOnOrgB: (await reviewerPage.fetchJson("POST", decisionPath(profiles.otherOrg, ORG_B), FAKE_DECISION_BODY)).status,
      };
      await assertNothingWritten(before, "cross-organization");
      results.J7_3 = outcomes;
      console.log(`[campaign] J7-3 cross-organization: ${JSON.stringify(outcomes)}`);
      assert.equal(outcomes.cockpit, false);
      assert.deepEqual([outcomes.detail, outcomes.promote, outcomes.reviewerOnOrgB], [403, 403, 403]);
      if (open) assert.equal(outcomes.evidenceReview, 403);
      assert.ok([403, 404].includes(outcomes.orgAProfileViaOrgB), "an Org A profile is never served through Org B scope");
    });

    await test("J7-4: revoking the reviewer's global role ends source review at once; the organization role alone still admits evidence review (recorded open decision)", async () => {
      const revoked = await superGkPage.fetchJson("PUT", globalRolePath(USERS.reviewer), { role_name: "gk_reviewer", action: "revoke" });
      assert.equal(revoked.status, 200);
      const cockpit = await reviewerPage.fetchJson("GET", cockpitCapabilitiesPath(ORG_A));
      const candidate = await candidateFor(profiles.mixed);
      const before = await allKaiCounts();
      const promote = await reviewerPage.fetchJson("POST", candidateDecisionPath(candidate.intake_source_candidate_id), PROMOTE_BODY);
      await assertNothingWritten(before, "revoked global role promotion");
      results.J7_4 = { cockpit: cockpit.data?.can_manage_sensitivity_review, promote: [promote.status, promote.blockingReason] };
      assert.equal(cockpit.data.can_manage_sensitivity_review, false);
      assert.equal(promote.status, 403);
      const removed = await superGkPage.fetchJson("PUT", membershipPath(ORG_A, USERS.reviewer), { role_name: "gk_reviewer", membership_status: "inactive" });
      assert.equal(removed.status, 200);
      const afterRemoval = await reviewerPage.fetchJson("GET", accessCapabilitiesPath(ORG_A));
      assert.equal(afterRemoval.status, 403);
    });

    // =====================================================================
    // J8. Owner decision B/E: governed operator provisioning -> P1-08 ->
    // targeted revocation. Every role below is written by a governed route;
    // the organization gk_operator grant and its revocation are made in the
    // Team & Access UI by a delegated GK administrator (global gk_admin +
    // organization gk_admin), never a superuser and never seeded.
    // =====================================================================
    const GOVERNED_FILES = Object.freeze({ promote: "21000000-0000-4000-8000-0000000da108", afterRevoke: "21000000-0000-4000-8000-0000000da109" });
    const governedProfiles = {};
    const operatorRowKey = `legacy:${USERS.governedOperator}`;
    const gkDelegatePage = await session(USERS.gkDelegate);
    const governedOperatorPage = await session(USERS.governedOperator);
    const memberRowText = (page, key) => page.evaluate(`(() => {
      const el = document.querySelector('[data-team-access-member="${key}"]');
      return el ? el.innerText : null;
    })()`);
    // A role badge (never a <select> option, whose label is also in innerText).
    const memberHasRoleBadge = (page, key, roleName) => page.evaluate(
      `Boolean(document.querySelector('[data-team-access-member="${key}"] .gk-team-access-role--${roleName}'))`);
    const clickMemberButton = (page, key, label) => page.clickWhere(`member ${key} ${label}`,
      `() => [...document.querySelectorAll('[data-team-access-member="${key}"] button')].find((el) => el.innerText.trim() === ${JSON.stringify(label)} && !el.disabled)`);
    const storedRolesOf = async (key) => (await query(
      "SELECT role_name, membership_status FROM kai.organization_memberships WHERE organization_id = $1::uuid AND user_id = $2::uuid ORDER BY role_name",
      [ORG_A, kaiUserIds[key]]));
    const auditRowsOf = async (key) => query(
      "SELECT action, metadata FROM kai.audit_events WHERE actor_user_id = $1::uuid ORDER BY audit_event_id", [kaiUserIds[key]]);
    async function pendingGovernedCandidate(fileKey, checksumChar) {
      governedProfiles[fileKey] = await seedFreshFile({
        organizationId: ORG_A, batchId: BATCH_A, engagementId: PROJECT_A, intakeFileId: GOVERNED_FILES[fileKey],
        name: `synthetic_tidewater_governed_${fileKey}.csv`, checksumChar,
      });
      await openReviewWork(ORG_A, governedProfiles[fileKey]);
      const decided = await decideReviewedByApi(superGkPage, governedProfiles[fileKey]);
      assert.equal(decided.status, 200, JSON.stringify(decided));
      const candidate = await candidateFor(governedProfiles[fileKey]);
      assert.deepEqual([candidate.candidate_status, candidate.queue_status], ["needs_gk_review", "open"]);
      return candidate;
    }
    // The operator's P1-08 authority as the server reports and enforces it,
    // on a pending candidate: detail controls and a direct decision request.
    async function operatorPromotionRefused(candidate, label) {
      const detail = await governedOperatorPage.fetchJson("GET", candidatePath(candidate.intake_source_candidate_id));
      if (detail.status === 200) assert.equal(detail.data.decision_controls_enabled, false, `${label}: no decision controls`);
      else assert.equal(detail.status, 403, `${label}: detail refused`);
      const before = await allKaiCounts();
      const direct = await governedOperatorPage.fetchJson("POST", candidateDecisionPath(candidate.intake_source_candidate_id), PROMOTE_BODY);
      await assertNothingWritten(before, label);
      assert.deepEqual([direct.status, direct.errorCode, direct.blockingReason], [403, "authorization_denied", "role_not_allowed"], label);
      return { detail: detail.status, direct: [direct.status, direct.blockingReason] };
    }

    await test("J8-1: the superuser provisions a delegated GK administrator (global gk_admin, organization gk_admin) and the operator's client role and global gk_operator through the governed routes; the global role alone gives no P1-08 decision", async () => {
      const before = await allKaiCounts();
      const delegateGlobal = await superGkPage.fetchJson("PUT", globalRolePath(USERS.gkDelegate), { role_name: "gk_admin", action: "assign" });
      const delegateOrganization = await superGkPage.fetchJson("POST", `${membershipPath(ORG_A, USERS.gkDelegate)}/roles`, { role_name: "gk_admin" });
      const operatorClient = await superGkPage.fetchJson("POST", `${membershipPath(ORG_A, USERS.governedOperator)}/roles`, { role_name: "client_contributor" });
      const operatorGlobal = await superGkPage.fetchJson("PUT", globalRolePath(USERS.governedOperator), { role_name: "gk_operator", action: "assign" });
      assert.deepEqual([delegateGlobal.status, delegateOrganization.status, operatorClient.status, operatorGlobal.status], [200, 200, 200, 200]);
      assert.deepEqual([delegateOrganization.data.organization_access_admitted, operatorClient.data.organization_access_admitted], [true, true]);
      assert.deepEqual(changedTables(before, await allKaiCounts()), ["audit_events", "organization_memberships", "user_roles"]);
      assert.deepEqual(await storedRolesOf("gkDelegate"), [{ role_name: "gk_admin", membership_status: "active" }]);
      assert.deepEqual(await storedRolesOf("governedOperator"), [{ role_name: "client_contributor", membership_status: "active" }]);
      const candidate = await pendingGovernedCandidate("promote", "8");
      results.J8_1 = { globalOnly: await operatorPromotionRefused(candidate, "J8-1 global gk_operator only") };
    });

    await test("J8-2: the delegated GK administrator adds organization gk_operator in Team & Access; the client role is preserved and the grant is audited with delegated authority", async () => {
      await gkDelegatePage.goto("/impact-library");
      await gkDelegatePage.waitForText("Knowledge Studio");
      const access = await gkDelegatePage.fetchJson("GET", accessCapabilitiesPath(ORG_A));
      assert.equal(access.data.organizationAccessManagement, true, "Team & Access is offered to the delegated GK administrator");
      await gkDelegatePage.clickNav("Team & Access");
      await gkDelegatePage.waitFor(async () => /Contributor/.test(await memberRowText(gkDelegatePage, operatorRowKey) || ""), "the operator's Team & Access row");
      await gkDelegatePage.idle();
      const selfRow = await memberRowText(gkDelegatePage, `legacy:${USERS.gkDelegate}`);
      assert.ok(selfRow && !/Add role/.test(selfRow), "no role may be added to the administrator's own row");
      await gkDelegatePage.setSelectWhere(`() => document.getElementById("gk-team-access-add-role-legacy-${USERS.governedOperator}")`, "gk_operator");
      const before = await allKaiCounts();
      const auditBefore = (await auditRowsOf("gkDelegate")).length;
      const mark = gkDelegatePage.mark();
      await clickMemberButton(gkDelegatePage, operatorRowKey, "Add role");
      assert.equal(await memberHasRoleBadge(gkDelegatePage, operatorRowKey, "gk_operator"), false, "no organization operator role before the grant");
      await gkDelegatePage.waitFor(() => memberHasRoleBadge(gkDelegatePage, operatorRowKey, "gk_operator"), "the added Get Kinder operator role");
      await gkDelegatePage.idle();
      // Repair 1: a delegated GK administrator's operator grant is staff
      // onboarding; the global operator role was already held (J8-1), so
      // only the organization assignment is written.
      assert.deepEqual(writes(gkDelegatePage.requestsSince(mark)), [["POST", staffPath(ORG_A, USERS.governedOperator), 200]]);
      assert.deepEqual(changedTables(before, await allKaiCounts()), ["audit_events", "organization_memberships"]);
      await gkDelegatePage.waitForText("with the global Get Kinder operator role, and can sign in and start now.");
      assert.deepEqual(await storedRolesOf("governedOperator"), [
        { role_name: "client_contributor", membership_status: "active" },
        { role_name: "gk_operator", membership_status: "active" },
      ]);
      const newAudits = (await auditRowsOf("gkDelegate")).slice(auditBefore);
      assert.deepEqual(newAudits.map((audit) => [audit.action, audit.metadata.role_name, audit.metadata.authority_source, audit.metadata.target_user_id]),
        [["organization_role_granted", "gk_operator", "delegated_gk_admin", kaiUserIds.governedOperator]]);
      assert.deepEqual(gkDelegatePage.exceptions, []);
      results.J8_2 = "PASS: Team & Access Add role -> POST .../gk-staff/:id 200 (global already held); client_contributor kept; audit organization_role_granted (delegated_gk_admin)";
    });

    await test("J8-3: the governed operator discovers, opens, and promotes the pending source in the GK Studio; decision, attribution, lineage, audit, and P2-01 evidence persist", async () => {
      const candidate = await candidateFor(governedProfiles.promote);
      const { changed, newAudit } = await assertStudioPromotion(governedOperatorPage, "governedOperator", candidate, "J8-3");
      assert.deepEqual(governedOperatorPage.exceptions, []);
      results.J8_3 = { changed, newAudit };
    });

    await test("J8-4: the delegated GK administrator offboards the operator in Team & Access - organization gk_operator and, since it reached no other organization, the global role; the operator's next P1-08 request is refused writing nothing, while the client role and the recorded decision remain", async () => {
      const promoted = await candidateFor(governedProfiles.promote);
      const pending = await pendingGovernedCandidate("afterRevoke", "9");
      await gkDelegatePage.goto("/impact-library");
      await gkDelegatePage.waitForText("Knowledge Studio");
      await gkDelegatePage.clickNav("Team & Access");
      await gkDelegatePage.waitFor(() => memberHasRoleBadge(gkDelegatePage, operatorRowKey, "gk_operator"), "the operator's active Get Kinder operator role");
      await gkDelegatePage.idle();
      const before = await allKaiCounts();
      const mark = gkDelegatePage.mark();
      await clickMemberButton(gkDelegatePage, operatorRowKey, "Remove Get Kinder operator role");
      await gkDelegatePage.waitFor(async () => /keeps their other roles\. Their global Get Kinder operator role is removed too, unless another assignment or organization still needs it\./
        .test(await memberRowText(gkDelegatePage, operatorRowKey) || ""), "the revocation confirmation");
      assert.deepEqual(writes(gkDelegatePage.requestsSince(mark)), [], "nothing is sent before confirmation");
      await clickMemberButton(gkDelegatePage, operatorRowKey, "Confirm removing Get Kinder operator");
      await gkDelegatePage.waitFor(async () => /Get Kinder operator \(inactive\)/.test(await memberRowText(gkDelegatePage, operatorRowKey) || "")
        && !(await memberHasRoleBadge(gkDelegatePage, operatorRowKey, "gk_operator")), "the inactive assignment");
      await gkDelegatePage.idle();
      assert.deepEqual(writes(gkDelegatePage.requestsSince(mark)), [["POST", staffRevokePath(ORG_A, USERS.governedOperator, "gk_operator"), 200]]);
      assert.deepEqual(changedTables(before, await allKaiCounts()), ["audit_events"]);
      await gkDelegatePage.waitForText("and the global Get Kinder operator role was removed. Their other roles are unchanged.");
      assert.deepEqual(await storedRolesOf("governedOperator"), [
        { role_name: "client_contributor", membership_status: "active" },
        { role_name: "gk_operator", membership_status: "inactive" },
      ]);
      const audits = (await auditRowsOf("gkDelegate")).slice(-2);
      assert.deepEqual(audits.map((audit) => [audit.action, audit.metadata.role_name, audit.metadata.authority_source]), [
        ["organization_role_revoked", "gk_operator", "delegated_gk_admin"],
        ["global_kai_role_revoked", "gk_operator", "delegated_gk_admin"],
      ]);
      assert.deepEqual([audits[0].metadata.previous_membership_status, audits[0].metadata.resulting_membership_status], ["active", "inactive"]);

      const refused = await operatorPromotionRefused(pending, "J8-4 offboarded operator");
      const operatorAccess = await governedOperatorPage.fetchJson("GET", accessCapabilitiesPath(ORG_A));
      assert.equal(operatorAccess.status, 200, "the client role keeps organization access");
      assert.deepEqual([operatorAccess.data.internalKnowledgeWorkspace, (await governedOperatorPage.fetchJson("GET", cockpitCapabilitiesPath(ORG_A))).data.can_review_source_candidates],
        [false, false], "no Get Kinder capability survives through the client role");
      const [globalRole] = await query(
        "SELECT ur.active FROM kai.user_roles ur JOIN kai.roles r ON r.role_id = ur.role_id WHERE ur.user_id = $1::uuid AND r.role_name = 'gk_operator' AND ur.organization_id IS NULL",
        [kaiUserIds.governedOperator]);
      assert.equal(globalRole.active, false, "the global operator role, which reached only this organization, is revoked with the assignment (soft state)");
      const decision = await promotionDecisionRow(promoted.intake_source_candidate_id);
      assert.deepEqual([decision.decision_status, decision.decided_by], ["promoted", kaiUserIds.governedOperator], "the recorded human decision remains");
      assert.deepEqual(gkDelegatePage.exceptions, []);
      results.J8_4 = { refused, operatorAccess: operatorAccess.status };
    });

    // =====================================================================
    // J9. Platform administrator -> delegated GK administrator -> operator
    // and reviewer grants -> effective product access -> revocation. Every
    // role is written by the governed product: the /admin KAI Access modal
    // where it offers the control, otherwise the same mounted
    // superuser-only route; Team & Access for every delegated grant.
    // =====================================================================
    const newGkAdminPage = await session(USERS.newGkAdmin);
    const opsPage = await session(USERS.opsRecipient);
    const revPage = await session(USERS.revRecipient);
    const rowKeyOf = (legacyId) => `legacy:${legacyId}`;
    const activeRolesOf = async (key, organizationId = ORG_A) => (await query(
      "SELECT role_name FROM kai.organization_memberships WHERE organization_id = $1::uuid AND user_id = $2::uuid AND membership_status = 'active' ORDER BY role_name",
      [organizationId, kaiUserIds[key]])).map((row) => row.role_name);
    const globalRolesOf = async (key) => (await query(
      `SELECT r.role_name FROM kai.user_roles ur JOIN kai.roles r ON r.role_id = ur.role_id
        WHERE ur.user_id = $1::uuid AND ur.organization_id IS NULL AND ur.active AND ur.revoked_at IS NULL ORDER BY r.role_name`,
      [kaiUserIds[key]])).map((row) => row.role_name);
    async function openAdminKaiAccess(page) {
      await page.goto("/admin?tab=organizations");
      await page.waitForText(ORG_A_NAME);
      await page.clickOrganizationKaiAccess(ORG_A_NAME);
      await page.waitForText(`KAI Access — ${ORG_A_NAME}`);
      await page.idle();
    }
    // One read per implemented product surface, from the actor's own session.
    const SURFACES = Object.freeze({
      organizations: () => `${INTAKE}/admin/organizations`,
      capabilities: (org) => accessCapabilitiesPath(org),
      cockpitCapabilities: (org) => cockpitCapabilitiesPath(org),
      projects: (org) => `${INTAKE}/admin/organizations/${org}/engagements`,
      teamAccessRoster: (org) => `${ACCESS}/organizations/${org}/access`,
      dataSources: (org) => `${INTAKE}/admin/organizations/${org}/sources`,
      evidenceLibrary: (org) => `${INTAKE}/admin/organizations/${org}/evidence-library/candidates`,
      claimLibrary: (org) => `${INTAKE}/admin/organizations/${org}/claim-library/candidates`,
      reviewQueue: (org) => `${INTAKE}/admin/organizations/${org}/review-queue`,
      sourceReviewQueue: (org) => sourceQueuePath(org),
      generatedDrafts: (org) => `${INTAKE}/admin/organizations/${org}/generated-content-drafts`,
      eligibleClaims: (org) => `${INTAKE}/admin/organizations/${org}/eligible-claims?requested_audience=internal&limit=25`,
      requirements: (org) => `${INTAKE}/admin/organizations/${org}/requirements`,
      impactFacts: (org) => `${INTAKE}/admin/organizations/${org}/impact-facts`,
      boardReporting: (org) => `${INTAKE}/admin/organizations/${org}/engagements/${org === ORG_A ? PROJECT_A : PROJECT_B}/board-reporting`,
      grantResponsePacket: (org) => `${INTAKE}/admin/organizations/${org}/engagements/${org === ORG_A ? PROJECT_A : PROJECT_B}/grant-response-packet`,
    });
    async function surfaceStatuses(page, organizationId) {
      const statuses = {};
      for (const [name, path] of Object.entries(SURFACES)) {
        const response = await page.fetchJson("GET", path(organizationId));
        statuses[name] = name === "organizations"
          ? (response.data?.items || []).map((item) => item.organization_id).includes(organizationId)
          // The cockpit probe always answers 200; its booleans are the answer.
          : name === "cockpitCapabilities"
            ? `${response.status}:${response.data?.can_review_source_candidates === true}/${response.data?.can_manage_sensitivity_review === true}`
            : response.status;
      }
      return statuses;
    }

    await test("J9-1: the platform superuser makes an existing account a delegated GK administrator of Org A - organization gk_admin from /admin KAI Access, global gk_admin through the governed superuser-only route (the modal does not offer it); no other actor can", async () => {
      await openAdminKaiAccess(superGkPage);
      assert.deepEqual(await superGkPage.modalRoleOptions(), ["client_admin", "client_reviewer", "client_contributor", "gk_reviewer", "gk_operator", "gk_admin"],
        "the superuser's modal offers organization gk_admin");
      // Recipients of the later delegated grants become existing Org A members first.
      for (const legacyId of [USERS.opsRecipient, USERS.revRecipient]) {
        const mark = superGkPage.mark();
        await superGkPage.modalGrant(email(legacyId), "client_contributor");
        await superGkPage.waitFor(async () => Boolean(await superGkPage.accessRowText(legacyId)), `roster row ${legacyId}`);
        await superGkPage.idle();
        assert.deepEqual(writes(superGkPage.requestsSince(mark)), [["POST", `${membershipPath(ORG_A, legacyId)}/roles`, 200]]);
      }
      const before = await allKaiCounts();
      let mark = superGkPage.mark();
      await superGkPage.modalGrant(email(USERS.newGkAdmin), "gk_admin");
      await superGkPage.waitFor(async () => /gk_admin/.test(await superGkPage.accessRowText(USERS.newGkAdmin) || ""), "the new administrator's roster row");
      await superGkPage.idle();
      assert.ok(superGkPage.requestsSince(mark).some((r) => r.method === "GET" && pathOf(r) === "/api/admin/users/lookup" && r.status === 200), "exact-email recipient lookup");
      assert.deepEqual(writes(superGkPage.requestsSince(mark)), [["POST", `${membershipPath(ORG_A, USERS.newGkAdmin)}/roles`, 200]]);
      assert.deepEqual(changedTables(before, await allKaiCounts()), ["audit_events", "organization_memberships"]);
      assert.deepEqual(await activeRolesOf("newGkAdmin"), ["gk_admin"]);
      const row = await superGkPage.accessRowText(USERS.newGkAdmin);
      assert.ok(/Grant gk_reviewer/.test(row) && /Grant gk_operator/.test(row), "the modal's global-role controls");
      assert.ok(!/Grant gk_admin/.test(row), "the modal deliberately offers no global gk_admin control");

      // The organization half alone does not delegate administration.
      await newGkAdminPage.goto("/impact-library");
      await newGkAdminPage.waitForText("Knowledge Studio");
      const orgOnly = await newGkAdminPage.fetchJson("GET", accessCapabilitiesPath(ORG_A));
      assert.deepEqual([orgOnly.status, orgOnly.data.internalKnowledgeWorkspace, orgOnly.data.organizationAccessManagement], [200, true, false]);

      // No one but the platform superuser may assign global gk_admin.
      for (const [label, page] of [["delegated GK administrator", gkDelegatePage], ["client administrator", await session(USERS.storedAdmin)],
        ["ordinary member", await session(USERS.memberA)], ["the recipient (self)", newGkAdminPage]]) {
        const refusedBefore = await allKaiCounts();
        const refused = await page.fetchJson("PUT", globalRolePath(USERS.newGkAdmin), { role_name: "gk_admin", action: "assign" });
        assert.deepEqual([refused.status, refused.errorCode, refused.blockingReason], [403, "authorization_denied", "platform_superuser_required"], label);
        assert.deepEqual(changedTables(refusedBefore, await allKaiCounts()), [], `${label}: nothing written`);
      }
      // The /admin page itself is the existing ensureAdmin gate.
      await newGkAdminPage.goto("/admin?tab=organizations");
      assert.equal(await newGkAdminPage.pathname(), "/", "a non-superuser is redirected away from /admin");

      mark = superGkPage.mark();
      const assigned = await superGkPage.fetchJson("PUT", globalRolePath(USERS.newGkAdmin), { role_name: "gk_admin", action: "assign" });
      assert.equal(assigned.status, 200, JSON.stringify(assigned));
      assert.deepEqual(await globalRolesOf("newGkAdmin"), ["gk_admin"]);
      const audits = (await auditRowsOf("superGk")).filter((a) => a.metadata?.target_user_id === kaiUserIds.newGkAdmin);
      assert.deepEqual(audits.map((a) => [a.action, a.metadata.role_name, a.metadata.authority_source]), [
        ["organization_role_granted_access_admitted", "gk_admin", "platform_superuser"],
        ["global_kai_role_assigned", "gk_admin", "platform_superuser"],
      ]);
      await openAdminKaiAccess(superGkPage);
      assert.match(await superGkPage.accessRowText(USERS.newGkAdmin), /gk_admin/, "roster readback shows the role");
      // The global role reaches no organization without membership there.
      const orgB = await newGkAdminPage.fetchJson("GET", accessCapabilitiesPath(ORG_B));
      assert.deepEqual([orgB.status, orgB.blockingReason], [403, "missing_active_organization_membership"]);
      results.J9_1 = "PASS: modal org gk_admin + governed global gk_admin; four refused global attempts; /admin redirect; no Org B access";
    });

    await test("J9-2: the new administrator signs in, is offered Team & Access, grants organization gk_operator and gk_reviewer to existing members through it, and every out-of-scope grant is refused", async () => {
      await newGkAdminPage.goto("/impact-library");
      await newGkAdminPage.waitForText("Knowledge Studio");
      const access = await newGkAdminPage.fetchJson("GET", accessCapabilitiesPath(ORG_A));
      assert.equal(access.data.organizationAccessManagement, true, "effective on the next request after the global grant");
      await newGkAdminPage.clickNav("Team & Access");
      for (const [legacyId, key, role] of [[USERS.opsRecipient, "opsRecipient", "gk_operator"], [USERS.revRecipient, "revRecipient", "gk_reviewer"]]) {
        await newGkAdminPage.waitFor(async () => /Contributor/.test(await memberRowText(newGkAdminPage, rowKeyOf(legacyId)) || ""), `row ${legacyId}`);
        await newGkAdminPage.idle();
        await newGkAdminPage.setSelectWhere(`() => document.getElementById("gk-team-access-add-role-legacy-${legacyId}")`, role);
        const before = await allKaiCounts();
        const mark = newGkAdminPage.mark();
        await clickMemberButton(newGkAdminPage, rowKeyOf(legacyId), "Add role");
        await newGkAdminPage.waitFor(() => memberHasRoleBadge(newGkAdminPage, rowKeyOf(legacyId), role), `${role} badge`);
        await newGkAdminPage.idle();
        // Repair 1: staff onboarding completes the organization role and the
        // global role its work needs (no access outside Org A) - no superuser.
        assert.deepEqual(writes(newGkAdminPage.requestsSince(mark)), [["POST", staffPath(ORG_A, legacyId), 200]]);
        assert.deepEqual(changedTables(before, await allKaiCounts()), ["audit_events", "organization_memberships", "user_roles"]);
        assert.deepEqual(await activeRolesOf(key), ["client_contributor", role].sort(), `${role}: the client role is kept`);
        assert.deepEqual(await activeRolesOf(key, ORG_B), [], `${role}: no other organization`);
        assert.deepEqual(await globalRolesOf(key), [role], `${role}: the global role is established`);
        const audits = (await auditRowsOf("newGkAdmin")).slice(-2);
        assert.deepEqual(audits.map((audit) => [audit.action, audit.metadata.role_name, audit.metadata.authority_source, audit.metadata.target_user_id]), [
          ["organization_role_granted", role, "delegated_gk_admin", kaiUserIds[key]],
          ["global_kai_role_assigned", role, "delegated_gk_admin", kaiUserIds[key]],
        ]);
      }
      const selfRow = await memberRowText(newGkAdminPage, rowKeyOf(USERS.newGkAdmin));
      assert.ok(selfRow && !/Add role/.test(selfRow), "no Add role on the administrator's own row");
      const refusedBefore = await allKaiCounts();
      for (const [label, method, path, body, reason] of [
        ["organization gk_admin", "POST", `${membershipPath(ORG_A, USERS.revRecipient)}/roles`, { role_name: "gk_admin" }, "organization_role_not_administrable"],
        ["a client role", "POST", `${membershipPath(ORG_A, USERS.revRecipient)}/roles`, { role_name: "client_reviewer" }, "organization_role_not_administrable"],
        ["self-elevation", "POST", `${membershipPath(ORG_A, USERS.newGkAdmin)}/roles`, { role_name: "gk_reviewer" }, "self_role_elevation_not_allowed"],
        ["another organization", "POST", `${membershipPath(ORG_B, USERS.memberB)}/roles`, { role_name: "gk_operator" }, "missing_active_organization_membership"],
        ["a global role", "PUT", globalRolePath(USERS.revRecipient), { role_name: "gk_reviewer", action: "assign" }, "platform_superuser_required"],
      ]) {
        const refused = await newGkAdminPage.fetchJson(method, path, body);
        assert.deepEqual([refused.status, refused.errorCode, refused.blockingReason], [403, "authorization_denied", reason], label);
      }
      for (const [label, path, body, reason] of [
        ["staff onboarding as gk_admin", staffPath(ORG_A, USERS.memberA), { role_name: "gk_admin" }, "staff_onboarding_role_not_permitted"],
        ["staff onboarding of self", staffPath(ORG_A, USERS.newGkAdmin), { role_name: "gk_reviewer" }, "self_role_elevation_not_allowed"],
        ["staff onboarding in another organization", staffPath(ORG_B, USERS.memberB), { role_name: "gk_reviewer" }, "missing_active_organization_membership"],
      ]) {
        const refused = await newGkAdminPage.fetchJson("POST", path, body);
        assert.deepEqual([refused.status, refused.errorCode, refused.blockingReason], [403, "authorization_denied", reason], label);
      }
      await assertNothingWritten(refusedBefore, "J9-2 refusals");
      assert.deepEqual(newGkAdminPage.exceptions, []);
      results.J9_2 = "PASS: Team & Access staff onboarding of gk_operator, gk_reviewer (organization + global, delegated_gk_admin audit); eight refusals, zero writes";
    });

    let j9Draft = null;
    await test("J9-3: effective product access in Org A follows each operation's own contract for the administrator, the operator, and the reviewer; Org B stays closed", async () => {
      const matrix = {};
      for (const [key, page] of [["newGkAdmin", newGkAdminPage], ["opsRecipient", opsPage], ["revRecipient", revPage]]) {
        await page.goto("/impact-library");
        await page.waitForText("Knowledge Studio");
        matrix[key] = { orgA: await surfaceStatuses(page, ORG_A), orgB: await surfaceStatuses(page, ORG_B) };
        const capabilities = (await page.fetchJson("GET", accessCapabilitiesPath(ORG_A))).data;
        const cockpit = (await page.fetchJson("GET", cockpitCapabilitiesPath(ORG_A))).data;
        matrix[key].actions = {
          gkWorkspace: capabilities.internalKnowledgeWorkspace, teamAccess: capabilities.organizationAccessManagement,
          projectManagement: capabilities.projectManagement, sourceReview: cockpit.can_review_source_candidates,
          sensitivityReview: cockpit.can_manage_sensitivity_review, ...capabilities.workflowOperations,
        };
      }
      console.log(`[campaign] J9-3 access matrix: ${JSON.stringify(matrix)}`);
      const ALL_OK = { organizations: true, capabilities: 200, projects: 200, dataSources: 200, evidenceLibrary: 200, claimLibrary: 200,
        reviewQueue: 200, eligibleClaims: 200, requirements: 200, impactFacts: 200 };
      // Administrator (global + organization gk_admin).
      assert.deepEqual(matrix.newGkAdmin.orgA, { ...ALL_OK, cockpitCapabilities: "200:true/true", teamAccessRoster: 200, sourceReviewQueue: 200,
        generatedDrafts: 200, boardReporting: 200, grantResponsePacket: 200 });
      // Operator (organization gk_operator + client_contributor + the global
      // gk_operator staff onboarding established): the source cockpit (global
      // role, Decision A) opens; drafts and reporting packets stay
      // gk_admin/gk_reviewer reads.
      assert.deepEqual(matrix.opsRecipient.orgA, { ...ALL_OK, cockpitCapabilities: "200:true/true", teamAccessRoster: 403, sourceReviewQueue: 200,
        generatedDrafts: 403, boardReporting: 403, grantResponsePacket: 403 });
      // Reviewer (organization gk_reviewer + client_contributor + global gk_reviewer).
      assert.deepEqual(matrix.revRecipient.orgA, { ...ALL_OK, cockpitCapabilities: "200:true/true", teamAccessRoster: 403, sourceReviewQueue: 200,
        generatedDrafts: 200, boardReporting: 200, grantResponsePacket: 200 });
      for (const key of ["newGkAdmin", "opsRecipient", "revRecipient"]) {
        const { organizations, cockpitCapabilities, ...closed } = matrix[key].orgB;
        assert.equal(organizations, false, `${key}: Org B is not discovered`);
        assert.equal(cockpitCapabilities, "200:false/false", `${key}: no Org B review capability`);
        assert.ok(Object.values(closed).every((status) => status === 403), `${key}: every Org B surface is refused: ${JSON.stringify(closed)}`);
      }
      const pick = (actions) => [actions.gkWorkspace, actions.teamAccess, actions.sourceReview, actions.recordEvidenceReview, actions.recordClaimReview,
        actions.extractEvidence, actions.generateDrafts, actions.reviewGeneratedDrafts, actions.readGeneratedDrafts, actions.acceptCoverageLimitation];
      //                                      ws    team   src    evRev  clRev  extr   gen    revDr  readDr cov
      assert.deepEqual(pick(matrix.newGkAdmin.actions), [true, true, true, true, true, true, true, true, true, false]);
      assert.deepEqual(pick(matrix.opsRecipient.actions), [true, false, true, false, false, true, true, false, false, false]);
      assert.deepEqual(pick(matrix.revRecipient.actions), [true, false, true, true, true, true, true, true, true, true]);
      // Project creation/change: organization gk_admin, gk_operator, or client_admin (existing contract).
      assert.deepEqual([matrix.newGkAdmin.actions.projectManagement, matrix.opsRecipient.actions.projectManagement, matrix.revRecipient.actions.projectManagement],
        [true, true, false]);

      // The administrator's GK Studio presents the organization's GK work
      // with Project selection, the Evidence tab, and the Reviews tab.
      await openKnowledgeStudio(newGkAdminPage);
      await newGkAdminPage.selectProject(PROJECT_A);
      await newGkAdminPage.clickTab("Evidence");
      await newGkAdminPage.idle();
      assert.ok(await newGkAdminPage.evaluate(`Boolean(document.querySelector("li.list-group-item[data-evidence-item-id]"))`), "evidence items are listed");
      await newGkAdminPage.clickTab("Reviews");
      await newGkAdminPage.idle();
      assert.ok((await newGkAdminPage.text()).includes("Source review"), "source review work is discoverable");

      // A generated draft. Every generation route calls an external model, so
      // this runner writes the generator's output rows (draft, block,
      // citation of an internally eligible claim, OPEN review item) - no
      // grant, approval, or review decision. Then who may discover and read it.
      const eligible = await newGkAdminPage.fetchJson("GET", SURFACES.eligibleClaims(ORG_A));
      const [eligibleClaim] = eligible.data?.eligibleClaims || [];
      assert.ok(eligibleClaim?.claimId && eligibleClaim?.evidenceItemId, "the campaign has an internally eligible claim (P3-D)");
      const j9Ids = { run: "29000000-0000-4000-8000-0000000d0901", draft: "29000000-0000-4000-8000-0000000d0902", block: "29000000-0000-4000-8000-0000000d0903",
        citation: "29000000-0000-4000-8000-0000000d0904", queue: "29000000-0000-4000-8000-0000000d0905" };
      await query(`INSERT INTO kai.generation_runs (generation_run_id, organization_id, engagement_id, idempotency_key, request_fingerprint, content_type, requested_audience, created_by_type)
                   VALUES ($1::uuid, $2::uuid, $3::uuid, 'j9-draft', $4, 'evidence_summary', 'internal', 'system')`, [j9Ids.run, ORG_A, PROJECT_A, "9".repeat(64)]);
      await query(`INSERT INTO kai.generated_content_drafts (generated_content_draft_id, generation_run_id, organization_id, content_type, requested_audience, draft_status,
                     review_status, validator_results, created_by_type)
                   VALUES ($1::uuid, $2::uuid, $3::uuid, 'evidence_summary', 'internal', 'draft', 'needs_gk_review', '[]'::jsonb, 'system')`, [j9Ids.draft, j9Ids.run, ORG_A]);
      await query("INSERT INTO kai.generated_content_blocks (generated_content_block_id, generated_content_draft_id, organization_id, ordinal, text) VALUES ($1::uuid, $2::uuid, $3::uuid, 1, $4)",
        [j9Ids.block, j9Ids.draft, ORG_A, "Synthetic J9 evidence summary sentence."]);
      await query(`INSERT INTO kai.generated_content_citations (generated_content_citation_id, generated_content_block_id, organization_id, claim_id, evidence_item_id)
                   VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid)`, [j9Ids.citation, j9Ids.block, ORG_A, eligibleClaim.claimId, eligibleClaim.evidenceItemId]);
      await query(`INSERT INTO kai.review_queue_items (review_queue_item_id, organization_id, queue_type, target_object_type, target_object_id, priority, queue_status,
                     review_status, assigned_to, due_at, summary, required_action, queue_metadata, created_by_type)
                   VALUES ($1::uuid, $2::uuid, 'generated_content_review', 'generated_content_draft', $3::uuid, 'medium', 'open', 'needs_gk_review', NULL, NULL,
                     'Generated draft requires human review.', 'Review citations, audience eligibility, limitations, unsupported claims, and numeric or causal assertions before any use.', '{}'::jsonb, 'system')`,
        [j9Ids.queue, ORG_A, j9Ids.draft]);
      j9Draft = j9Ids.draft;
      const packetPath = `${INTAKE}/admin/organizations/${ORG_A}/generated-content-drafts/${j9Draft}/review-packet`;
      const draftReads = {};
      for (const [key, page] of [["newGkAdmin", newGkAdminPage], ["opsRecipient", opsPage], ["revRecipient", revPage]]) {
        const library = await page.fetchJson("GET", SURFACES.generatedDrafts(ORG_A));
        const packet = await page.fetchJson("GET", packetPath);
        draftReads[key] = { library: library.status, listed: JSON.stringify(library.data ?? {}).includes(j9Draft), packet: packet.status,
          cites: JSON.stringify(packet.data ?? {}).includes(eligibleClaim.claimId) };
      }
      console.log(`[campaign] J9-3 draft reads: ${JSON.stringify(draftReads)}`);
      assert.deepEqual(draftReads, {
        newGkAdmin: { library: 200, listed: true, packet: 200, cites: true },
        opsRecipient: { library: 403, listed: false, packet: 403, cites: false },
        revRecipient: { library: 200, listed: true, packet: 200, cites: true },
      });
      const otherOrgPacket = await newGkAdminPage.fetchJson("GET", `${INTAKE}/admin/organizations/${ORG_B}/generated-content-drafts/${j9Draft}/review-packet`);
      assert.equal(otherOrgPacket.status, 403, "the draft is not readable through another organization");
      // Reading a draft confers no decision: nothing is reviewed or released.
      const [draftRow] = await query("SELECT review_status FROM kai.generated_content_drafts WHERE generated_content_draft_id = $1::uuid", [j9Draft]);
      assert.equal(draftRow.review_status, "needs_gk_review");
      // Each actor's own navigation through the product: every request the UI
      // itself makes is authorized and succeeds (no 401/403/5xx probing),
      // with no page exceptions.
      const navigation = {};
      for (const [key, page] of [["newGkAdmin", newGkAdminPage], ["opsRecipient", opsPage], ["revRecipient", revPage]]) {
        const mark = page.mark();
        await page.goto("/impact-library");
        await page.waitForText("Knowledge Studio");
        for (const nav of ["Home", "Impact Library", "Projects", "Knowledge Studio"]) {
          await page.clickNav(nav);
          await page.idle();
        }
        await page.selectProject(PROJECT_A);
        await page.idle();
        for (const tab of ["Files", "Processing", "Evidence", "Gaps", "Reviews"]) {
          await page.clickTab(tab);
          await page.idle();
        }
        const appRequests = page.requestsSince(mark).filter((r) => pathOf(r).startsWith("/api/"));
        // The one expected non-2xx read: P2-06 traceability of a claim whose
        // P2-04 gap state does not exist yet fails closed with 409 (Prompt 2).
        const legitimate = (r) => r.status === 409 && /\/claims\/[^/]+\/traceability$/.test(pathOf(r));
        navigation[key] = {
          requests: appRequests.length,
          failed: appRequests.filter((r) => r.status >= 400 && !legitimate(r)).map((r) => [r.method, pathOf(r), r.status]),
          packetReads: appRequests.filter((r) => /\/(grant-response-packet|board-reporting)$/.test(pathOf(r))).length,
        };
        assert.deepEqual(page.exceptions, [], `${key}: no page exceptions`);
      }
      console.log(`[campaign] J9-3 navigation: ${JSON.stringify(navigation)}`);
      for (const [key, value] of Object.entries(navigation)) {
        assert.deepEqual(value.failed, [], `${key}: the UI makes only authorized, successful requests`);
      }
      assert.equal(navigation.opsRecipient.packetReads, 0, "the operator's UI does not request the reporting packets it may not read");
      assert.ok(navigation.revRecipient.packetReads > 0 && navigation.newGkAdmin.packetReads > 0, "readers' UIs load the reporting packets");
      results.J9_3 = { matrix, draftReads, navigation };
    });

    await test("J9-4: the administrator removes only the reviewer's organization gk_reviewer in Team & Access, and the superuser revokes the administrator's global gk_admin; the next requests enforce both", async () => {
      await newGkAdminPage.goto("/impact-library");
      await newGkAdminPage.waitForText("Knowledge Studio");
      await newGkAdminPage.clickNav("Team & Access");
      const key = rowKeyOf(USERS.revRecipient);
      await newGkAdminPage.waitFor(() => memberHasRoleBadge(newGkAdminPage, key, "gk_reviewer"), "the reviewer's active role");
      await newGkAdminPage.idle();
      let mark = newGkAdminPage.mark();
      await clickMemberButton(newGkAdminPage, key, "Remove Get Kinder reviewer role");
      await newGkAdminPage.waitFor(async () => /keeps their other roles/.test(await memberRowText(newGkAdminPage, key) || ""), "the confirmation");
      await clickMemberButton(newGkAdminPage, key, "Confirm removing Get Kinder reviewer");
      await newGkAdminPage.waitFor(async () => !(await memberHasRoleBadge(newGkAdminPage, key, "gk_reviewer")), "the inactive assignment");
      await newGkAdminPage.idle();
      assert.deepEqual(writes(newGkAdminPage.requestsSince(mark)), [["POST", staffRevokePath(ORG_A, USERS.revRecipient, "gk_reviewer"), 200]]);
      assert.deepEqual(await activeRolesOf("revRecipient"), ["client_contributor"], "only the revoked role ended");
      assert.deepEqual(await globalRolesOf("revRecipient"), [], "staff offboarding also ends the global reviewer role, which reached only Org A");
      assert.deepEqual(await globalRolesOf("opsRecipient"), ["gk_operator"], "the operator's global role is untouched");
      const revCapabilities = (await revPage.fetchJson("GET", accessCapabilitiesPath(ORG_A))).data;
      assert.deepEqual([revCapabilities.internalKnowledgeWorkspace, revCapabilities.workflowOperations.recordEvidenceReview], [false, false]);
      assert.equal((await revPage.fetchJson("GET", SURFACES.evidenceLibrary(ORG_A))).status, 403, "GK evidence reads end with the role");
      assert.equal((await revPage.fetchJson("GET", SURFACES.projects(ORG_A))).status, 200, "the client role still selects Projects");
      assert.deepEqual(await activeRolesOf("opsRecipient"), ["client_contributor", "gk_operator"], "the operator's grant is untouched");

      mark = superGkPage.mark();
      const revoked = await superGkPage.fetchJson("PUT", globalRolePath(USERS.newGkAdmin), { role_name: "gk_admin", action: "revoke" });
      assert.equal(revoked.status, 200);
      assert.deepEqual(await globalRolesOf("newGkAdmin"), []);
      const after = await newGkAdminPage.fetchJson("GET", accessCapabilitiesPath(ORG_A));
      assert.deepEqual([after.data.organizationAccessManagement, after.data.internalKnowledgeWorkspace], [false, true],
        "delegated administration ends; the organization gk_admin keeps its own GK workspace");
      const before = await allKaiCounts();
      const refused = await newGkAdminPage.fetchJson("POST", `${membershipPath(ORG_A, USERS.revRecipient)}/roles`, { role_name: "gk_reviewer" });
      assert.deepEqual([refused.status, refused.errorCode], [403, "authorization_denied"]);
      assert.equal((await newGkAdminPage.fetchJson("GET", SURFACES.teamAccessRoster(ORG_A))).status, 403);
      assert.deepEqual(changedTables(before, await allKaiCounts()), [], "the refused grant writes nothing");
      assert.deepEqual(await activeRolesOf("newGkAdmin"), ["gk_admin"], "the stored organization assignment is unchanged");
      assert.deepEqual(newGkAdminPage.exceptions, []);
      results.J9_4 = "PASS: targeted revoke (reviewer) and global revoke (administrator) enforced on the next requests";
    });

    // =====================================================================
    // J10. Team & Access is the KAI permissions administration interface
    // (Prompt 4): client administrator, platform superuser (no membership
    // needed), delegated GK administrator, incomplete staff provisioning,
    // revocation, multi-organization scope, readiness vs enforcement, and
    // privileged negative cases - all in /impact-library -> Team & Access.
    // =====================================================================
    const tamPage = await session(USERS.storedAdmin);
    const platformPage = await session(USERS.superNoRole);
    const staffAdminPage = await session(USERS.staffAdmin);
    const contextPath = `${ACCESS}/administration-context`;
    const rosterPath = (organizationId) => `${ACCESS}/organizations/${organizationId}/access`;
    const rowKey = (legacyId) => `legacy:${legacyId}`;
    const readinessOf = (page, legacyId, key) => page.evaluate(`(() => {
      const el = document.querySelector('[data-team-access-readiness="legacy:${legacyId}"] [data-readiness-key="${key}"]');
      return el ? el.getAttribute("data-ready") : null;
    })()`);
    async function openTeamAccess(page) {
      await page.goto("/impact-library");
      await page.waitForText("Knowledge Studio");
      await page.clickNav("Team & Access");
      await page.waitForText("Members");
      await page.idle();
    }
    async function setInput(page, id, value) {
      assert.ok(await page.evaluate(`(() => {
        const el = document.getElementById(${JSON.stringify(id)});
        if (!el) return false;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })()`), `input ${id}`);
    }
    async function confirmGlobalRole(page, legacyId, roleLabel, action) {
      const key = rowKey(legacyId);
      if (action === "assign") {
        await clickMemberButton(page, key, "Grant global role");
        await page.waitFor(async () => /Confirm granting global/.test(await memberRowText(page, key) || ""), "grant confirmation");
        assert.deepEqual(writes(page.requestsSince(page.mark())), [], "nothing is sent before confirmation");
        const mark = page.mark();
        await clickMemberButton(page, key, `Confirm granting global ${roleLabel}`);
        await page.waitFor(async () => new RegExp(`Revoke global ${roleLabel}`).test(await memberRowText(page, key) || ""), "the granted global role");
        await page.idle();
        return writes(page.requestsSince(mark));
      }
      await clickMemberButton(page, key, `Revoke global ${roleLabel}`);
      await page.waitFor(async () => /Confirm revoking global/.test(await memberRowText(page, key) || ""), "revoke confirmation");
      const mark = page.mark();
      await clickMemberButton(page, key, `Confirm revoking global ${roleLabel}`);
      await page.waitFor(async () => !new RegExp(`Revoke global ${roleLabel}`).test(await memberRowText(page, key) || ""), "the revoked global role");
      await page.idle();
      return writes(page.requestsSince(mark));
    }

    await test("J10-1 (client administrator): Team & Access keeps members, the binding-derived administrator, and client roles; no platform, global, or readiness controls appear and the server refuses them", async () => {
      await openTeamAccess(tamPage);
      const body = await tamPage.text();
      assert.ok(body.includes(`Team & Access for ${ORG_A_NAME}`) || body.includes("Team & Access"), "the existing page");
      const derivedRow = await memberRowText(tamPage, rowKey(USERS.boundAdmin));
      assert.ok(derivedRow && /Get Kinder organization admin/.test(derivedRow), "the binding-derived administrator is shown as derived");
      assert.ok(body.includes("Uploads files, manages Projects"), "client role descriptions stay");
      for (const marker of ["Platform administration", "Grant global role", "Get Kinder access here"]) {
        assert.ok(!body.includes(marker), `no ${marker} for a client administrator`);
      }
      const context = await tamPage.fetchJson("GET", contextPath);
      assert.deepEqual([context.status, context.data.platform_administration], [200, false]);
      const before = await allKaiCounts();
      const globalAttempt = await tamPage.fetchJson("PUT", globalRolePath(USERS.memberA), { role_name: "gk_admin", action: "assign" });
      const gkAttempt = await tamPage.fetchJson("POST", `${membershipPath(ORG_A, USERS.memberA)}/roles`, { role_name: "gk_reviewer" });
      const otherRoster = await tamPage.fetchJson("GET", rosterPath(ORG_B));
      assert.deepEqual([globalAttempt.status, globalAttempt.blockingReason], [403, "platform_superuser_required"]);
      assert.deepEqual([gkAttempt.status, gkAttempt.blockingReason], [403, "non_client_membership_not_client_managed"]);
      assert.deepEqual([otherRoster.status, otherRoster.blockingReason], [403, "missing_active_organization_membership"]);
      assert.deepEqual(changedTables(before, await allKaiCounts()), []);
      assert.deepEqual(tamPage.exceptions, []);
      results.J10_1 = "PASS";
    });

    await test("J10-2 (platform superuser): Team & Access administers an organization without a membership there, opens no content, adds an existing account, and grants global gk_admin with explanation and confirmation", async () => {
      // The superuser's direct Org B content reads before any Team & Access
      // use: the pre-existing platform-superuser rule (Decision D, held)
      // decides these, independent of this interface.
      const contentPaths = {
        evidenceLibrary: `${INTAKE}/admin/organizations/${ORG_B}/evidence-library/candidates`,
        claimLibrary: `${INTAKE}/admin/organizations/${ORG_B}/claim-library/candidates`,
        generatedDrafts: `${INTAKE}/admin/organizations/${ORG_B}/generated-content-drafts`,
        sources: `${INTAKE}/admin/organizations/${ORG_B}/sources`,
        reviewQueue: `${INTAKE}/admin/organizations/${ORG_B}/review-queue`,
        capabilities: accessCapabilitiesPath(ORG_B),
        projects: `${INTAKE}/admin/organizations/${ORG_B}/engagements`,
      };
      const contentStatuses = async () => Object.fromEntries(await Promise.all(Object.entries(contentPaths)
        .map(async ([name, path]) => [name, (await platformPage.fetchJson("GET", path)).status])));
      await platformPage.goto("/impact-library");
      const contentBefore = await contentStatuses();
      await openTeamAccess(platformPage);
      await platformPage.waitForText("Platform administration");
      // Org B: no membership of this superuser. Team & Access reads only its roster.
      let mark = platformPage.mark();
      await platformPage.setSelectWhere(`() => document.getElementById("gk-team-access-administration-organization")`, ORG_B);
      await platformPage.waitFor(async () => Boolean(await memberRowText(platformPage, rowKey(USERS.memberB))), "Org B roster");
      await platformPage.idle();
      const orgBRequests = platformPage.requestsSince(mark).filter((r) => pathOf(r).includes(ORG_B));
      assert.deepEqual(orgBRequests.map((r) => [r.method, pathOf(r), r.status]), [["GET", rosterPath(ORG_B), 200]],
        "choosing an organization to administer requests only its roster - no evidence, claim, file, draft, or report read");
      const contentAfter = await contentStatuses();
      console.log(`[campaign] J10-2 superuser direct Org B content statuses (pre-existing Decision D behavior): ${JSON.stringify(contentBefore)}`);
      assert.deepEqual(contentAfter, contentBefore, "Team & Access administration adds no content access");
      results.J10_2_preexisting_superuser_content = contentBefore;
      // Org A: add an existing account by exact email as organization gk_admin.
      await platformPage.setSelectWhere(`() => document.getElementById("gk-team-access-administration-organization")`, ORG_A);
      await platformPage.waitFor(async () => Boolean(await memberRowText(platformPage, rowKey(USERS.memberA))), "Org A roster");
      await platformPage.idle();
      await setInput(platformPage, "gk-team-access-add-person-email", email(USERS.staffAdmin));
      await platformPage.setSelectWhere(`() => document.getElementById("gk-team-access-add-person-role")`, "gk_admin");
      const before = await allKaiCounts();
      mark = platformPage.mark();
      await platformPage.clickButton("Add person");
      await platformPage.waitFor(async () => Boolean(await memberRowText(platformPage, rowKey(USERS.staffAdmin))), "the added person");
      await platformPage.idle();
      assert.ok(platformPage.requestsSince(mark).some((r) => pathOf(r) === "/api/admin/users/lookup" && r.status === 200), "exact-email lookup");
      assert.deepEqual(writes(platformPage.requestsSince(mark)), [["POST", `${membershipPath(ORG_A, USERS.staffAdmin)}/roles`, 200]]);
      assert.deepEqual(changedTables(before, await allKaiCounts()), ["audit_events", "organization_memberships"]);
      // Readiness before the global half: not yet a delegated administrator.
      assert.equal(await readinessOf(platformPage, USERS.staffAdmin, "delegated_administration"), "false");
      assert.match(await memberRowText(platformPage, rowKey(USERS.staffAdmin)), /Global Get Kinder roles \(all organizations\): none/);
      await platformPage.setSelectWhere(`() => document.getElementById("gk-team-access-global-role-legacy-${USERS.staffAdmin}")`, "gk_admin");
      const explanation = await platformPage.evaluate(`document.querySelector('[data-team-access-global-roles="legacy:${USERS.staffAdmin}"] [data-global-role-explanation="gk_admin"]')?.innerText || ""`);
      assert.match(explanation, /^High-risk Get Kinder governance role/);
      assert.match(explanation, /export, final release and funder\/public-ready decision authority/);
      const granted = await confirmGlobalRole(platformPage, USERS.staffAdmin, "Get Kinder administrator", "assign");
      assert.deepEqual(granted, [["PUT", globalRolePath(USERS.staffAdmin), 200]]);
      await platformPage.waitFor(async () => (await readinessOf(platformPage, USERS.staffAdmin, "delegated_administration")) === "true", "delegated administration readiness");
      assert.deepEqual(await globalRolesOf("staffAdmin"), ["gk_admin"]);
      const audits = (await auditRowsOf("superNoRole")).filter((a) => a.metadata?.target_user_id === kaiUserIds.staffAdmin);
      assert.deepEqual(audits.map((a) => [a.action, a.metadata.role_name, a.metadata.authority_source]), [
        ["organization_role_granted_access_admitted", "gk_admin", "platform_superuser"],
        ["global_kai_role_assigned", "gk_admin", "platform_superuser"],
      ]);
      for (const audit of audits) assert.doesNotMatch(JSON.stringify(audit.metadata), /@|tidewater\.test/, "metadata-only audit");
      assert.deepEqual(platformPage.exceptions, []);
      results.J10_2 = "PASS";
    });

    await test("J10-3 (delegated GK administrator): the new administrator onboards operator and reviewer staff in Team & Access - complete, with no platform step - and every out-of-scope request is refused", async () => {
      await openTeamAccess(staffAdminPage);
      const body = await staffAdminPage.text();
      assert.ok(!body.includes("Platform administration") && !body.includes("Grant global role"), "no platform or global controls");
      assert.ok(body.includes("Add Get Kinder staff"), "the staff onboarding form");
      assert.ok(!(await memberRowText(staffAdminPage, rowKey(USERS.staffAdmin)) || "").includes("Add role"), "no self-grant control");
      for (const [legacyId, key, role, label] of [[USERS.revRecipient, "revRecipient", "gk_operator", "operator"], [USERS.memberA, "memberA", "gk_reviewer", "reviewer"]]) {
        await staffAdminPage.setSelectWhere(`() => document.getElementById("gk-team-access-add-role-legacy-${legacyId}")`, role);
        const mark = staffAdminPage.mark();
        await clickMemberButton(staffAdminPage, rowKey(legacyId), "Add role");
        await staffAdminPage.waitForText(`is now a Get Kinder ${label} here with the global Get Kinder ${label} role, and can sign in and start now.`);
        await staffAdminPage.idle();
        assert.deepEqual(writes(staffAdminPage.requestsSince(mark)), [["POST", staffPath(ORG_A, legacyId), 200]]);
        assert.ok((await activeRolesOf(key)).includes(role) && (await activeRolesOf(key)).includes("client_contributor"));
        assert.deepEqual(await activeRolesOf(key, ORG_B), []);
        assert.deepEqual(await globalRolesOf(key), [role]);
        assert.equal(await readinessOf(staffAdminPage, legacyId, "source_review"), "true", "source review is ready without a platform step");
        assert.ok(!/Onboarding not finished|Waiting for a platform administrator/.test(await memberRowText(staffAdminPage, rowKey(legacyId)) || ""), "no pending onboarding");
      }
      assert.equal(await readinessOf(staffAdminPage, USERS.memberA, "evidence_review"), "true", "the onboarded reviewer reviews evidence");
      const before = await allKaiCounts();
      for (const [label, method, path, bodyValue, reason] of [
        ["global role", "PUT", globalRolePath(USERS.revRecipient), { role_name: "gk_operator", action: "assign" }, "platform_superuser_required"],
        ["self-elevation", "POST", `${membershipPath(ORG_A, USERS.staffAdmin)}/roles`, { role_name: "gk_reviewer" }, "self_role_elevation_not_allowed"],
        ["another organization", "POST", `${membershipPath(ORG_B, USERS.memberB)}/roles`, { role_name: "gk_operator" }, "missing_active_organization_membership"],
        ["organization gk_admin", "POST", `${membershipPath(ORG_A, USERS.memberA)}/roles`, { role_name: "gk_admin" }, "organization_role_not_administrable"],
      ]) {
        const refused = await staffAdminPage.fetchJson(method, path, bodyValue);
        assert.deepEqual([refused.status, refused.blockingReason], [403, reason], label);
      }
      assert.deepEqual(changedTables(before, await allKaiCounts()), []);
      assert.deepEqual(staffAdminPage.exceptions, []);
      results.J10_3 = "PASS";
    });

    await test("J10-4/J10-7 (onboarding to action; readiness vs enforcement): the delegated onboarding alone admits the operator's next source-review request; the platform roster shows the same complete state, and readiness agrees with the protected reads", async () => {
      assert.equal((await revPage.fetchJson("GET", sourceQueuePath(ORG_A))).status, 200, "admitted on the next request, with no platform step");
      await openTeamAccess(platformPage);
      await platformPage.setSelectWhere(`() => document.getElementById("gk-team-access-administration-organization")`, ORG_A);
      await platformPage.waitFor(async () => Boolean(await memberRowText(platformPage, rowKey(USERS.revRecipient))), "the operator row");
      await platformPage.idle();
      assert.match(await memberRowText(platformPage, rowKey(USERS.revRecipient)), /Global Get Kinder roles \(all organizations\): Get Kinder operator/);
      assert.equal(await readinessOf(platformPage, USERS.revRecipient, "source_review"), "true");
      assert.equal((await revPage.fetchJson("GET", cockpitCapabilitiesPath(ORG_A))).data.can_review_source_candidates, true);
      // Readiness (server) against the reviewer's actual protected reads.
      const reviewerChecks = [
        ["gk_workspace", `${INTAKE}/admin/organizations/${ORG_A}/evidence-library/candidates`],
        ["generated_content_read", `${INTAKE}/admin/organizations/${ORG_A}/generated-content-drafts`],
        ["source_review", sourceQueuePath(ORG_A)],
      ];
      const memberAPage = await session(USERS.memberA);
      for (const [key, path] of reviewerChecks) {
        const ready = await readinessOf(platformPage, USERS.memberA, key);
        const status = (await memberAPage.fetchJson("GET", path)).status;
        assert.equal(ready === "true", status === 200, `${key}: readiness ${ready} vs ${path} ${status}`);
      }
      const memberCapabilities = (await memberAPage.fetchJson("GET", accessCapabilitiesPath(ORG_A))).data.workflowOperations;
      assert.equal((await readinessOf(platformPage, USERS.memberA, "evidence_review")) === "true", memberCapabilities.recordEvidenceReview);
      assert.equal((await readinessOf(platformPage, USERS.memberA, "coverage_acceptance")) === "true", memberCapabilities.acceptCoverageLimitation);
      results.J10_4 = "PASS";
    });

    await test("J10-5 (revocation): the superuser revokes the global role in Team & Access and the organization role stays; the delegated administrator removes the organization role; next requests enforce both and the client role remains", async () => {
      assert.deepEqual(await confirmGlobalRole(platformPage, USERS.revRecipient, "Get Kinder operator", "revoke"), [["PUT", globalRolePath(USERS.revRecipient), 200]]);
      assert.equal((await revPage.fetchJson("GET", sourceQueuePath(ORG_A))).status, 403, "global revocation applies on the next request");
      assert.ok((await activeRolesOf("revRecipient")).includes("gk_operator"), "the organization assignment remains");
      await openTeamAccess(staffAdminPage);
      const key = rowKey(USERS.revRecipient);
      // The delegated administrator sees the incomplete staff onboarding (the
      // global role is gone, the organization role stays) and what finishes it.
      const pendingRow = await memberRowText(staffAdminPage, key);
      assert.match(pendingRow, /Onboarding not finished: the global Get Kinder operator role this work needs is not in place yet\./);
      assert.match(pendingRow, /Complete Get Kinder operator onboarding/);
      const mark = staffAdminPage.mark();
      await clickMemberButton(staffAdminPage, key, "Remove Get Kinder operator role");
      await staffAdminPage.waitFor(async () => /keeps their other roles/.test(await memberRowText(staffAdminPage, key) || ""), "confirmation");
      await clickMemberButton(staffAdminPage, key, "Confirm removing Get Kinder operator");
      await staffAdminPage.waitFor(async () => !(await memberHasRoleBadge(staffAdminPage, key, "gk_operator")), "removed");
      await staffAdminPage.idle();
      assert.deepEqual(writes(staffAdminPage.requestsSince(mark)), [["POST", staffRevokePath(ORG_A, USERS.revRecipient, "gk_operator"), 200]]);
      assert.deepEqual(await globalRolesOf("revRecipient"), []);
      const capabilities = (await revPage.fetchJson("GET", accessCapabilitiesPath(ORG_A))).data;
      assert.deepEqual([capabilities.internalKnowledgeWorkspace, capabilities.workflowOperations.extractEvidence], [false, false]);
      assert.deepEqual(await activeRolesOf("revRecipient"), ["client_contributor"], "unrelated client role intact");
      assert.deepEqual(await activeRolesOf("memberA"), ["client_contributor", "gk_reviewer"], "other members untouched");
      results.J10_5 = "PASS";
    });

    await test("J10-8 (privileged negative cases): an unknown recipient, a mismatched recipient id, and non-superuser context reads are refused with nothing written; errors and audit carry no personal data", async () => {
      await openTeamAccess(platformPage);
      await platformPage.setSelectWhere(`() => document.getElementById("gk-team-access-administration-organization")`, ORG_A);
      await platformPage.idle();
      const before = await allKaiCounts();
      await setInput(platformPage, "gk-team-access-add-person-email", "nobody-here@tidewater.test");
      await platformPage.clickButton("Add person");
      await platformPage.waitForText("No existing Get Kinder account has that email.");
      const unknownTarget = await platformPage.fetchJson("PUT", globalRolePath(987654), { role_name: "gk_admin", action: "assign" });
      assert.notEqual(unknownTarget.status, 200, JSON.stringify(unknownTarget));
      assert.doesNotMatch(JSON.stringify(unknownTarget), /@|password|token/i);
      assert.deepEqual(changedTables(before, await allKaiCounts()), [], "nothing written");
      for (const page of [staffAdminPage, revPage]) {
        assert.equal((await page.fetchJson("GET", contextPath)).data.platform_administration, false);
      }
      const allAudits = await query(`SELECT metadata FROM kai.audit_events WHERE action IN ('organization_role_granted', 'organization_role_granted_access_admitted',
        'organization_role_revoked', 'organization_role_replaced', 'organization_membership_assigned', 'global_kai_role_assigned', 'global_kai_role_revoked')`);
      assert.ok(allAudits.length > 0);
      for (const { metadata } of allAudits) assert.doesNotMatch(JSON.stringify(metadata), /@/, "metadata-only access-administration audit");
      assert.deepEqual(platformPage.exceptions, []);
      results.J10_8 = "PASS";
    });

    // =====================================================================
    // J11. Repair 1: routine Get Kinder staff onboarding by a delegated GK
    // administrator, end to end in /impact-library -> Team & Access, with no
    // return to the platform superuser: a verified account that never used
    // KAI is added by exact email, mapped, given the organization role and
    // the global role its work needs, and works on its next request; the
    // only platform step is the exceptional cross-organization global role.
    // =====================================================================
    const kaiUserIdByLegacy = async (legacyId) => (await query("SELECT user_id::text FROM kai.users WHERE legacy_public_userdata_id = $1", [legacyId]))[0]?.user_id || null;
    async function addStaff(page, emailValue, roleName, expectedText) {
      await setInput(page, "gk-team-access-add-staff-email", emailValue);
      await page.setSelectWhere(`() => document.getElementById("gk-team-access-add-staff-role")`, roleName);
      const mark = page.mark();
      await page.clickButton("Add staff member");
      await page.waitForText(expectedText);
      await page.idle();
      return writes(page.requestsSince(mark));
    }

    await test("J11-1/J11-2 (delegated staff onboarding by email): an operator and a reviewer who never used KAI are onboarded in Team & Access - mapped, organization role, global role, audited - and work on their next request; Org B stays closed", async () => {
      await openTeamAccess(staffAdminPage);
      for (const [key, legacyId, roleName, label] of [["staffOperatorNew", USERS.staffOperatorNew, "gk_operator", "operator"], ["staffReviewerNew", USERS.staffReviewerNew, "gk_reviewer", "reviewer"]]) {
        assert.equal(await kaiUserIdByLegacy(legacyId), null, `${label}: never used KAI`);
        const before = await allKaiCounts();
        const sent = await addStaff(staffAdminPage, ` ${email(legacyId).toUpperCase()} `, roleName,
          `${email(legacyId)} is now a Get Kinder ${label} here with the global Get Kinder ${label} role, and can sign in and start now.`);
        assert.deepEqual(sent, [["POST", staffPath(ORG_A), 200]], `${label}: one onboarding request, no platform step`);
        assert.deepEqual(changedTables(before, await allKaiCounts()), ["audit_events", "organization_memberships", "user_roles", "users"]);
        kaiUserIds[key] = await kaiUserIdByLegacy(legacyId);
        assert.deepEqual(await activeRolesOf(key), [roleName]);
        assert.deepEqual(await globalRolesOf(key), [roleName]);
        await staffAdminPage.waitFor(() => memberHasRoleBadge(staffAdminPage, rowKey(legacyId), roleName), `${label} row`);
        assert.equal(await readinessOf(staffAdminPage, legacyId, "source_review"), "true");
        const audits = (await auditRowsOf("staffAdmin")).filter((audit) => audit.metadata?.target_user_id === kaiUserIds[key]);
        assert.deepEqual(audits.map((audit) => [audit.action, audit.metadata.role_name, audit.metadata.authority_source, audit.metadata.organization_id]), [
          ["organization_role_granted_access_admitted", roleName, "delegated_gk_admin", ORG_A],
          ["global_kai_role_assigned", roleName, "delegated_gk_admin", ORG_A],
        ]);
        for (const audit of audits) assert.doesNotMatch(JSON.stringify(audit.metadata), /@/);
      }
      // Each new staff member signs in and works immediately.
      const operatorPage = await session(USERS.staffOperatorNew);
      const reviewerPage = await session(USERS.staffReviewerNew);
      const effective = {};
      for (const [key, page] of [["operator", operatorPage], ["reviewer", reviewerPage]]) {
        await page.goto("/impact-library");
        await page.waitForText("Knowledge Studio");
        const capabilities = (await page.fetchJson("GET", accessCapabilitiesPath(ORG_A))).data;
        const cockpit = (await page.fetchJson("GET", cockpitCapabilitiesPath(ORG_A))).data;
        effective[key] = {
          workspace: capabilities.internalKnowledgeWorkspace, intake: capabilities.intakeContribution, teamAccess: capabilities.organizationAccessManagement,
          sourceReview: cockpit.can_review_source_candidates, sensitivityReview: cockpit.can_manage_sensitivity_review,
          sourceQueue: (await page.fetchJson("GET", sourceQueuePath(ORG_A))).status,
          extract: capabilities.workflowOperations.extractEvidence, evidenceReview: capabilities.workflowOperations.recordEvidenceReview,
          orgB: (await page.fetchJson("GET", accessCapabilitiesPath(ORG_B))).status,
        };
        assert.deepEqual(page.exceptions, [], `${key}: no page exceptions`);
      }
      console.log(`[campaign] J11-1/2 effective access: ${JSON.stringify(effective)}`);
      assert.deepEqual(effective.operator, { workspace: true, intake: true, teamAccess: false, sourceReview: true, sensitivityReview: true, sourceQueue: 200,
        extract: true, evidenceReview: false, orgB: 403 });
      assert.deepEqual(effective.reviewer, { workspace: true, intake: false, teamAccess: false, sourceReview: true, sensitivityReview: true, sourceQueue: 200,
        extract: true, evidenceReview: true, orgB: 403 });
      assert.deepEqual(staffAdminPage.exceptions, []);
      results.J11_1_2 = effective;
    });

    await test("J11-3 (identity): an email with no Get Kinder account and an unverified account are refused with the next step named, and nothing is written", async () => {
      await openTeamAccess(staffAdminPage);
      const before = await allKaiCounts();
      assert.deepEqual(await addStaff(staffAdminPage, "not-registered@tidewater.test", "gk_operator",
        "No Get Kinder account has that email. Ask the person to register at Get Kinder and verify their email, then add them."),
      [["POST", staffPath(ORG_A), 404]]);
      assert.deepEqual(await addStaff(staffAdminPage, email(USERS.unverifiedStaff), "gk_reviewer",
        "That person has not verified their Get Kinder email yet. Ask them to finish verification, then try again."),
      [["POST", staffPath(ORG_A), 422]]);
      await assertNothingWritten(before, "J11-3");
      assert.equal(await kaiUserIdByLegacy(USERS.unverifiedStaff), null, "no KAI identity for the unverified account");
      results.J11_3 = "PASS";
    });

    await test("J11-4 (cross-organization global role): a person with access in Org B keeps the onboarding pending for platform approval; Org B gains nothing until the platform superuser approves in Team & Access", async () => {
      await openTeamAccess(staffAdminPage);
      const memberBPage = await session(USERS.memberB);
      const orgBWorkspace = async () => (await memberBPage.fetchJson("GET", accessCapabilitiesPath(ORG_B))).data.internalKnowledgeWorkspace;
      assert.equal(await orgBWorkspace(), false);
      const before = await allKaiCounts();
      assert.deepEqual(await addStaff(staffAdminPage, email(USERS.memberB), "gk_reviewer",
        "but the global Get Kinder reviewer role was not granted: they also have KAI access in another organization, so a platform administrator must approve it."),
      [["POST", staffPath(ORG_A), 200]]);
      assert.deepEqual(changedTables(before, await allKaiCounts()), ["audit_events", "organization_memberships"], "no global role written");
      assert.deepEqual([await activeRolesOf("memberB"), await activeRolesOf("memberB", ORG_B), await globalRolesOf("memberB")],
        [["gk_reviewer"], ["client_contributor"], []]);
      await staffAdminPage.waitFor(async () => /Waiting for a platform administrator: this person also has KAI access in another organization/
        .test(await memberRowText(staffAdminPage, rowKey(USERS.memberB)) || ""), "the pending onboarding");
      assert.ok(!/Complete Get Kinder reviewer onboarding/.test(await memberRowText(staffAdminPage, rowKey(USERS.memberB))), "no delegated completion offered");
      assert.doesNotMatch(await memberRowText(staffAdminPage, rowKey(USERS.memberB)), new RegExp(ORG_B_NAME), "the other organization is not named");
      assert.equal(await orgBWorkspace(), false, "Org B gains nothing from the pending onboarding");
      assert.equal((await memberBPage.fetchJson("GET", sourceQueuePath(ORG_A))).status, 403, "the global-only work in Org A waits");

      // The existing authorized platform path: the superuser grants the global role in Team & Access.
      await openTeamAccess(platformPage);
      await platformPage.setSelectWhere(`() => document.getElementById("gk-team-access-administration-organization")`, ORG_A);
      await platformPage.waitFor(async () => /Waiting for a platform administrator/.test(await memberRowText(platformPage, rowKey(USERS.memberB)) || ""), "the superuser sees it pending");
      await platformPage.idle();
      await platformPage.setSelectWhere(`() => document.getElementById("gk-team-access-global-role-legacy-${USERS.memberB}")`, "gk_reviewer");
      assert.deepEqual(await confirmGlobalRole(platformPage, USERS.memberB, "Get Kinder reviewer", "assign"), [["PUT", globalRolePath(USERS.memberB), 200]]);
      await platformPage.waitFor(async () => !/Waiting for a platform administrator/.test(await memberRowText(platformPage, rowKey(USERS.memberB)) || ""), "approved");
      assert.equal((await memberBPage.fetchJson("GET", sourceQueuePath(ORG_A))).status, 200);
      // The effect the platform superuser approved: the global role also reaches Org B, where the person has access.
      results.J11_4_org_b_workspace_after_platform_approval = await orgBWorkspace();
      assert.equal(results.J11_4_org_b_workspace_after_platform_approval, true);
      assert.deepEqual((await auditRowsOf("superNoRole")).slice(-1).map((audit) => [audit.action, audit.metadata.authority_source]),
        [["global_kai_role_assigned", "platform_superuser"]]);
      results.J11_4 = "PASS";
    });

    await test("J11-5 (offboarding): the delegated administrator removes the new operator - organization and global role, next request refused - and removing the cross-organization reviewer leaves the platform-approved global role to the platform", async () => {
      await openTeamAccess(staffAdminPage);
      const operatorKey = rowKey(USERS.staffOperatorNew);
      await clickMemberButton(staffAdminPage, operatorKey, "Remove Get Kinder operator role");
      await staffAdminPage.waitFor(async () => /will lose access to this organization\. Their global Get Kinder operator role is removed too/
        .test(await memberRowText(staffAdminPage, operatorKey) || ""), "the offboarding confirmation");
      let mark = staffAdminPage.mark();
      await clickMemberButton(staffAdminPage, operatorKey, "Confirm removing Get Kinder operator");
      await staffAdminPage.waitForText("is no longer a Get Kinder operator, and the global Get Kinder operator role was removed.");
      await staffAdminPage.idle();
      assert.deepEqual(writes(staffAdminPage.requestsSince(mark)), [["POST", staffRevokePath(ORG_A, USERS.staffOperatorNew, "gk_operator"), 200]]);
      assert.deepEqual([await activeRolesOf("staffOperatorNew"), await globalRolesOf("staffOperatorNew")], [[], []]);
      const operatorPage = await session(USERS.staffOperatorNew);
      assert.equal((await operatorPage.fetchJson("GET", sourceQueuePath(ORG_A))).status, 403, "refused on the next request");
      assert.equal((await operatorPage.fetchJson("GET", accessCapabilitiesPath(ORG_A))).status, 403);

      const memberBKey = rowKey(USERS.memberB);
      await clickMemberButton(staffAdminPage, memberBKey, "Remove Get Kinder reviewer role");
      await staffAdminPage.waitFor(async () => /Confirm removing/.test(await memberRowText(staffAdminPage, memberBKey) || ""), "confirmation");
      mark = staffAdminPage.mark();
      await clickMemberButton(staffAdminPage, memberBKey, "Confirm removing Get Kinder reviewer");
      await staffAdminPage.waitForText("The global Get Kinder reviewer role stays because they have KAI access in another organization; a platform administrator decides whether to remove it.");
      await staffAdminPage.idle();
      assert.deepEqual(writes(staffAdminPage.requestsSince(mark)), [["POST", staffRevokePath(ORG_A, USERS.memberB, "gk_reviewer"), 200]]);
      assert.deepEqual([await activeRolesOf("memberB"), await activeRolesOf("memberB", ORG_B), await globalRolesOf("memberB")], [[], ["client_contributor"], ["gk_reviewer"]]);
      assert.deepEqual(await activeRolesOf("staffReviewerNew"), ["gk_reviewer"], "other staff untouched");
      assert.deepEqual(staffAdminPage.exceptions, []);
      results.J11_5 = "PASS";
    });

    await test("J11-6 (client administrators): neither a stored nor a binding-derived client administrator is offered staff onboarding, and the server refuses it with nothing written", async () => {
      await openTeamAccess(tamPage);
      assert.ok(!(await tamPage.text()).includes("Add Get Kinder staff"), "no staff onboarding for a client administrator");
      const boundAdminPage = await session(USERS.boundAdmin);
      const before = await allKaiCounts();
      for (const [label, page] of [["stored client administrator", tamPage], ["binding-derived client administrator", boundAdminPage]]) {
        for (const [path, body] of [[staffPath(ORG_A), { email: email(USERS.staffOperatorNew), role_name: "gk_operator" }], [staffPath(ORG_A, USERS.memberA), { role_name: "gk_reviewer" }]]) {
          const refused = await page.fetchJson("POST", path, body);
          assert.deepEqual([refused.status, refused.blockingReason], [403, "non_client_membership_not_client_managed"], label);
        }
        const offboard = await page.fetchJson("POST", staffRevokePath(ORG_A, USERS.staffReviewerNew, "gk_reviewer"));
        assert.deepEqual([offboard.status, offboard.blockingReason], [403, "non_client_membership_not_client_managed"], `${label} offboarding`);
      }
      await assertNothingWritten(before, "J11-6");
      results.J11_6 = "PASS";
    });
  } finally {
    console.log(`[campaign] RESULTS ${JSON.stringify(results, null, 2)}`);
    for (const page of pages) await page.close().catch(() => {});
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await seedPool.end();
  }
}
