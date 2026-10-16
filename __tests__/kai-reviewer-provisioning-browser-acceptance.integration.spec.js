import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Browser acceptance of reviewer provisioning end to end, run only by
 *   node scripts/kai-client-knowledge-studio-browser-acceptance-local-postgres.js \
 *     __tests__/kai-reviewer-provisioning-browser-acceptance.integration.spec.js
 * against that runner's ephemeral loopback PostgreSQL. Skipped otherwise.
 *
 * A. Baseline: a Get Kinder superuser completes a file sensitivity review in
 *    the GK Knowledge Studio, and what admits them on the review routes.
 * B. A superuser places an existing user on an organization as a Get Kinder
 *    reviewer from /admin -> Organizations -> KAI Access (the gk_reviewer
 *    organization role, then the global gk_reviewer role); that user, in a
 *    new session, completes a sensitivity review in the same Studio; the
 *    organization sees the review complete; revoking the global role ends it.
 * C. An NPO administrator makes a member client_reviewer in Team & Access;
 *    that member completes a client follow-up from Knowledge Studio; changing
 *    the role back ends it.
 * D. Negative authorization for administrators, reviewers, and contributors.
 *
 * Real: every KAI router/service/read model and the /api/admin router on the
 * runner cluster, resolveKaiActorContext with real memberships, global roles,
 * GK organization-admin bindings, and superuser authority, the built bundle,
 * and a real headless Chrome with one isolated browser context (harness
 * cookie) per actor and session.
 * Simulated: the Get Kinder session login (req.user, including is_admin, from
 * a harness cookie); the P1-03..P1-05 rows of each synthetic file (the P1
 * worker's output) and the earlier "start review work" step (the real P1-06
 * service called directly), as in the sensitivity reachability acceptance; the
 * evidence -> claim -> claim-gap follow-up chain for path C (the real
 * services called directly); and, as baseline preconditions only, the
 * superuser's own global gk_admin role and the negative-case actors' roles.
 * No role or membership under test is seeded: each one is written by the
 * governed administration route the browser calls.
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

test("reviewer provisioning browser acceptance isolation: a non-loopback runner URL is refused", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
});

if (!RUNNER_DATABASE_URL || !CHROME || !WORKDIR) {
  test("reviewer provisioning browser acceptance requires its runner", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_DATABASE_URL);
  await runBrowserAcceptance();
}

// ---------------------------------------------------------------------------
// Minimal Chrome DevTools protocol client (Node's built-in WebSocket), the
// same shape as the other Knowledge Studio acceptance specs.
// ---------------------------------------------------------------------------

async function launchChrome() {
  const profileDir = join(WORKDIR, "chrome-profile-reviewer-provisioning");
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
    activeTab: () => evaluate(`(() => { const el = document.querySelector(".nav-tabs button.active"); return el ? el.innerText.trim() : null; })()`),
    clickNav: (label) => clickWhere(`nav ${label}`, `() => [...document.querySelectorAll("[role=button], a, button")]
      .filter((el) => el.offsetParent !== null).find((el) => el.innerText.trim() === ${JSON.stringify(label)})`),
    clickTab: (label) => clickWhere(`tab ${label}`, `() => [...document.querySelectorAll(".nav-tabs button")]
      .filter((el) => el.offsetParent !== null).find((el) => el.innerText.trim() === ${JSON.stringify(label)})`),
    clickButton: (label) => clickWhere(`button ${label}`, `() => [...document.querySelectorAll("button")]
      .filter((el) => el.offsetParent !== null && !el.disabled).find((el) => el.innerText.trim() === ${JSON.stringify(label)})`),
    linkHref: (label) => evaluate(`(() => {
      const el = [...document.querySelectorAll("a")].find((a) => a.offsetParent !== null && a.innerText.trim() === ${JSON.stringify(label)});
      return el ? el.getAttribute("href") : null;
    })()`),
    clickLink: (label) => clickWhere(`link ${label}`, `() => [...document.querySelectorAll("a")]
      .filter((el) => el.offsetParent !== null).find((el) => el.innerText.trim() === ${JSON.stringify(label)})`),
    // Sets the decision form's <select> on the row whose label is `rowLabel`.
    setFormRow: (rowLabel, value) => setSelect(`() => {
      const label = [...document.querySelectorAll(".col-7")].find((el) => el.offsetParent !== null && el.innerText.trim() === ${JSON.stringify(rowLabel)});
      return label && label.parentElement.querySelector("select");
    }`, value),
    selectProject: (engagementId) => setSelect(`() => document.getElementById("gk-shell-project-select")`, engagementId),
    // /admin KAI Access modal.
    clickOrganizationKaiAccess: (organizationName) => clickWhere(`KAI Access for ${organizationName}`, `() => [...document.querySelectorAll("tr")]
      .filter((tr) => tr.offsetParent !== null && tr.innerText.includes(${JSON.stringify(organizationName)}))
      .map((tr) => [...tr.querySelectorAll("button")].find((b) => b.innerText.trim() === "KAI Access")).find(Boolean)`),
    modalText: () => evaluate(`(() => { const el = document.querySelector(".admin-edit-card"); return el ? el.innerText : null; })()`),
    modalRoleOptions: () => evaluate(`[...document.querySelectorAll(".admin-edit-card .border-top select option")].map((o) => o.value)`),
    async modalGrant(email, roleName) {
      const ok = await evaluate(`(() => {
        const input = document.querySelector('.admin-edit-card input[type="email"]');
        if (!input) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, ${JSON.stringify(email)});
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
    clickAccessRowButton: (legacyId, label) => clickWhere(`KAI Access row ${legacyId} ${label}`,
      `() => [...document.querySelectorAll('[data-kai-access-row="legacy:${legacyId}"] button')]
        .find((b) => b.innerText.trim() === ${JSON.stringify(label)} && !b.disabled)`),
    // Impact Library Team & Access.
    memberRowText: (legacyId) => evaluate(`(() => {
      const el = document.querySelector('[data-team-access-member="legacy:${legacyId}"]');
      return el ? el.innerText : null;
    })()`),
    memberHasRoleSelect: (legacyId) => evaluate(`Boolean(document.querySelector('[data-team-access-member="legacy:${legacyId}"] select'))`),
    setMemberRole: (legacyId, roleName) => setSelect(`() => document.querySelector('[data-team-access-member="legacy:${legacyId}"] select')`, roleName),
    clickMemberButton: (legacyId, label) => clickWhere(`member ${legacyId} ${label}`,
      `() => [...document.querySelectorAll('[data-team-access-member="legacy:${legacyId}"] button')]
        .find((el) => el.innerText.trim() === ${JSON.stringify(label)} && !el.disabled)`),
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
// Acceptance
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
  const { __clientFollowupCompletionRepositoryContract } = await import("../Backend/kai/dictionary/postgresClientFollowupCompletionRepository.js");
  const sprint2IntakeApiRouter = (await import("../Backend/kai/routes/sprint2IntakeApi.js")).default;
  const kaiAccessAdministrationApiRouter = (await import("../Backend/kai/routes/kaiAccessAdministrationApi.js")).default;
  const adminApiRouter = (await import("../routes/adminApi.js")).default;
  const { requireKaiSprint2Enabled } = await import("../Backend/kai/config/kaiSprint2Config.js");
  const { requireKaiSprint2Authenticated } = await import("../Backend/kai/middleware/kaiSprint2Authentication.js");
  const query = async (sql, params = []) => (await seedPool.query(sql, params)).rows;
  const ENV = { KAI_SPRINT2_ENABLED: "true" };
  const noAudit = () => ({ prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } });
  const FOLLOWUP_AUDIT_OPERATION = __clientFollowupCompletionRepositoryContract.CLIENT_FOLLOWUP_COMPLETION_AUDIT_OPERATION;

  // Path A/B organization (bound to a Get Kinder organization, so it appears
  // in /admin -> Organizations), a second organization for the cross-tenant
  // negatives, and path C on the runner's smoke-seeded evidence organization.
  const ORG_A = "00000000-0000-4000-8000-00000000c1a1";
  const ORG_B = "00000000-0000-4000-8000-00000000c1b2";
  const ORG_C = "00000000-0000-4000-8000-000000000001";
  const ORG_A_NAME = "Saltmarsh Synthetic Food Bank";
  const PROJECT_A = "7d000000-0000-4000-8000-00000000c1a1";
  const PROJECT_B = "7d000000-0000-4000-8000-00000000c1b2";
  const PROJECT_C = "7d000000-0000-4000-8000-00000000c1c3";
  const BATCH_A = "11000000-0000-4000-8000-00000000c1a1";
  const BATCH_B = "11000000-0000-4000-8000-00000000c1b2";
  const FILES = Object.freeze({
    superuser: "21000000-0000-4000-8000-00000000c101",
    reviewer: "21000000-0000-4000-8000-00000000c102",
    afterRevoke: "21000000-0000-4000-8000-00000000c103",
    otherOrg: "21000000-0000-4000-8000-00000000c104",
  });
  const NAMES = Object.freeze({
    superuser: "synthetic_pantry_visits_2025_26.csv",
    reviewer: "synthetic_hamper_deliveries_2025_26.csv",
    afterRevoke: "synthetic_volunteer_shifts_2025_26.csv",
    otherOrg: "synthetic_other_org_intake_2025_26.csv",
  });
  const FIELD_KEYS = ["households_served", "programme_month"];
  const USERS = Object.freeze({
    superuser: 1101, // site admin; Get Kinder admin of Org A's bound organization; global gk_admin (baseline precondition)
    superuserNoKaiRole: 1102, // site admin; stored client_contributor of Org A; no global KAI role or bound-admin exception
    recipient: 1103, // existing Get Kinder user with no KAI role; made a Get Kinder reviewer in path B
    npoAdminA: 1104, // stored client_admin of Org A
    clientReviewerA: 1105, // stored client_reviewer of Org A
    contributorA: 1106, // stored client_contributor of Org A
    gkAdminNotSuperuser: 1107, // global gk_admin with a gk_admin membership in Org A, not a site admin
    queueOpener: 1108, // global gk_operator, used only for the simulated "start review work" step
    npoAdminC: 1109, // stored client_admin of Org C
    memberC: 1110, // stored client_contributor of Org C; made client_reviewer in path C
  });
  const SITE_ADMINS = new Set([USERS.superuser, USERS.superuserNoKaiRole]);
  const email = (legacyId) => `user${legacyId}@saltmarsh.test`;

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
                 ($1::uuid, $3, 'saltmarsh-synthetic'), ($2::uuid, 'Other Synthetic Pantry', 'other-synthetic-pantry')`, [ORG_A, ORG_B, ORG_A_NAME]);
  await query(`INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES ($1::uuid, 'Harbourline Synthetic Society', 'harbourline-synthetic')
               ON CONFLICT (organization_id) DO NOTHING`, [ORG_C]);
  const [gkOrganization] = await query("INSERT INTO public.organizations (name, status) VALUES ($1, 'approved') RETURNING id", [ORG_A_NAME]);
  await query("INSERT INTO kai.gk_organization_bindings (gk_organization_id, kai_organization_id, status) VALUES ($1, $2::uuid, 'active')", [gkOrganization.id, ORG_A]);
  for (const [engagementId, organizationId, code] of [[PROJECT_A, ORG_A, "Project Saltmarsh"], [PROJECT_B, ORG_B, "Project Other"], [PROJECT_C, ORG_C, "Project Harbourline Follow-ups"]]) {
    await query("INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code, project_metadata) VALUES ($1::uuid, $2::uuid, $3, '{}'::jsonb)",
      [engagementId, organizationId, code]);
  }
  for (const [batchId, organizationId, engagementId, code] of [[BATCH_A, ORG_A, PROJECT_A, "saltmarsh-2026"], [BATCH_B, ORG_B, PROJECT_B, "other-2026"]]) {
    await query(`INSERT INTO kai.intake_batches (intake_batch_id, organization_id, engagement_id, batch_code, processing_status, review_status)
                 VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'received', 'not_reviewed')`, [batchId, organizationId, engagementId, code]);
  }

  // --- users ----------------------------------------------------------------
  // Every user is an existing Get Kinder account (public.userdata). Only the
  // fixture actors below get a kai.users mapping now; the recipient gets one
  // on their own first sign-in.
  for (const legacyId of Object.values(USERS)) {
    await query("INSERT INTO public.userdata (id, email, firstname, lastname) VALUES ($1, $2, 'Synthetic', $3) ON CONFLICT (id) DO NOTHING",
      [legacyId, email(legacyId), `User ${legacyId}`]);
  }
  const kaiUserIds = {};
  for (const [key, legacyId] of Object.entries(USERS)) {
    if (key === "recipient") continue;
    kaiUserIds[key] = (await findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: legacyId, email: email(legacyId) })).user_id;
  }
  for (const legacyId of [USERS.superuser]) {
    await query("INSERT INTO public.user_org_memberships (org_id, user_id, role, is_active) VALUES ($1, $2, 'admin', true)", [gkOrganization.id, legacyId]);
  }
  const insertMembership = (organizationId, key, role) => query(
    "INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status) VALUES ($1::uuid, $2::uuid, $3, 'active')",
    [organizationId, kaiUserIds[key], role]);
  const insertGlobalRole = (key, role) => query(
    "INSERT INTO kai.user_roles (user_id, role_id) SELECT $1::uuid, role_id FROM kai.roles WHERE role_name = $2", [kaiUserIds[key], role]);
  await insertMembership(ORG_A, "npoAdminA", "client_admin");
  await insertMembership(ORG_A, "superuserNoKaiRole", "client_contributor");
  await insertMembership(ORG_A, "clientReviewerA", "client_reviewer");
  await insertMembership(ORG_A, "contributorA", "client_contributor");
  await insertMembership(ORG_A, "gkAdminNotSuperuser", "gk_admin");
  await insertMembership(ORG_A, "queueOpener", "gk_operator");
  await insertMembership(ORG_B, "queueOpener", "gk_operator");
  await insertMembership(ORG_C, "npoAdminC", "client_admin");
  await insertMembership(ORG_C, "memberC", "client_contributor");
  await insertGlobalRole("superuser", "gk_admin");
  await insertGlobalRole("gkAdminNotSuperuser", "gk_admin");
  await insertGlobalRole("queueOpener", "gk_operator");
  const queueOpener = (organizationId) => ({
    actorType: "human",
    actorUserId: kaiUserIds.queueOpener,
    source: "public.userdata",
    kaiRoles: ["gk_operator"],
    platformSuperuser: false,
    organizationMemberships: [{ organization_id: organizationId, membership_status: "active", role_name: "gk_operator" }],
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
  // The earlier "start review work" step: the real P1-06 service, once per
  // file, only when that file's case starts (so each Review Queue holds one
  // open sensitivity item at a time).
  async function openReviewWork(organizationId, profileId) {
    const ensured = await ensureSensitivityReviewQueueItem(
      { organizationId, intakeSensitivityProfileId: profileId, actorContext: queueOpener(organizationId), now: new Date().toISOString() },
      { env: ENV, metadataOnlyAudit: noAudit() },
    );
    assert.equal(ensured.ok, true, JSON.stringify(ensured));
    return ensured.data.reviewQueueItem;
  }
  const profiles = {
    superuser: await seedFreshFile({ organizationId: ORG_A, batchId: BATCH_A, engagementId: PROJECT_A, intakeFileId: FILES.superuser, name: NAMES.superuser, checksumChar: "c" }),
    reviewer: await seedFreshFile({ organizationId: ORG_A, batchId: BATCH_A, engagementId: PROJECT_A, intakeFileId: FILES.reviewer, name: NAMES.reviewer, checksumChar: "d" }),
    afterRevoke: await seedFreshFile({ organizationId: ORG_A, batchId: BATCH_A, engagementId: PROJECT_A, intakeFileId: FILES.afterRevoke, name: NAMES.afterRevoke, checksumChar: "e" }),
    otherOrg: await seedFreshFile({ organizationId: ORG_B, batchId: BATCH_B, engagementId: PROJECT_B, intakeFileId: FILES.otherOrg, name: NAMES.otherOrg, checksumChar: "f" }),
  };

  // --- path C: one claim with fixed client follow-ups (real services) -------
  const gkService = (role, suffix) => ({
    actorType: "human",
    actorUserId: `90000000-0000-4000-8000-0000000c90${suffix}`,
    source: "public.userdata",
    organizationMemberships: [{ organization_id: ORG_C, membership_status: "active", role_name: role }],
  });
  const gkReviewerService = gkService("gk_reviewer", "01");
  const NOW = new Date().toISOString();
  const [sourceVersion] = await query(
    "SELECT source_version_id FROM kai.source_versions WHERE organization_id = $1::uuid AND is_current = true ORDER BY source_version_id LIMIT 1", [ORG_C]);
  const extracted = await extractEvidenceFromSourceVersion(
    { organizationId: ORG_C, sourceVersionId: sourceVersion.source_version_id, actorContext: gkReviewerService, now: NOW },
    { env: ENV, metadataOnlyAudit: noAudit() },
  );
  assert.equal(extracted.ok, true, JSON.stringify(extracted));
  const [evidence] = await query(
    `SELECT evidence_item_id FROM kai.evidence_items e WHERE organization_id = $1::uuid
       AND NOT EXISTS (SELECT 1 FROM kai.claims c WHERE c.organization_id = e.organization_id AND c.evidence_item_id = e.evidence_item_id)
     ORDER BY evidence_item_id LIMIT 1`, [ORG_C]);
  const proposed = await proposeClaim({ organizationId: ORG_C, evidenceItemId: evidence.evidence_item_id, actorContext: gkReviewerService, now: NOW },
    { env: ENV, metadataOnlyAudit: noAudit() });
  assert.equal(proposed.ok, true, JSON.stringify(proposed));
  const followupClaimId = proposed.data.claim.claim_id;
  assert.equal((await generateClaimGapFollowups({ organizationId: ORG_C, claimId: followupClaimId, actorContext: gkReviewerService, now: NOW },
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
  assert.ok((await followupQueue()).length >= 2, "at least two follow-ups: one to complete, one for the post-revocation denial");

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
  app.get("/impact-library", (_req, res) => res.send(pageShell("Impact Library", "impact-evidence-library-root", "window.renderImpactEvidenceLibrary();")));
  app.get("/admin", (_req, res) => res.send(pageShell("Admin", "admin-root", "window.renderAdmin('#admin-root');")));
  // Mirrors index.js /kai/client-followups: the organization comes only from
  // ?organizationId= and is a navigation hint (the routes authorize).
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

  const COCKPIT = "/api/kai/sprint2/intake/admin/review-cockpit";
  const ACCESS = "/api/kai/sprint2/access-administration";
  const capabilitiesPath = (organizationId) => `${COCKPIT}/capabilities?organization_id=${organizationId}`;
  const accessCapabilitiesPath = (organizationId) => `/api/kai/sprint2/intake/admin/organizations/${organizationId}/access-capabilities`;
  const profilePath = (profileId, organizationId = ORG_A) => `${COCKPIT}/sensitivity-profiles/${profileId}?organization_id=${organizationId}`;
  const decisionPath = (profileId, organizationId = ORG_A) => `${COCKPIT}/sensitivity-profiles/${profileId}/decision?organization_id=${organizationId}`;
  const reviewWorkPath = (profileId, organizationId = ORG_A) => `${COCKPIT}/sensitivity-profiles/${profileId}/review-work?organization_id=${organizationId}`;
  const membershipPath = (organizationId, legacyId) => `${ACCESS}/organizations/${organizationId}/memberships/${legacyId}`;
  const globalRolePath = (legacyId) => `${ACCESS}/global-roles/${legacyId}`;
  const followupsPath = (organizationId) => `/api/kai/sprint2/intake/admin/organizations/${organizationId}/client-followups`;
  const completePath = (followupId) => `/api/kai/sprint2/intake/admin/organizations/${ORG_C}/claims/${followupClaimId}/client-followups/${followupId}/complete`;
  const pipelinePath = `/api/kai/sprint2/intake/admin/organizations/${ORG_A}/engagements/${PROJECT_A}/client-evidence-pipeline`;
  const pathOf = (r) => new URL(r.url).pathname;
  const writes = (requests) => requests.filter((r) => r.method !== "GET").map((r) => [r.method, pathOf(r), r.status]);

  async function sensitivityState(profileId, organizationId = ORG_A) {
    const [row] = await query(`SELECT
      (SELECT count(*) FROM kai.intake_sensitivity_review_decisions WHERE organization_id = $1::uuid AND intake_sensitivity_profile_id = $2::uuid)::int AS decisions,
      (SELECT count(*) FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'sensitivity_review' AND target_object_id = $2::uuid)::int AS sensitivity_queue,
      (SELECT count(*) FROM kai.audit_events WHERE organization_id = $1::uuid AND action = 'sensitivity_review_decision_recorded')::int AS decision_audits,
      (SELECT count(*) FROM kai.upload_lifecycle_audit a JOIN kai.intake_sensitivity_profiles p
          ON p.organization_id = a.organization_id AND p.intake_file_id = a.intake_file_id
        WHERE a.organization_id = $1::uuid AND p.intake_sensitivity_profile_id = $2::uuid AND a.operation = 'sensitivity_review_decision_recorded')::int AS lifecycle_audits`,
    [organizationId, profileId]);
    return row;
  }
  async function decisionRows(profileId) {
    return query(
      `SELECT decision_outcome, decided_by::text, decided_by_role FROM kai.intake_sensitivity_review_decisions
        WHERE organization_id = $1::uuid AND intake_sensitivity_profile_id = $2::uuid ORDER BY created_at`, [ORG_A, profileId]);
  }
  async function queueRow(profileId, organizationId = ORG_A) {
    const [row] = await query(
      `SELECT review_queue_item_id::text, queue_status, review_status, updated_at FROM kai.review_queue_items
        WHERE organization_id = $1::uuid AND queue_type = 'sensitivity_review' AND target_object_id = $2::uuid`, [organizationId, profileId]);
    return row || null;
  }
  async function auditFor(action, actorKaiUserId) {
    return query(
      `SELECT action, organization_id::text, actor_user_id::text, metadata FROM kai.audit_events
        WHERE action = $1 AND actor_user_id = $2::uuid ORDER BY audit_event_id`, [action, actorKaiUserId]);
  }
  async function storedMemberships(legacyId) {
    return query(
      `SELECT om.organization_id::text, om.role_name, om.membership_status FROM kai.organization_memberships om
         JOIN kai.users u ON u.user_id = om.user_id WHERE u.legacy_public_userdata_id = $1 ORDER BY 1, 2`, [legacyId]);
  }
  async function globalRoleRows(legacyId) {
    return query(
      `SELECT r.role_name, ur.active, ur.revoked_at IS NOT NULL AS revoked FROM kai.user_roles ur
         JOIN kai.roles r ON r.role_id = ur.role_id JOIN kai.users u ON u.user_id = ur.user_id
        WHERE u.legacy_public_userdata_id = $1 AND ur.organization_id IS NULL AND ur.engagement_id IS NULL ORDER BY 1`, [legacyId]);
  }
  // Every kai table's row count: a delta over all of them shows exactly which
  // tables a step wrote.
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
  async function roleAndMembershipSnapshot() {
    return {
      memberships: await query("SELECT organization_id::text, user_id::text, role_name, membership_status FROM kai.organization_memberships ORDER BY 1, 2, 3"),
      roles: await query("SELECT user_id::text, role_id, active, revoked_at FROM kai.user_roles ORDER BY 1, 2"),
    };
  }

  async function openKnowledgeStudio(page) {
    await page.goto("/impact-library");
    await page.waitForText("Knowledge Studio");
    await page.clickNav("Knowledge Studio");
    await page.waitFor(async () => page.evaluate(`Boolean(document.querySelector(".nav-tabs"))`), "Knowledge Studio tabs");
    await page.idle();
  }
  // GK Knowledge Studio -> Reviews -> the Review Queue sensitivity entry ->
  // the Processing card for exactly `profileId`.
  async function openSensitivityReviewFromQueue(page, profileId) {
    await openKnowledgeStudio(page);
    await page.clickTab("Reviews");
    await page.waitForText("Sensitivity / allowed-use");
    await page.waitFor(() => page.visibleButton("Review sensitivity & allowed use"), "the Review Queue sensitivity entry");
    const mark = page.mark();
    await page.clickButton("Review sensitivity & allowed use");
    await page.waitFor(() => page.visibleButton("Submit review"), "the sensitivity review card's decision form", { timeout: 8000 });
    await page.idle();
    assert.equal(await page.activeTab(), "Processing");
    const reads = page.requestsSince(mark).filter((r) => r.method === "GET" && r.url.endsWith(profilePath(profileId)));
    assert.ok(reads.length >= 1 && reads.every((r) => r.status === 200), "the card opened this review's profile");
    assert.deepEqual(writes(page.requestsSince(mark)), [], "opening the review writes nothing");
  }
  async function submitReviewed(page, profileId) {
    await page.setFormRow("Personal data", "present");
    await page.setFormRow("Minor data", "absent");
    const mark = page.mark();
    await page.clickButton("Submit review");
    await page.waitForText("Review recorded.");
    await page.idle();
    assert.deepEqual(writes(page.requestsSince(mark)), [["POST", `${COCKPIT}/sensitivity-profiles/${profileId}/decision`, 200]],
      "exactly the existing decision route");
  }
  async function openAdminKaiAccess(page) {
    await page.goto("/admin?tab=organizations");
    await page.waitForText(ORG_A_NAME);
    await page.clickOrganizationKaiAccess(ORG_A_NAME);
    await page.waitForText(`KAI Access — ${ORG_A_NAME}`);
    await page.idle();
  }

  const results = {};
  const pages = [];
  const session = async (legacyUserId) => {
    const page = await openPage(browser, { baseUrl, legacyUserId });
    pages.push(page);
    return page;
  };
  try {
    // =====================================================================
    // A. Baseline: the working superuser review path
    // =====================================================================
    const superuserPage = await session(USERS.superuser);
    const superuserQueue = await openReviewWork(ORG_A, profiles.superuser);

    await test("A1: the superuser's admission on the review path is a global GK role plus an active membership, not site-admin authority", async () => {
      // With site-admin authority but no global KAI role, the review routes refuse.
      const noRolePage = await session(USERS.superuserNoKaiRole);
      await noRolePage.goto("/impact-library");
      await noRolePage.waitForText("Knowledge Studio");
      const capabilities = await noRolePage.fetchJson("GET", accessCapabilitiesPath(ORG_A));
      assert.equal(capabilities.data.internalKnowledgeWorkspace, true, "site admin mounts the GK Studio (full-request actor)");
      const cockpit = await noRolePage.fetchJson("GET", capabilitiesPath(ORG_A));
      assert.equal(cockpit.data.can_manage_sensitivity_review, false, "but the cockpit, which re-resolves the actor from the user id only, does not admit them");
      const before = await sensitivityState(profiles.superuser);
      const decision = await noRolePage.fetchJson("POST", decisionPath(profiles.superuser), {
        expected_updated_at: new Date(superuserQueue.updated_at).toISOString(), review_queue_item_id: superuserQueue.review_queue_item_id, decision: "needs_more_information",
      });
      assert.deepEqual([decision.status, decision.errorCode, decision.blockingReason], [403, "authorization_denied", "role_not_allowed"], JSON.stringify(decision));
      assert.deepEqual(await sensitivityState(profiles.superuser), before, "nothing persisted");
      await openKnowledgeStudio(noRolePage);
      await noRolePage.clickTab("Processing");
      await noRolePage.idle();
      assert.equal(await noRolePage.visibleButton("Submit review"), false, "no decision form for a site admin without a GK role");
      // The working superuser: same site-admin and Get Kinder org-admin
      // authority, plus a global gk_admin role.
      await superuserPage.goto("/impact-library");
      await superuserPage.waitForText("Knowledge Studio");
      const ok = await superuserPage.fetchJson("GET", capabilitiesPath(ORG_A));
      assert.equal(ok.data.can_manage_sensitivity_review, true);
      results.A1_superuser_admission = "PASS: global gk_admin + derived client_admin membership; is_admin alone refused (403 role_not_allowed)";
    });

    await test("A2: the superuser opens the pending review in the GK Knowledge Studio and records 'reviewed' through the existing route, with audit", async () => {
      await openSensitivityReviewFromQueue(superuserPage, profiles.superuser);
      const before = await sensitivityState(profiles.superuser);
      const tablesBefore = await allKaiCounts();
      await submitReviewed(superuserPage, profiles.superuser);
      const after = await sensitivityState(profiles.superuser);
      assert.deepEqual([after.decisions - before.decisions, after.decision_audits - before.decision_audits, after.lifecycle_audits - before.lifecycle_audits], [1, 1, 1]);
      const [decision] = await decisionRows(profiles.superuser);
      assert.deepEqual(decision, { decision_outcome: "reviewed", decided_by: kaiUserIds.superuser, decided_by_role: "gk_admin" });
      const queue = await queueRow(profiles.superuser);
      assert.deepEqual([queue.review_queue_item_id, queue.queue_status, queue.review_status], [superuserQueue.review_queue_item_id, "resolved", "resolved"]);
      const changed = changedTables(tablesBefore, await allKaiCounts());
      console.log(`[reviewer-provisioning] A2 changed tables: ${JSON.stringify(changed)}`);
      assert.deepEqual(changed, ["audit_events", "intake_sensitivity_review_decisions", "intake_source_candidates", "review_queue_items", "upload_lifecycle_audit"]);
      assert.deepEqual(superuserPage.exceptions, []);
      results.A2_superuser_review = "PASS: decision reviewed by superuser (gk_admin), queue resolved/resolved, decision + lifecycle audit";
    });

    // =====================================================================
    // B. GK reviewer provisioning and review
    // =====================================================================
    const recipientFirstPage = await session(USERS.recipient);
    let recipientKaiUserId = null;

    await test("B0: before provisioning the recipient has no organization and the review routes refuse them", async () => {
      await recipientFirstPage.goto("/impact-library");
      await recipientFirstPage.idle();
      const [mapping] = await query("SELECT user_id::text, status FROM kai.users WHERE legacy_public_userdata_id = $1", [USERS.recipient]);
      assert.equal(mapping.status, "active", "the first sign-in created the KAI account mapping");
      recipientKaiUserId = mapping.user_id;
      const organizations = await recipientFirstPage.fetchJson("GET", "/api/kai/sprint2/intake/admin/organizations");
      assert.deepEqual(organizations.data.items, []);
      const cockpit = await recipientFirstPage.fetchJson("GET", capabilitiesPath(ORG_A));
      assert.equal(cockpit.data.can_manage_sensitivity_review, false);
      assert.deepEqual(await storedMemberships(USERS.recipient), []);
      assert.deepEqual(await globalRoleRows(USERS.recipient), []);
      results.B0_before = "PASS: no organization, no review capability";
    });

    const adminPage = await session(USERS.superuser);
    let reviewerQueue = null;

    await test("B1-B3: the superuser makes the recipient a Get Kinder reviewer of the organization from /admin KAI Access (organization role, then global role)", async () => {
      await openAdminKaiAccess(adminPage);
      const modal = await adminPage.modalText();
      assert.ok(modal.includes("Global KAI roles"), "the superuser sees each member's global KAI roles");
      assert.ok(modal.includes("A Get Kinder reviewer needs both"), "the two halves are explained");
      assert.deepEqual(await adminPage.modalRoleOptions(), ["client_admin", "client_reviewer", "client_contributor", "gk_reviewer", "gk_operator", "gk_admin"]);
      assert.match(await adminPage.accessRowText(USERS.superuser), /gk_admin/, "existing effective global roles are shown");

      let tablesBefore = await allKaiCounts();
      let mark = adminPage.mark();
      await adminPage.modalGrant(email(USERS.recipient), "gk_reviewer");
      await adminPage.waitFor(async () => Boolean(await adminPage.accessRowText(USERS.recipient)), "the recipient's roster row");
      await adminPage.idle();
      const grantRequests = adminPage.requestsSince(mark).map((r) => [r.method, pathOf(r), r.status]);
      console.log(`[reviewer-provisioning] organization-role grant requests: ${JSON.stringify(grantRequests)}`);
      assert.ok(grantRequests.some(([m, p, s]) => m === "GET" && p === "/api/admin/users/lookup" && s === 200), "existing exact-email lookup");
      // "Grant KAI Access" is the additive grant (owner decision B/E C04).
      assert.deepEqual(writes(adminPage.requestsSince(mark)), [["POST", `${membershipPath(ORG_A, USERS.recipient)}/roles`, 200]]);
      assert.deepEqual(await storedMemberships(USERS.recipient), [{ organization_id: ORG_A, role_name: "gk_reviewer", membership_status: "active" }]);
      assert.deepEqual(changedTables(tablesBefore, await allKaiCounts()), ["audit_events", "organization_memberships"]);
      const [membershipAudit] = await auditFor("organization_role_granted_access_admitted", kaiUserIds.superuser);
      assert.equal(membershipAudit.organization_id, ORG_A);
      assert.equal(membershipAudit.metadata.target_user_id, recipientKaiUserId);
      assert.equal(membershipAudit.metadata.resulting_role_name, "gk_reviewer");
      let row = await adminPage.accessRowText(USERS.recipient);
      assert.match(row, /gk_reviewer/);
      assert.match(row, /None/, "no global role yet");

      // The organization role alone opens the GK Studio for the recipient but
      // not the sensitivity review: the global role is the other half.
      const midPage = await session(USERS.recipient);
      await midPage.goto("/impact-library");
      await midPage.waitForText("Knowledge Studio");
      assert.equal((await midPage.fetchJson("GET", accessCapabilitiesPath(ORG_A))).data.internalKnowledgeWorkspace, true);
      assert.equal((await midPage.fetchJson("GET", capabilitiesPath(ORG_A))).data.can_manage_sensitivity_review, false);
      results.B_membership_only = "PASS: gk_reviewer membership -> GK Studio, no sensitivity review capability";

      tablesBefore = await allKaiCounts();
      mark = adminPage.mark();
      await adminPage.clickAccessRowButton(USERS.recipient, "Grant gk_reviewer");
      await adminPage.waitFor(async () => /Revoke gk_reviewer/.test(await adminPage.accessRowText(USERS.recipient) || ""), "the granted global role");
      await adminPage.idle();
      assert.deepEqual(writes(adminPage.requestsSince(mark)), [["PUT", globalRolePath(USERS.recipient), 200]]);
      assert.deepEqual(await globalRoleRows(USERS.recipient), [{ role_name: "gk_reviewer", active: true, revoked: false }]);
      assert.deepEqual(changedTables(tablesBefore, await allKaiCounts()), ["audit_events", "user_roles"]);
      const [roleAudit] = await auditFor("global_kai_role_assigned", kaiUserIds.superuser);
      assert.equal(roleAudit.metadata.target_user_id, recipientKaiUserId);
      assert.equal(roleAudit.metadata.role_name, "gk_reviewer");
      assert.match(await adminPage.accessRowText(USERS.recipient), /Revoke gk_reviewer/);
      assert.deepEqual(adminPage.exceptions, []);
      results.B1_B3_provisioning = "PASS: POST membership role gk_reviewer 200 + audit organization_role_granted_access_admitted; PUT global-roles gk_reviewer 200 + audit global_kai_role_assigned";
    });

    const recipientPage = await session(USERS.recipient);

    await test("B4-B9: in a new session the recipient has reviewer capability, opens the same GK Studio review, and records 'reviewed' with audit", async () => {
      reviewerQueue = await openReviewWork(ORG_A, profiles.reviewer);
      await recipientPage.goto("/impact-library");
      await recipientPage.waitForText("Knowledge Studio");
      const access = await recipientPage.fetchJson("GET", accessCapabilitiesPath(ORG_A));
      assert.equal(access.data.internalKnowledgeWorkspace, true);
      assert.equal(access.data.organizationAccessManagement, false, "no organization administration");
      assert.equal(access.data.clientFollowupReview, false, "no client review");
      assert.equal((await recipientPage.fetchJson("GET", capabilitiesPath(ORG_A))).data.can_manage_sensitivity_review, true);
      // Placed on Org A only: Org B stays out of reach, by capability and route.
      const otherQueue = await openReviewWork(ORG_B, profiles.otherOrg);
      const otherBefore = await allKaiCounts();
      const otherCockpit = await recipientPage.fetchJson("GET", capabilitiesPath(ORG_B));
      const otherRead = await recipientPage.fetchJson("GET", profilePath(profiles.otherOrg, ORG_B));
      const otherDecision = await recipientPage.fetchJson("POST", decisionPath(profiles.otherOrg, ORG_B), {
        expected_updated_at: new Date(otherQueue.updated_at).toISOString(), review_queue_item_id: otherQueue.review_queue_item_id, decision: "needs_more_information",
      });
      assert.equal(otherCockpit.data.can_manage_sensitivity_review, false);
      assert.deepEqual([otherRead.status, otherRead.blockingReason], [403, "missing_active_organization_membership"]);
      assert.deepEqual([otherDecision.status, otherDecision.blockingReason], [403, "missing_active_organization_membership"]);
      assert.deepEqual(changedTables(otherBefore, await allKaiCounts()), [], "the refused Org B attempts wrote nothing");
      results.D_reviewer_other_org = "PASS: global gk_reviewer placed on Org A only: Org B capability false, read 403, decision 403 (missing_active_organization_membership)";
      const navLabels = await recipientPage.evaluate(`[...document.querySelectorAll(".gk-shell-nav-group .gk-shell-nav-item")].map((el) => el.innerText.trim())`);
      assert.ok(!navLabels.includes("Team & Access"), "no Team & Access for a Get Kinder reviewer");

      await openSensitivityReviewFromQueue(recipientPage, profiles.reviewer);
      const before = await sensitivityState(profiles.reviewer);
      const tablesBefore = await allKaiCounts();
      await submitReviewed(recipientPage, profiles.reviewer);
      const after = await sensitivityState(profiles.reviewer);
      assert.deepEqual([after.decisions - before.decisions, after.decision_audits - before.decision_audits, after.lifecycle_audits - before.lifecycle_audits], [1, 1, 1]);
      const [decision] = await decisionRows(profiles.reviewer);
      assert.deepEqual(decision, { decision_outcome: "reviewed", decided_by: recipientKaiUserId, decided_by_role: "gk_reviewer" });
      const queue = await queueRow(profiles.reviewer);
      assert.deepEqual([queue.review_queue_item_id, queue.queue_status, queue.review_status], [reviewerQueue.review_queue_item_id, "resolved", "resolved"]);
      const decisionAudits = await auditFor("sensitivity_review_decision_recorded", recipientKaiUserId);
      assert.equal(decisionAudits.length, 1);
      assert.equal(decisionAudits[0].organization_id, ORG_A);
      console.log(`[reviewer-provisioning] recipient decision audit metadata: ${JSON.stringify(decisionAudits[0].metadata)}`);
      assert.deepEqual(changedTables(tablesBefore, await allKaiCounts()),
        ["audit_events", "intake_sensitivity_review_decisions", "intake_source_candidates", "review_queue_items", "upload_lifecycle_audit"]);
      assert.deepEqual(recipientPage.exceptions, []);
      results.B4_B9_review = "PASS: decision reviewed by recipient (gk_reviewer), queue resolved/resolved, decision + lifecycle audit";
    });

    const npoAdminPage = await session(USERS.npoAdminA);

    await test("B10: the organization sees the completed sensitivity review in its own Knowledge Studio", async () => {
      await npoAdminPage.goto("/impact-library");
      await npoAdminPage.waitForText("Knowledge Studio");
      const pipeline = await npoAdminPage.fetchJson("GET", pipelinePath);
      const byId = Object.fromEntries(pipeline.data.files.map((file) => [file.intakeFileId, file]));
      assert.notEqual(byId[FILES.reviewer].currentStage, "sensitivity_review", "the reviewed file moved past sensitivity review");
      assert.equal(byId[FILES.reviewer].stages.find((s) => s.key === "sensitivity_review").status, "complete");
      assert.equal(byId[FILES.afterRevoke].currentStage, "sensitivity_review", "an unreviewed file still waits");
      await openKnowledgeStudio(npoAdminPage);
      await npoAdminPage.selectProject(PROJECT_A);
      await npoAdminPage.idle();
      await npoAdminPage.clickTab("Reviews");
      await npoAdminPage.waitForText("Waiting for Get Kinder review");
      const body = await npoAdminPage.text();
      assert.ok(body.includes(`${NAMES.reviewer}: Source review (Waiting for Get Kinder)`), "the client sees the next stage");
      assert.ok(!body.includes(`${NAMES.reviewer}: Sensitivity review (Waiting for Get Kinder)`));
      assert.ok(!body.includes("reviewed_personal_data_status"), "no decision values reach the client");
      results.B10_projection = "PASS: client pipeline shows sensitivity review complete, Source review waiting";
    });

    await test("B11: revocation denies a fresh session and direct routes while an already-open review form retains stale capability", async () => {
      const pendingQueue = (await queueRow(profiles.afterRevoke)) || await openReviewWork(ORG_A, profiles.afterRevoke);
      await recipientPage.goto("/impact-library");
      await recipientPage.waitForText("Knowledge Studio");
      await openSensitivityReviewFromQueue(recipientPage, profiles.afterRevoke);
      assert.equal(await recipientPage.visibleButton("Submit review"), true);
      await openAdminKaiAccess(adminPage);
      const tablesBefore = await allKaiCounts();
      const stalePageMark = recipientPage.mark();
      const mark = adminPage.mark();
      await adminPage.clickAccessRowButton(USERS.recipient, "Revoke gk_reviewer");
      await adminPage.waitFor(async () => /Grant gk_reviewer/.test(await adminPage.accessRowText(USERS.recipient) || ""), "the revoked global role");
      await adminPage.idle();
      assert.deepEqual(writes(adminPage.requestsSince(mark)), [["PUT", globalRolePath(USERS.recipient), 200]]);
      assert.deepEqual(await globalRoleRows(USERS.recipient), [{ role_name: "gk_reviewer", active: false, revoked: true }]);
      // The global role row is soft-revoked in place; only the audit is inserted.
      assert.deepEqual(changedTables(tablesBefore, await allKaiCounts()), ["audit_events"]);
      const [revokeAudit] = await auditFor("global_kai_role_revoked", kaiUserIds.superuser);
      assert.equal(revokeAudit.metadata.target_user_id, recipientKaiUserId);

      await recipientPage.idle();
      assert.equal(await recipientPage.visibleButton("Submit review"), true, "the already-open form still offers a revoked action");
      assert.equal(recipientPage.requestsSince(stalePageMark).filter((request) => request.url.includes("/review-cockpit/capabilities")).length, 0,
        "the already-open page did not refresh its capability after another session revoked the role");

      const after = await session(USERS.recipient);
      await after.goto("/impact-library");
      await after.waitForText("Knowledge Studio");
      assert.equal((await after.fetchJson("GET", capabilitiesPath(ORG_A))).data.can_manage_sensitivity_review, false);
      await openKnowledgeStudio(after);
      await after.clickTab("Processing");
      await after.idle();
      assert.equal(await after.visibleButton("Submit review"), false, "no decision form after revocation");
      const before = await allKaiCounts();
      const read = await after.fetchJson("GET", profilePath(profiles.afterRevoke));
      const decide = await after.fetchJson("POST", decisionPath(profiles.afterRevoke), {
        expected_updated_at: new Date(pendingQueue.updated_at).toISOString(), review_queue_item_id: pendingQueue.review_queue_item_id, decision: "needs_more_information",
      });
      for (const [label, response] of [["read", read], ["decision", decide]]) {
        assert.deepEqual([response.status, response.errorCode, response.blockingReason], [403, "authorization_denied", "role_not_allowed"], `${label}: ${JSON.stringify(response)}`);
      }
      // P1-06 "start review work" admits the gk_reviewer organization role on
      // its own (combineGlobalRoles), so it still answers - here only as an
      // idempotent replay of the existing item, with no write.
      const work = await after.fetchJson("POST", reviewWorkPath(profiles.afterRevoke), {});
      assert.deepEqual([work.status, work.data?.replayed], [201, true], JSON.stringify(work));
      assert.deepEqual(changedTables(before, await allKaiCounts()), [], "nothing persisted");
      results.B11_global_revocation = "PASS: PUT global-roles revoke 200 + audit; fresh capability false; read 403 + decision 403 (role_not_allowed); review-work replay 201 (organization role), no write; an already-open form retained stale capability";
    });

    await test("B12: the superuser removes the gk_reviewer organization role; every review route refuses the recipient and nothing persists", async () => {
      const tablesBefore = await allKaiCounts();
      const mark = adminPage.mark();
      await adminPage.clickAccessRowButton(USERS.recipient, "Remove gk_reviewer here");
      await adminPage.waitFor(async () => /inactive/.test(await adminPage.accessRowText(USERS.recipient) || ""), "the inactive organization role");
      await adminPage.idle();
      // Targeted revocation of this one assignment (owner decision B/E C06).
      assert.deepEqual(writes(adminPage.requestsSince(mark)), [["POST", `${membershipPath(ORG_A, USERS.recipient)}/roles/gk_reviewer/revoke`, 200]]);
      assert.deepEqual(await storedMemberships(USERS.recipient), [{ organization_id: ORG_A, role_name: "gk_reviewer", membership_status: "inactive" }]);
      assert.deepEqual(changedTables(tablesBefore, await allKaiCounts()), ["audit_events"]);
      const changes = await auditFor("organization_role_revoked", kaiUserIds.superuser);
      const removal = changes.find((row) => row.metadata.target_user_id === recipientKaiUserId);
      assert.deepEqual([removal.metadata.previous_membership_status, removal.metadata.resulting_membership_status], ["active", "inactive"]);
      assert.equal(await adminPage.visibleButton("Remove gk_reviewer here"), false);

      const pendingQueue = await queueRow(profiles.afterRevoke);
      const after = await session(USERS.recipient);
      await after.goto("/impact-library");
      await after.idle();
      assert.deepEqual((await after.fetchJson("GET", "/api/kai/sprint2/intake/admin/organizations")).data.items, [], "the organization is gone from the recipient's Impact Library");
      const before = await allKaiCounts();
      const outcomes = {
        accessCapabilities: await after.fetchJson("GET", accessCapabilitiesPath(ORG_A)),
        read: await after.fetchJson("GET", profilePath(profiles.afterRevoke)),
        reviewWork: await after.fetchJson("POST", reviewWorkPath(profiles.afterRevoke), {}),
        decision: await after.fetchJson("POST", decisionPath(profiles.afterRevoke), {
          expected_updated_at: new Date(pendingQueue.updated_at).toISOString(), review_queue_item_id: pendingQueue.review_queue_item_id, decision: "needs_more_information",
        }),
      };
      for (const [label, response] of Object.entries(outcomes)) {
        assert.deepEqual([response.status, response.blockingReason], [403, "missing_active_organization_membership"], `${label}: ${JSON.stringify(response)}`);
      }
      assert.equal((await after.fetchJson("GET", capabilitiesPath(ORG_A))).data.can_manage_sensitivity_review, false);
      assert.deepEqual(changedTables(before, await allKaiCounts()), [], "nothing persisted");
      results.B12_organization_removal = "PASS: PUT membership gk_reviewer/inactive 200 + audit; organization unlisted; access-capabilities, read, review-work, decision 403 (VAL-AUT-003); nothing persisted";
    });

    // =====================================================================
    // C. NPO reviewer provisioning and client follow-up review
    // =====================================================================
    const npoAdminCPage = await session(USERS.npoAdminC);
    let completedFollowupId = null;

    await test("C1-C3: the NPO administrator makes a member client_reviewer in Team & Access", async () => {
      const memberBefore = await session(USERS.memberC);
      await memberBefore.goto("/impact-library");
      await memberBefore.waitForText("Knowledge Studio");
      assert.equal((await memberBefore.fetchJson("GET", accessCapabilitiesPath(ORG_C))).data.clientFollowupReview, false);
      assert.equal((await memberBefore.fetchJson("GET", followupsPath(ORG_C))).status, 403);

      await npoAdminCPage.goto("/impact-library");
      await npoAdminCPage.waitForText("Team & Access");
      await npoAdminCPage.clickNav("Team & Access");
      await npoAdminCPage.waitFor(async () => Boolean(await npoAdminCPage.memberRowText(USERS.memberC)), "the member's Team & Access row");
      await npoAdminCPage.idle();
      const tablesBefore = await allKaiCounts();
      await npoAdminCPage.setMemberRole(USERS.memberC, "client_reviewer");
      const mark = npoAdminCPage.mark();
      await npoAdminCPage.clickMemberButton(USERS.memberC, "Save role");
      await npoAdminCPage.idle();
      assert.deepEqual(writes(npoAdminCPage.requestsSince(mark)), [["PUT", membershipPath(ORG_C, USERS.memberC), 200]]);
      assert.deepEqual(await storedMemberships(USERS.memberC), [{ organization_id: ORG_C, role_name: "client_reviewer", membership_status: "active" }]);
      // The stored row is updated in place; only the audit is inserted.
      assert.deepEqual(changedTables(tablesBefore, await allKaiCounts()), ["audit_events"]);
      // An explicit replacement of the member's named assignment (B/E C05).
      const [audit] = await auditFor("organization_role_replaced", kaiUserIds.npoAdminC);
      assert.deepEqual([audit.organization_id, audit.metadata.previous_role_name, audit.metadata.resulting_role_name], [ORG_C, "client_contributor", "client_reviewer"]);
      assert.deepEqual(npoAdminCPage.exceptions, []);
      results.C1_C3_provisioning = "PASS: Team & Access PUT membership client_reviewer 200 + audit organization_role_replaced";
    });

    await test("C4-C8: in a new session the member opens the follow-ups from Knowledge Studio and completes one through the existing route, with audit", async () => {
      const memberPage = await session(USERS.memberC);
      await memberPage.goto("/impact-library");
      await memberPage.waitForText("Knowledge Studio");
      const access = await memberPage.fetchJson("GET", accessCapabilitiesPath(ORG_C));
      assert.deepEqual([access.data.clientFollowupReview, access.data.internalKnowledgeWorkspace, access.data.organizationAccessManagement], [true, false, false]);
      await openKnowledgeStudio(memberPage);
      await memberPage.selectProject(PROJECT_C);
      await memberPage.idle();
      await memberPage.clickTab("Reviews");
      await memberPage.waitFor(async () => Boolean(await memberPage.linkHref("Answer follow-up questions")), "the follow-up entry");
      const href = await memberPage.linkHref("Answer follow-up questions");
      console.log(`[reviewer-provisioning] follow-up link: ${href}`);
      assert.equal(href, `/kai/client-followups?organizationId=${ORG_C}`, "the link opens this organization's follow-ups");
      await memberPage.clickLink("Answer follow-up questions");
      await memberPage.waitForText("Client Follow-ups");
      await memberPage.idle();
      const prefilled = await memberPage.evaluate(`document.querySelector("#kai-client-followup-review-root input")?.value ?? null`);
      assert.equal(prefilled, ORG_C);
      await memberPage.clickButton("Load follow-ups");
      await memberPage.waitFor(() => memberPage.visibleButton("Mark reviewed"), "an open follow-up");
      await memberPage.idle();
      const open = (await followupQueue()).filter((row) => row.queue_status !== "resolved");
      const tablesBefore = await allKaiCounts();
      const mark = memberPage.mark();
      await memberPage.clickButton("Mark reviewed");
      await memberPage.idle();
      const completions = writes(memberPage.requestsSince(mark));
      assert.equal(completions.length, 1);
      assert.equal(completions[0][0], "POST");
      assert.equal(completions[0][2], 200);
      completedFollowupId = completions[0][1].split("/client-followups/")[1].replace("/complete", "");
      assert.ok(open.some((row) => row.client_followup_item_id === completedFollowupId));
      const completedRow = (await followupQueue()).find((row) => row.client_followup_item_id === completedFollowupId);
      assert.deepEqual([completedRow.queue_status, completedRow.review_status], ["resolved", "resolved"]);
      // The queue item is updated in place; the two audits are inserted.
      assert.deepEqual(changedTables(tablesBefore, await allKaiCounts()), ["audit_events", "upload_lifecycle_audit"]);
      const followupAudits = await auditFor(FOLLOWUP_AUDIT_OPERATION, kaiUserIds.memberC);
      assert.equal(followupAudits.length, 1);
      assert.equal(followupAudits[0].organization_id, ORG_C);
      console.log(`[reviewer-provisioning] follow-up completion audit metadata: ${JSON.stringify(followupAudits[0].metadata)}`);
      const [lifecycle] = await query(
        "SELECT metadata FROM kai.upload_lifecycle_audit WHERE organization_id = $1::uuid AND operation = $2 AND metadata->>'client_followup_item_id' = $3",
        [ORG_C, FOLLOWUP_AUDIT_OPERATION, completedFollowupId]);
      assert.equal(lifecycle.metadata.decided_by_role, "client_reviewer");
      assert.deepEqual(memberPage.exceptions, []);
      results.C4_C8_review = `PASS: follow-up ${completedFollowupId} resolved/resolved by client_reviewer, audit ${FOLLOWUP_AUDIT_OPERATION} + lifecycle audit`;
    });

    await test("C9-C10: the NPO administrator changes the member back; the member's next follow-up action is refused", async () => {
      await npoAdminCPage.goto("/impact-library");
      await npoAdminCPage.waitForText("Team & Access");
      await npoAdminCPage.clickNav("Team & Access");
      await npoAdminCPage.waitFor(async () => Boolean(await npoAdminCPage.memberRowText(USERS.memberC)), "the member's row");
      await npoAdminCPage.idle();
      await npoAdminCPage.setMemberRole(USERS.memberC, "client_contributor");
      const mark = npoAdminCPage.mark();
      await npoAdminCPage.clickMemberButton(USERS.memberC, "Save role");
      await npoAdminCPage.idle();
      assert.deepEqual(writes(npoAdminCPage.requestsSince(mark)), [["PUT", membershipPath(ORG_C, USERS.memberC), 200]]);
      assert.deepEqual(await storedMemberships(USERS.memberC), [{ organization_id: ORG_C, role_name: "client_contributor", membership_status: "active" }]);

      const memberPage = await session(USERS.memberC);
      await memberPage.goto("/impact-library");
      await memberPage.waitForText("Knowledge Studio");
      assert.equal((await memberPage.fetchJson("GET", accessCapabilitiesPath(ORG_C))).data.clientFollowupReview, false);
      await openKnowledgeStudio(memberPage);
      await memberPage.selectProject(PROJECT_C);
      await memberPage.idle();
      await memberPage.clickTab("Reviews");
      await memberPage.idle();
      assert.equal(await memberPage.linkHref("Answer follow-up questions"), null, "no follow-up entry");
      const remaining = (await followupQueue()).find((row) => row.queue_status !== "resolved");
      const before = await allKaiCounts();
      const list = await memberPage.fetchJson("GET", followupsPath(ORG_C));
      const complete = await memberPage.fetchJson("POST", completePath(remaining.client_followup_item_id), {
        expected_updated_at: new Date(remaining.updated_at).toISOString(),
      });
      assert.deepEqual([list.status, list.errorCode], [403, "authorization_denied"]);
      assert.deepEqual([complete.status, complete.errorCode], [403, "authorization_denied"], JSON.stringify(complete));
      assert.deepEqual(changedTables(before, await allKaiCounts()), [], "nothing persisted");
      assert.equal((await followupQueue()).find((row) => row.client_followup_item_id === remaining.client_followup_item_id).queue_status, remaining.queue_status);
      results.C9_C10_revocation = "PASS: Team & Access PUT client_contributor 200; capability false; list and completion 403; nothing persisted";
    });

    // =====================================================================
    // D. Negative authorization
    // =====================================================================
    await test("D: administrators, reviewers, and contributors cannot exceed their role, by UI or direct route, and nothing partially persists", async () => {
      const pendingQueue = (await queueRow(profiles.afterRevoke)) || await openReviewWork(ORG_A, profiles.afterRevoke);
      const decisionBody = {
        expected_updated_at: new Date(pendingQueue.updated_at).toISOString(), review_queue_item_id: pendingQueue.review_queue_item_id, decision: "needs_more_information",
      };
      const snapshot = await roleAndMembershipSnapshot();
      const before = await allKaiCounts();
      const outcomes = {};

      // NPO client_admin: no GK global role, no gk_reviewer membership, no GK review.
      const npo = await session(USERS.npoAdminA);
      await npo.goto("/impact-library");
      await npo.waitForText("Team & Access");
      outcomes.npoGlobalRole = await npo.fetchJson("PUT", globalRolePath(USERS.contributorA), { role_name: "gk_reviewer", action: "assign" });
      outcomes.npoGkMembership = await npo.fetchJson("PUT", membershipPath(ORG_A, USERS.contributorA), { role_name: "gk_reviewer", membership_status: "active" });
      outcomes.npoRewriteGkStaff = await npo.fetchJson("PUT", membershipPath(ORG_A, USERS.recipient), { role_name: "client_contributor", membership_status: "active" });
      outcomes.npoLookup = await npo.fetchJson("GET", "/api/admin/users/lookup?email=" + encodeURIComponent(email(USERS.recipient)));
      outcomes.npoCockpit = await npo.fetchJson("GET", capabilitiesPath(ORG_A));
      outcomes.npoDecision = await npo.fetchJson("POST", decisionPath(profiles.afterRevoke), decisionBody);
      assert.deepEqual([outcomes.npoGlobalRole.status, outcomes.npoGlobalRole.blockingReason], [403, "platform_superuser_required"]);
      assert.deepEqual([outcomes.npoGkMembership.status, outcomes.npoGkMembership.errorCode, outcomes.npoGkMembership.blockingReason], [403, "authorization_denied", "non_client_membership_not_client_managed"]);
      assert.deepEqual([outcomes.npoRewriteGkStaff.status, outcomes.npoRewriteGkStaff.blockingReason], [403, "non_client_membership_not_client_managed"]);
      assert.equal(outcomes.npoLookup.status, 403);
      assert.equal(outcomes.npoCockpit.data.can_manage_sensitivity_review, false);
      assert.deepEqual([outcomes.npoDecision.status, outcomes.npoDecision.errorCode], [403, "authorization_denied"]);
      // Team & Access shows the Get Kinder reviewer's membership without a control and offers no GK role.
      await npo.clickNav("Team & Access");
      await npo.waitFor(async () => Boolean(await npo.memberRowText(USERS.recipient)), "the GK reviewer's Team & Access row");
      assert.equal(await npo.memberHasRoleSelect(USERS.recipient), false, "a Get Kinder staff membership is not editable by the organization");
      const npoRoleOptions = await npo.evaluate(`[...document.querySelectorAll("[data-team-access-member] select option")].map((o) => o.value)`);
      assert.ok(npoRoleOptions.length > 0 && npoRoleOptions.every((value) => value.startsWith("client_")), JSON.stringify(npoRoleOptions));

      // client_reviewer: no GK sensitivity review.
      const reviewer = await session(USERS.clientReviewerA);
      await reviewer.goto("/impact-library");
      await reviewer.waitForText("Knowledge Studio");
      outcomes.clientReviewerCockpit = await reviewer.fetchJson("GET", capabilitiesPath(ORG_A));
      outcomes.clientReviewerDecision = await reviewer.fetchJson("POST", decisionPath(profiles.afterRevoke), decisionBody);
      outcomes.clientReviewerWork = await reviewer.fetchJson("POST", reviewWorkPath(profiles.afterRevoke), {});
      assert.equal(outcomes.clientReviewerCockpit.data.can_manage_sensitivity_review, false);
      assert.deepEqual([outcomes.clientReviewerDecision.status, outcomes.clientReviewerWork.status], [403, 403]);

      // A non-superuser global gk_admin with an organization gk_admin
      // membership is a delegated GK administrator (owner decision B/E): it
      // manages only Org A's gk_operator/gk_reviewer assignments. It cannot
      // grant a global role, rewrite a client membership into a GK role, or
      // grant organization gk_admin.
      const gkAdmin = await session(USERS.gkAdminNotSuperuser);
      await gkAdmin.goto("/impact-library");
      await gkAdmin.idle();
      outcomes.gkAdminGlobalRole = await gkAdmin.fetchJson("PUT", globalRolePath(USERS.contributorA), { role_name: "gk_reviewer", action: "assign" });
      outcomes.gkAdminMembership = await gkAdmin.fetchJson("PUT", membershipPath(ORG_A, USERS.contributorA), { role_name: "gk_reviewer", membership_status: "active" });
      outcomes.gkAdminOrganizationAdmin = await gkAdmin.fetchJson("POST", `${membershipPath(ORG_A, USERS.contributorA)}/roles`, { role_name: "gk_admin" });
      outcomes.gkAdminLookup = await gkAdmin.fetchJson("GET", "/api/admin/users/lookup?email=" + encodeURIComponent(email(USERS.contributorA)));
      assert.deepEqual([outcomes.gkAdminGlobalRole.status, outcomes.gkAdminGlobalRole.blockingReason], [403, "platform_superuser_required"]);
      assert.deepEqual([outcomes.gkAdminMembership.status, outcomes.gkAdminMembership.blockingReason], [403, "organization_role_not_administrable"]);
      assert.deepEqual([outcomes.gkAdminOrganizationAdmin.status, outcomes.gkAdminOrganizationAdmin.blockingReason], [403, "organization_role_not_administrable"]);
      assert.equal(outcomes.gkAdminLookup.status, 403);

      // A contributor administers nothing.
      const contributor = await session(USERS.contributorA);
      await contributor.goto("/impact-library");
      await contributor.waitForText("Knowledge Studio");
      outcomes.contributorRoster = await contributor.fetchJson("GET", `${ACCESS}/organizations/${ORG_A}/access`);
      outcomes.contributorMembership = await contributor.fetchJson("PUT", membershipPath(ORG_A, USERS.clientReviewerA), { role_name: "client_admin", membership_status: "active" });
      outcomes.contributorGlobalRole = await contributor.fetchJson("PUT", globalRolePath(USERS.contributorA), { role_name: "gk_reviewer", action: "assign" });
      assert.deepEqual([outcomes.contributorRoster.status, outcomes.contributorMembership.status, outcomes.contributorGlobalRole.status], [403, 403, 403]);
      const contributorNav = await contributor.evaluate(`[...document.querySelectorAll(".gk-shell-nav-group .gk-shell-nav-item")].map((el) => el.innerText.trim())`);
      assert.ok(!contributorNav.includes("Team & Access"));

      // Nothing any refused request attempted was written.
      const changed = changedTables(before, await allKaiCounts());
      assert.deepEqual(changed, [], `refused requests wrote nothing: ${JSON.stringify(changed)}`);
      const afterSnapshot = await roleAndMembershipSnapshot();
      assert.deepEqual(afterSnapshot.memberships, snapshot.memberships, "no membership changed");
      assert.deepEqual(afterSnapshot.roles, snapshot.roles, "no global role changed");
      console.log(`[reviewer-provisioning] negative outcomes: ${JSON.stringify(Object.fromEntries(Object.entries(outcomes).map(([k, v]) => [k, [v.status, v.errorCode, v.blockingReason]])))}`);
      results.D_negative = "PASS";
    });

    console.log(`[reviewer-provisioning] results ${JSON.stringify(results, null, 2)}`);
  } finally {
    for (const page of pages) await page.close().catch(() => {});
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await seedPool.end();
    const { default: ambientPool } = await import("../Backend/db/pg.js");
    await ambientPool.end().catch(() => {});
  }
}
