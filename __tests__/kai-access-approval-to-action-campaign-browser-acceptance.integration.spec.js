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
 *   J5 downstream GK review: who can reach P1-08 source review, P1-08 ->
 *      P2-01 evidence, P2-12 evidence review -> P2-02/P2-03 claim proposal
 *   J6 client approval: join request -> approval -> client_reviewer ->
 *      client follow-up completion
 *   J7 revocation and isolation
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
    throw new Error("network never went idle");
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
    clickInEvidenceItem: (statement, label) => evaluate(`(() => {
      const li = [...document.querySelectorAll("li.list-group-item")].find((el) => el.innerText.includes(${JSON.stringify(statement)}));
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
  });
  const SITE_ADMINS = new Set([USERS.superGk, USERS.superNoRole, USERS.superGkStored]);
  const FIRST_SIGN_IN = new Set([USERS.reviewer, USERS.reviewerOrgOnly, USERS.newMember, USERS.freshNotNull, USERS.freshNullable]);
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
  await insertMembership(ORG_A, "storedAdmin", "client_admin");
  await insertMembership(ORG_B, "otherOrgReviewer", "gk_reviewer");
  await insertMembership(ORG_A, "gkOperator", "gk_operator");
  await insertMembership(ORG_C, "adminC", "client_admin");
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
      const pipeline = await storedAdminPage.fetchJson("GET", pipelinePath());
      const file = findFile(pipeline.data, FILES.reviewer);
      assert.deepEqual([file.currentStage, file.responsibleParty], ["source_review", "get_kinder"]);
      results.J2_4 = `PASS: reviewed by reviewer (gk_reviewer); candidate ${candidate.intake_source_candidate_id}; client pipeline currentStage source_review`;
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
    await test("J3-1: the mixed-role reviewer (granted global gk_reviewer by the governed route) gets the client Studio, the sensitivity capability, and completes the decision with handoff", async () => {
      const grant = await superGkPage.fetchJson("PUT", globalRolePath(USERS.mixed), { role_name: "gk_reviewer", action: "assign" });
      assert.equal(grant.status, 200);
      await mixedPage.goto("/impact-library");
      await mixedPage.waitForText("Knowledge Studio");
      const access = await mixedPage.fetchJson("GET", accessCapabilitiesPath(ORG_A));
      const cockpit = await mixedPage.fetchJson("GET", cockpitCapabilitiesPath(ORG_A));
      assert.deepEqual([access.data.internalKnowledgeWorkspace, cockpit.data.can_manage_sensitivity_review], [false, true]);
      await openReviewWork(ORG_A, profiles.mixed);
      const decided = await decideReviewedByApi(mixedPage, profiles.mixed);
      assert.equal(decided.status, 200, JSON.stringify(decided));
      assert.equal(decided.data.source_candidate_handoff.status, "created");
      assert.deepEqual(await decisionRows(profiles.mixed), [{ decision_outcome: "reviewed", decided_by: kaiUserIds.mixed, decided_by_role: "gk_reviewer" }]);
      results.J3_1 = "PASS: client Studio; cockpit capability; decision gk_reviewer; P1-07 created (client-Studio UI path itself proven by the reachability spec cases 10-11)";
    });

    // =====================================================================
    // J4. Bound organization administrator (binding-derived client_admin)
    // =====================================================================
    const boundAdminPage = await session(USERS.boundAdmin);
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

    await test("J4-2: the bound administrator cannot exercise GK source-candidate review or promotion, by direct route, writing nothing", async () => {
      const candidate = await candidateFor(profiles.bound);
      const before = await allKaiCounts();
      const queue = await boundAdminPage.fetchJson("GET", sourceQueuePath());
      const detail = await boundAdminPage.fetchJson("GET", candidatePath(candidate.intake_source_candidate_id));
      const promote = await boundAdminPage.fetchJson("POST", candidateDecisionPath(candidate.intake_source_candidate_id), PROMOTE_BODY);
      await assertNothingWritten(before, "bound administrator source promotion");
      results.J4_2 = { queue: queue.status, detail: detail.status, promote: [promote.status, promote.errorCode, promote.blockingReason] };
      console.log(`[campaign] J4-2 bound admin GK negatives: ${JSON.stringify(results.J4_2)}`);
      assert.deepEqual([queue.status, detail.status, promote.status], [403, 403, 403]);
    });

    await test("J4-3: a stored-only client_admin (no binding) has no sensitivity authority, writing nothing", async () => {
      const cockpit = await storedAdminPage.fetchJson("GET", cockpitCapabilitiesPath(ORG_A));
      const before = await allKaiCounts();
      const decision = await storedAdminPage.fetchJson("POST", decisionPath(profiles.probe), FAKE_DECISION_BODY);
      const work = await storedAdminPage.fetchJson("POST", reviewWorkPath(profiles.probe), {});
      await assertNothingWritten(before, "stored client_admin");
      assert.equal(cockpit.data.can_manage_sensitivity_review, false);
      assert.deepEqual([decision.status, work.status], [403, 403]);
      results.J4_3 = "PASS: capability false; decision 403; review work 403";
    });

    // =====================================================================
    // J5. Downstream GK review: P1-08 source review and promotion
    // =====================================================================
    await test("J5-1: the next authorized human for source review - the provisioned non-superuser GK reviewer - can reach the P1-08 review in the product UI", async () => {
      const candidate = await candidateFor(profiles.reviewer);
      // The GK Studio: any source-review entry for the pending candidate?
      await openKnowledgeStudio(reviewerPage);
      const studioRequests = reviewerPage.requests().map(pathOf);
      let studioOffersSourceReview = false;
      for (const tab of ["Reviews", "Processing", "Files", "Evidence"]) {
        await reviewerPage.clickTab(tab);
        await reviewerPage.idle();
        const body = await reviewerPage.text();
        if (body.includes("source_candidate_review") || body.includes(candidate.intake_source_candidate_id) || (await reviewerPage.visibleButton("Promote"))) {
          studioOffersSourceReview = true;
        }
      }
      // The only page that renders P1-08 controls.
      await reviewerPage.goto("/gk-admin/kai-review-cockpit");
      const cockpitPagePath = await reviewerPage.pathname();
      const cockpitPageText = await reviewerPage.text();
      results.J5_1 = {
        studioOffersSourceReview,
        studioCalledSourceCandidateRoutes: studioRequests.some((p) => p.includes("/source-candidates")),
        cockpitPageLandedOn: cockpitPagePath,
        cockpitRendered: cockpitPageText.includes("KAI internal review cockpit"),
      };
      console.log(`[campaign] J5-1 source-review reachability for a non-superuser GK reviewer: ${JSON.stringify(results.J5_1)}`);
      assert.ok(studioOffersSourceReview || results.J5_1.cockpitRendered,
        "an authorized GK reviewer must be able to reach pending source review in the product UI");
    });

    await test("J5-2: the same reviewer's direct P1-08 request is authorized: promotion persists with lineage and the P2-01 evidence handoff; an identical replay writes nothing", async () => {
      const candidate = await candidateFor(profiles.reviewer);
      const queue = await reviewerPage.fetchJson("GET", sourceQueuePath());
      assert.equal(queue.status, 200);
      assert.ok(queue.data.items.some((item) => item.target_object_id === candidate.intake_source_candidate_id), "the pending item is visible to the reviewer's API session");
      const detail = await reviewerPage.fetchJson("GET", candidatePath(candidate.intake_source_candidate_id));
      assert.deepEqual([detail.status, detail.data.decision_controls_enabled], [200, true]);
      const before = await allKaiCounts();
      const promoted = await reviewerPage.fetchJson("POST", candidateDecisionPath(candidate.intake_source_candidate_id), PROMOTE_BODY);
      assert.equal(promoted.status, 200, JSON.stringify(promoted));
      assert.deepEqual([promoted.data.promotion_decision.decision_status, promoted.data.evidence_extraction_handoff.status], ["promoted", "created"]);
      const changed = changedTables(before, await allKaiCounts());
      console.log(`[campaign] J5-2 promotion changed tables: ${JSON.stringify(changed)}`);
      for (const table of ["intake_promotion_decisions", "sources", "source_versions", "evidence_items"]) assert.ok(changed.includes(table), table);
      const [lineage] = await query(
        `SELECT v.is_current, d.source_version_id = v.source_version_id AS decided, d.created_by::text AS decided_by
           FROM kai.source_versions v JOIN kai.intake_promotion_decisions d ON d.organization_id = v.organization_id
            AND d.intake_source_candidate_id = v.intake_source_candidate_id
          WHERE v.organization_id = $1::uuid AND v.intake_source_candidate_id = $2::uuid`, [ORG_A, candidate.intake_source_candidate_id]);
      assert.deepEqual([lineage.is_current, lineage.decided, lineage.decided_by], [true, true, kaiUserIds.reviewer]);
      const evidence = await evidenceForCandidate(candidate.intake_source_candidate_id);
      assert.equal(evidence.length, 2);
      for (const row of evidence) assert.deepEqual([row.evidence_review_status, row.queue_status], ["needs_gk_review", "open"]);
      const replayBefore = await allKaiCounts();
      const replay = await reviewerPage.fetchJson("POST", candidateDecisionPath(candidate.intake_source_candidate_id), PROMOTE_BODY);
      assert.deepEqual([replay.status, replay.data?.replayed], [200, true]);
      await assertNothingWritten(replayBefore, "P1-08 replay");
      results.J5_2 = "PASS: API P1-08 promoted by the reviewer; source/version lineage current; 2 evidence items needs_gk_review with open evidence_review items; replay wrote nothing";
    });

    const gkOperatorPage = await session(USERS.gkOperator);
    await test("J5-3: an organization + global gk_operator (not a site admin) is also kept from the P1-08 page though its API admits them", async () => {
      const candidate = await candidateFor(profiles.superGk);
      await gkOperatorPage.goto("/gk-admin/kai-review-cockpit");
      const landed = await gkOperatorPage.pathname();
      const detail = await gkOperatorPage.fetchJson("GET", candidatePath(candidate.intake_source_candidate_id));
      results.J5_3 = { cockpitPageLandedOn: landed, detail: [detail.status, detail.data?.decision_controls_enabled] };
      console.log(`[campaign] J5-3 gk_operator: ${JSON.stringify(results.J5_3)}`);
      assert.deepEqual([detail.status, detail.data.decision_controls_enabled], [200, true]);
      assert.equal(landed, "/gk-admin/kai-review-cockpit", "an authorized GK operator must be able to open the P1-08 review page");
    });

    await test("J5-4: a superuser with global gk_admin and only a derived client_admin membership is offered Promote in the cockpit, and the server refuses it", async () => {
      const candidate = await candidateFor(profiles.superGk);
      const before = await allKaiCounts();
      const { controlsOffered, requests } = await promoteThroughCockpit(superGkPage, candidate.intake_source_candidate_id);
      const posts = writes(requests);
      const pageText = await superGkPage.text();
      await assertNothingWritten(before, "refused superuser promotion");
      const direct = await superGkPage.fetchJson("POST", candidateDecisionPath(candidate.intake_source_candidate_id), PROMOTE_BODY);
      results.J5_4 = { controlsOffered, posts, direct: [direct.status, direct.errorCode, direct.blockers], shownError: (pageText.match(/(Request failed[^\n]*|[^\n]*not allowed[^\n]*|[^\n]*tenant[^\n]*)/i) || [null])[0] };
      console.log(`[campaign] J5-4 superuser (global gk_admin, derived client_admin) in cockpit: ${JSON.stringify(results.J5_4)}`);
      assert.ok(!controlsOffered || (posts.length === 1 && posts[0][2] === 200),
        "the cockpit must not offer a P1-08 decision the server refuses for this actor");
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
      assert.ok(await reviewerPage.clickInEvidenceItem(first.statement, "Review evidence"), "Review evidence offered");
      await reviewerPage.waitFor(async () => reviewerPage.evaluate(`Boolean(document.querySelector('[aria-label="Evidence review"]'))`), "review panel");
      assert.ok(await reviewerPage.evaluate(`(() => { const el = document.getElementById("evidence-library-review-decision-supported"); if (!el) return false; el.click(); return el.checked; })()`));
      const before = await allKaiCounts();
      const mark = reviewerPage.mark();
      assert.ok(await reviewerPage.clickInEvidenceItem(first.statement, "Record Evidence Review Decision"));
      await reviewerPage.waitForText("Evidence review decision recorded: supported.");
      await reviewerPage.idle();
      const posted = writes(reviewerPage.requestsSince(mark));
      assert.equal(posted.length, 1, "the browser records exactly one evidence decision");
      assert.deepEqual([posted[0][0], posted[0][2]], ["POST", 200]);
      const postedMatch = /\/evidence-items\/([0-9a-f-]+)\/evidence-review\/([0-9a-f-]+)\/complete$/.exec(posted[0][1]);
      assert.ok(postedMatch, "the browser used the governed evidence-review route");
      const reviewedEvidenceId = postedMatch[1];
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
    await test("J3-2: the mixed-role reviewer's P1-08 promotion is refused (source-promotion authority unchanged by the 2026-10-11 decision), writing nothing", async () => {
      const candidate = await candidateFor(profiles.mixed);
      const before = await allKaiCounts();
      const promote = await mixedPage.fetchJson("POST", candidateDecisionPath(candidate.intake_source_candidate_id), PROMOTE_BODY);
      await assertNothingWritten(before, "mixed-role promotion");
      results.J3_2 = [promote.status, promote.errorCode, promote.blockers];
      console.log(`[campaign] J3-2 mixed P1-08: ${JSON.stringify(results.J3_2)}`);
      assert.equal(promote.status, 403);
    });

    await test("J3-3: the mixed-role reviewer's P2-12 evidence review is admitted; its claim-proposal handoff must succeed for the same human or the decision must be refused", async () => {
      const candidate = await candidateFor(profiles.reviewer);
      const [, second] = await evidenceForCandidate(candidate.intake_source_candidate_id);
      const evidenceLibrary = await mixedPage.fetchJson("GET", `${INTAKE}/admin/organizations/${ORG_A}/evidence-library/candidates`);
      const claimLibrary = await mixedPage.fetchJson("GET", `${INTAKE}/admin/organizations/${ORG_A}/claim-library/candidates`);
      assert.deepEqual([evidenceLibrary.status, claimLibrary.status], [403, 403],
        "the two GK Studio work lists reject the mixed role even though the review write below accepts it");
      const before = await allKaiCounts();
      const reviewed = await mixedPage.fetchJson("POST", evidenceReviewPath(ORG_A, second.evidence_item_id, second.queue_item),
        { expected_updated_at: new Date(second.updated_at).toISOString(), decision: "supported" });
      const changed = changedTables(before, await allKaiCounts());
      const [claim] = await query("SELECT claim_id::text FROM kai.claims WHERE organization_id = $1::uuid AND evidence_item_id = $2::uuid", [ORG_A, second.evidence_item_id]);
      const [row] = await query("SELECT decided_by::text, decided_by_role, decision_outcome FROM kai.evidence_review_decisions WHERE organization_id = $1::uuid AND evidence_item_id = $2::uuid",
        [ORG_A, second.evidence_item_id]);
      results.J3_3 = { evidenceLibrary: evidenceLibrary.status, claimLibrary: claimLibrary.status, status: reviewed.status, decision: row ?? null, decidedByMixed: row?.decided_by === kaiUserIds.mixed, handoff: reviewed.data?.claim_proposal_handoff ?? null, claimCreated: Boolean(claim), changed };
      console.log(`[campaign] J3-3 mixed P2-12: ${JSON.stringify(results.J3_3)}`);
      assert.ok(reviewed.status === 403 || reviewed.data?.claim_proposal_handoff?.status === "created",
        "the evidence-review decision and its server-side claim proposal must agree on who is authorized");
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
  } finally {
    console.log(`[campaign] RESULTS ${JSON.stringify(results, null, 2)}`);
    for (const page of pages) await page.close().catch(() => {});
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await seedPool.end();
  }
}
