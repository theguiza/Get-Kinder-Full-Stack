import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Reviewer authorization edge cases, run only by
 *   node scripts/kai-client-knowledge-studio-browser-acceptance-local-postgres.js \
 *     __tests__/kai-reviewer-authorization-edge-cases-browser-acceptance.integration.spec.js
 * against that runner's ephemeral loopback PostgreSQL. Skipped otherwise.
 *
 * E. One Get Kinder reviewer, provisioned through the governed
 *    administration routes, attempts a fresh write on a separate eligible
 *    object for each authorization predicate the GK review services use:
 *    with both halves, after the global gk_reviewer role is revoked (the
 *    organization role unchanged), and after the organization role is
 *    removed. Each answer is compared with the operation's own policy:
 *    - global role + any active membership (globalRolesOnly): the P1-09
 *      review cockpit reads and the sensitivity decision;
 *    - organization role or global role, with an active membership
 *      (combineGlobalRoles): P1-06 review work, P2-12 evidence review,
 *      P2-09 claim review;
 *    - organization role only: P2-10 coverage acceptance, the claim and
 *      evidence libraries, the GK Knowledge Studio mount.
 * G. The organization's Knowledge Studio shows the reviewer's decision on
 *    exactly the file that was reviewed, and the separate source review
 *    that follows it; an unreviewed file still waits.
 * F. A Get Kinder account that has never used KAI is made a Get Kinder
 *    reviewer from /admin KAI Access, then signs in for the first time and
 *    completes a sensitivity review. kai.users.email carries the
 *    USER_CONFIRMED production contract (NOT NULL, no default; the same
 *    mirror as the organization-onboarding bootstrap), applied after the
 *    fixture accounts exist. The last case drops it again (the runner's own
 *    shared mirror) for a second never-signed-in account.
 *
 * Real: every KAI router/service/read model and the /api/admin router on the
 * runner cluster, resolveKaiActorContext with real memberships, global roles
 * and superuser authority, the built bundle, and a real headless Chrome with
 * one isolated browser context (harness cookie) per session.
 * Simulated: the Get Kinder session login (req.user from a harness cookie);
 * the P1-03..P1-05 rows of each synthetic file (the P1 worker's output); the
 * evidence -> claim chain behind the P2 objects (the real services called
 * directly by a fixture GK reviewer context); and, as preconditions only,
 * the superuser's own global gk_admin role and the NPO administrator's
 * membership. No role or membership under test is seeded.
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

test("reviewer authorization edge-case acceptance isolation: a non-loopback runner URL is refused", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
});

if (!RUNNER_DATABASE_URL || !CHROME || !WORKDIR) {
  test("reviewer authorization edge-case acceptance requires its runner", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_DATABASE_URL);
  await runBrowserAcceptance();
}


// ---------------------------------------------------------------------------
// Minimal Chrome DevTools protocol client (Node's built-in WebSocket), the
// same shape as the other Knowledge Studio acceptance specs.
// ---------------------------------------------------------------------------

async function launchChrome() {
  const profileDir = join(WORKDIR, "chrome-profile-reviewer-authorization-edge-cases");
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
  const { extractEvidenceFromSourceVersion } = await import("../Backend/kai/services/kaiEvidenceLineageService.js");
  const { proposeClaim } = await import("../Backend/kai/services/kaiClaimProposalService.js");
  const { generateClaimGapFollowups } = await import("../Backend/kai/services/kaiClaimGapFollowupService.js");
  const { recordEvidenceReviewDecision, recordClaimReviewDecision } = await import("../Backend/kai/services/kaiHumanReviewService.js");
  const { getClaimTraceabilitySummary } = await import("../Backend/kai/services/kaiClaimTraceabilityService.js");
  const { buildSensitivityDecisionRequestBody, defaultSensitivityReviewFormState } = await import("../frontend/impactEvidenceLibraryLogic.js");
  const sprint2IntakeApiRouter = (await import("../Backend/kai/routes/sprint2IntakeApi.js")).default;
  const kaiAccessAdministrationApiRouter = (await import("../Backend/kai/routes/kaiAccessAdministrationApi.js")).default;
  const adminApiRouter = (await import("../routes/adminApi.js")).default;
  const { requireKaiSprint2Enabled } = await import("../Backend/kai/config/kaiSprint2Config.js");
  const { requireKaiSprint2Authenticated } = await import("../Backend/kai/middleware/kaiSprint2Authentication.js");
  const query = async (sql, params = []) => (await seedPool.query(sql, params)).rows;
  const ENV = { KAI_SPRINT2_ENABLED: "true" };
  const NOW = new Date().toISOString();
  const noAudit = () => ({ prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } });

  // The runner's smoke-seeded evidence organization (a promoted source
  // version to extract evidence from), bound to a Get Kinder organization
  // so it appears in /admin -> Organizations, and a second organization for
  // the cross-tenant check.
  const ORG = "00000000-0000-4000-8000-000000000001";
  const OTHER_ORG = "00000000-0000-4000-8000-00000000e2b2";
  const ORG_NAME = "Harbourline Synthetic Society";
  const PROJECT = "7e000000-0000-4000-8000-00000000e1a1";
  const OTHER_PROJECT = "7e000000-0000-4000-8000-00000000e2b2";
  const BATCH = "12000000-0000-4000-8000-00000000e1a1";
  const OTHER_BATCH = "12000000-0000-4000-8000-00000000e2b2";
  // One synthetic file per sensitivity-review case, so no case reuses an
  // object another case already wrote.
  const FILES = Object.freeze({
    withBoth: "22000000-0000-4000-8000-00000000e101",
    afterGlobalRevoke: "22000000-0000-4000-8000-00000000e102",
    afterMembershipRemoval: "22000000-0000-4000-8000-00000000e103",
    firstSignIn: "22000000-0000-4000-8000-00000000e104",
    unrelated: "22000000-0000-4000-8000-00000000e105",
    otherOrg: "22000000-0000-4000-8000-00000000e106",
  });
  const NAMES = Object.freeze({
    withBoth: "synthetic_meal_programme_2025_26.csv",
    afterGlobalRevoke: "synthetic_shelter_nights_2025_26.csv",
    afterMembershipRemoval: "synthetic_youth_drop_in_2025_26.csv",
    firstSignIn: "synthetic_tenant_support_2025_26.csv",
    unrelated: "synthetic_tool_library_2025_26.csv",
    otherOrg: "synthetic_other_org_programme_2025_26.csv",
  });
  const FIELD_KEYS = ["households_served", "programme_month"];
  const USERS = Object.freeze({
    superuser: 1201, // site admin; global gk_admin (baseline precondition)
    reviewer: 1202, // existing Get Kinder user already mapped to KAI, no KAI role; made a GK reviewer in E
    firstTime: 1203, // existing Get Kinder user who has never used KAI; made a GK reviewer in F
    npoAdmin: 1204, // stored client_admin of ORG
    firstTimeSharedMirror: 1205, // never used KAI; provisioned under the runner's shared kai.users mirror in F4
  });
  const SITE_ADMINS = new Set([USERS.superuser]);
  const email = (legacyId) => `user${legacyId}@harbourline.test`;

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
  await query(`INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES ($1::uuid, $2, 'harbourline-synthetic')
               ON CONFLICT (organization_id) DO NOTHING`, [ORG, ORG_NAME]);
  await query("INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES ($1::uuid, 'Other Synthetic Society', 'other-synthetic-society')", [OTHER_ORG]);
  const [gkOrganization] = await query("INSERT INTO public.organizations (name, status) VALUES ($1, 'approved') RETURNING id", [ORG_NAME]);
  await query("INSERT INTO kai.gk_organization_bindings (gk_organization_id, kai_organization_id, status) VALUES ($1, $2::uuid, 'active')", [gkOrganization.id, ORG]);
  for (const [engagementId, organizationId, code] of [[PROJECT, ORG, "Project Harbourline Reviews"], [OTHER_PROJECT, OTHER_ORG, "Project Other Society"]]) {
    await query("INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code, project_metadata) VALUES ($1::uuid, $2::uuid, $3, '{}'::jsonb)",
      [engagementId, organizationId, code]);
  }
  for (const [batchId, organizationId, engagementId, code] of [[BATCH, ORG, PROJECT, "harbourline-reviews-2026"], [OTHER_BATCH, OTHER_ORG, OTHER_PROJECT, "other-society-2026"]]) {
    await query(`INSERT INTO kai.intake_batches (intake_batch_id, organization_id, engagement_id, batch_code, processing_status, review_status)
                 VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'received', 'not_reviewed')`, [batchId, organizationId, engagementId, code]);
  }

  // --- users ----------------------------------------------------------------
  // Every user is an existing Get Kinder account (public.userdata) with an
  // email. Only the fixture actors are mapped to KAI now (with that email);
  // the two first-time accounts are not.
  for (const legacyId of Object.values(USERS)) {
    await query("INSERT INTO public.userdata (id, email, firstname, lastname) VALUES ($1, $2, 'Synthetic', $3) ON CONFLICT (id) DO NOTHING",
      [legacyId, email(legacyId), `User ${legacyId}`]);
  }
  const kaiUserIds = {};
  for (const key of ["superuser", "reviewer", "npoAdmin"]) {
    kaiUserIds[key] = (await findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: USERS[key], email: email(USERS[key]) })).user_id;
  }
  await query("INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status) VALUES ($1::uuid, $2::uuid, 'client_admin', 'active')",
    [ORG, kaiUserIds.npoAdmin]);
  await query("INSERT INTO kai.user_roles (user_id, role_id) SELECT $1::uuid, role_id FROM kai.roles WHERE role_name = 'gk_admin'", [kaiUserIds.superuser]);

  // USER_CONFIRMED production kai.users.email contract (ExecPlan, 2026-09-24):
  // NOT NULL, no default. Applied here, after the fixture accounts exist.
  const [unmappedBefore] = await query("SELECT count(*)::int AS count FROM kai.users WHERE email IS NULL");
  assert.equal(unmappedBefore.count, 0, "no kai.users row without an email before the production mirror is applied");
  await query("ALTER TABLE kai.users ALTER COLUMN email SET NOT NULL");

  /** P1-03..P1-05 rows of one fresh confirmed Project file (the P1 worker's output). */
  async function seedFreshFile({ organizationId, batchId, engagementId, intakeFileId, name, checksumSuffix }) {
    const checksum = `${"ed".repeat(31)}${checksumSuffix}`;
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
  const profiles = {};
  for (const [key, checksumSuffix] of [["withBoth", "01"], ["afterGlobalRevoke", "02"], ["afterMembershipRemoval", "03"], ["firstSignIn", "04"], ["unrelated", "05"]]) {
    profiles[key] = await seedFreshFile({ organizationId: ORG, batchId: BATCH, engagementId: PROJECT, intakeFileId: FILES[key], name: NAMES[key], checksumSuffix });
  }
  profiles.otherOrg = await seedFreshFile({ organizationId: OTHER_ORG, batchId: OTHER_BATCH, engagementId: OTHER_PROJECT, intakeFileId: FILES.otherOrg, name: NAMES.otherOrg, checksumSuffix: "06" });

  // --- P2 objects: evidence items and claims (the real services, called by a
  // fixture GK reviewer context, as in the client Knowledge Studio spec) ----
  const gkReviewerService = {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-0000000e9001",
    source: "public.userdata",
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" }],
  };
  for (let n = 3; n <= 10; n += 1) {
    await query(
      `INSERT INTO kai.data_dictionary_fields (data_dictionary_field_id, data_dictionary_id, organization_id, file_profile_id,
         profile_field_key, field_label_safe, data_type, created_at)
       VALUES ($1::uuid, '60000000-0000-4000-8000-000000000001', $2::uuid, '50000000-0000-4000-8000-000000000001', $3, $3, 'number', now())
       ON CONFLICT DO NOTHING`,
      [`70000000-0000-4000-8000-0000000e00${String(n).padStart(2, "0")}`, ORG, `field_${n}`],
    );
  }
  const [sourceVersion] = await query(
    "SELECT source_version_id FROM kai.source_versions WHERE organization_id = $1::uuid AND is_current = true ORDER BY source_version_id LIMIT 1", [ORG]);
  const extracted = await extractEvidenceFromSourceVersion(
    { organizationId: ORG, sourceVersionId: sourceVersion.source_version_id, actorContext: gkReviewerService, now: NOW },
    { env: ENV, metadataOnlyAudit: noAudit() },
  );
  assert.equal(extracted.ok, true, JSON.stringify(extracted));
  const evidenceIds = (await query(
    "SELECT evidence_item_id::text FROM kai.evidence_items WHERE organization_id = $1::uuid ORDER BY evidence_item_id", [ORG])).map((r) => r.evidence_item_id);
  assert.ok(evidenceIds.length >= 7, `at least seven evidence items (got ${evidenceIds.length})`);
  // P2-12 objects: evidence with no claim and an open evidence_review item.
  const EVIDENCE = { withBoth: evidenceIds[0], afterGlobalRevoke: evidenceIds[1], afterMembershipRemoval: evidenceIds[2] };
  async function evidenceQueue(evidenceItemId) {
    const [row] = await query(
      `SELECT review_queue_item_id::text, queue_status, review_status, updated_at FROM kai.review_queue_items WHERE organization_id = $1::uuid
         AND queue_type = 'evidence_review' AND target_object_type = 'evidence_item' AND target_object_id = $2::uuid`, [ORG, evidenceItemId]);
    return row;
  }
  async function claimQueue(claimId) {
    const [row] = await query(
      `SELECT review_queue_item_id::text, queue_status, review_status, updated_at FROM kai.review_queue_items WHERE organization_id = $1::uuid
         AND queue_type = 'claim_review' AND target_object_type = 'claim' AND target_object_id = $2::uuid`, [ORG, claimId]);
    return row;
  }
  // A proposed claim whose evidence review is complete: its claim review is
  // the open object.
  async function claimAwaitingClaimReview(evidenceItemId) {
    const proposed = await proposeClaim({ organizationId: ORG, evidenceItemId, actorContext: gkReviewerService, now: NOW },
      { env: ENV, metadataOnlyAudit: noAudit() });
    assert.equal(proposed.ok, true, JSON.stringify(proposed));
    const claimId = proposed.data.claim.claim_id;
    const queue = await evidenceQueue(evidenceItemId);
    const reviewed = await recordEvidenceReviewDecision({
      organizationId: ORG, evidenceItemId, reviewQueueItemId: queue.review_queue_item_id,
      expectedUpdatedAt: new Date(queue.updated_at).toISOString(), decision: "supported", actorContext: gkReviewerService, now: NOW,
    }, { env: ENV, metadataOnlyAudit: noAudit() });
    assert.equal(reviewed.ok, true, JSON.stringify(reviewed));
    return claimId;
  }
  // P2-09 objects: one open claim review per case.
  const CLAIMS = {
    withBoth: await claimAwaitingClaimReview(evidenceIds[3]),
    afterGlobalRevoke: await claimAwaitingClaimReview(evidenceIds[4]),
    afterMembershipRemoval: await claimAwaitingClaimReview(evidenceIds[5]),
  };
  // P2-10 object: one fully human-reviewed claim with unresolved internal
  // coverage dimensions; each case accepts a different dimension.
  const coverageClaimId = await claimAwaitingClaimReview(evidenceIds[6]);
  assert.equal((await generateClaimGapFollowups({ organizationId: ORG, claimId: coverageClaimId, actorContext: gkReviewerService, now: NOW },
    { env: ENV, metadataOnlyAudit: noAudit() })).ok, true);
  {
    const [lineage] = await query(
      `SELECT sv.intake_sensitivity_profile_id FROM kai.evidence_items e JOIN kai.source_versions sv
         ON sv.organization_id = e.organization_id AND sv.source_version_id = e.source_version_id
        WHERE e.organization_id = $1::uuid AND e.evidence_item_id = $2::uuid`, [ORG, evidenceIds[6]]);
    let [sensitivityQueue] = await query(
      `SELECT review_queue_item_id FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'sensitivity_review'
         AND target_object_type = 'intake_sensitivity_profile' AND target_object_id = $2::uuid`, [ORG, lineage.intake_sensitivity_profile_id]);
    if (!sensitivityQueue) {
      [sensitivityQueue] = await query(
        `INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, priority, queue_status, review_status,
           summary, required_action, queue_metadata, created_by_type)
         VALUES ($1::uuid, 'sensitivity_review', 'intake_sensitivity_profile', $2::uuid, 'medium', 'open', 'needs_gk_review',
           'Review sensitivity and allowed-use metadata.', 'Review sensitivity and allowed-use metadata before governed use.', '{}'::jsonb, 'human')
         RETURNING review_queue_item_id`, [ORG, lineage.intake_sensitivity_profile_id]);
    }
    const [head] = await query(
      `SELECT d.decision_id FROM kai.intake_sensitivity_review_decisions d WHERE d.organization_id = $1::uuid AND d.intake_sensitivity_profile_id = $2::uuid
         AND NOT EXISTS (SELECT 1 FROM kai.intake_sensitivity_review_decisions s WHERE s.supersedes_decision_id = d.decision_id)`,
      [ORG, lineage.intake_sensitivity_profile_id]);
    await query(
      `INSERT INTO kai.intake_sensitivity_review_decisions (organization_id, intake_sensitivity_profile_id, review_queue_item_id, decision_outcome,
         reviewed_personal_data_status, reviewed_minor_data_status, reviewed_health_housing_justice_immigration_status, reviewed_indigenous_governance_status,
         reviewed_staff_notes_status, reviewed_story_testimonial_status, reviewed_small_cell_risk_status, reviewed_financial_records_status,
         reviewed_consent_basis_status, reviewed_allowed_use_status, reviewed_llm_processing_allowed, reviewed_product_learning_allowed,
         reviewed_public_use_allowed, reviewed_funder_use_allowed, decided_by, decided_by_role, target_updated_at, supersedes_decision_id, created_by_type, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'reviewed', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown',
         'present', 'allowed', false, false, false, true, $4::uuid, 'gk_reviewer', $5::timestamptz, $6, 'human', now())`,
      [ORG, lineage.intake_sensitivity_profile_id, sensitivityQueue.review_queue_item_id, gkReviewerService.actorUserId, NOW, head?.decision_id ?? null]);
    const queue = await claimQueue(coverageClaimId);
    const approved = await recordClaimReviewDecision({
      organizationId: ORG, claimId: coverageClaimId, reviewQueueItemId: queue.review_queue_item_id,
      expectedUpdatedAt: new Date(queue.updated_at).toISOString(), decision: "approved", approvedAudiences: ["internal"],
      actorContext: gkReviewerService, now: NOW,
    }, { env: ENV, metadataOnlyAudit: noAudit() });
    assert.equal(approved.ok, true, JSON.stringify(approved));
  }
  const traced = await getClaimTraceabilitySummary(
    { organizationId: ORG, claimId: coverageClaimId, requestedAudience: "internal", actorContext: gkReviewerService }, { env: ENV });
  assert.equal(traced.ok, true, JSON.stringify(traced));
  const unresolvedDimensions = Object.entries(traced.data.dimensions).filter(([, v]) => v.assessment_status === "unresolved").map(([k]) => k);
  assert.ok(unresolvedDimensions.length >= 3, `three unresolved internal coverage dimensions (got ${JSON.stringify(unresolvedDimensions)})`);
  const DIMENSIONS = { withBoth: unresolvedDimensions[0], afterGlobalRevoke: unresolvedDimensions[1], afterMembershipRemoval: unresolvedDimensions[2] };

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
  app.use(express.static(publicDir));
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchChrome();

  // A direct request with one actor's harness login, for route checks.
  async function api(legacyId, method, path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { Cookie: `kai_harness_user=${legacyId}`, "Content-Type": "application/json", Accept: "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let parsed = null;
    try { parsed = await response.json(); } catch { parsed = null; }
    return {
      status: response.status,
      errorCode: parsed?.error?.code ?? (typeof parsed?.error === "string" ? parsed.error : null),
      blockingReason: Array.isArray(parsed?.blockers) ? parsed.blockers[0]?.blocking_reason ?? null : null,
      data: parsed?.data ?? null,
    };
  }

  const INTAKE = "/api/kai/sprint2/intake/admin";
  const COCKPIT = `${INTAKE}/review-cockpit`;
  const ACCESS = "/api/kai/sprint2/access-administration";
  const paths = {
    cockpitCapabilities: (organizationId = ORG) => `${COCKPIT}/capabilities?organization_id=${organizationId}`,
    cockpitQueue: () => `${COCKPIT}/queue?organization_id=${ORG}`,
    profile: (profileId, organizationId = ORG) => `${COCKPIT}/sensitivity-profiles/${profileId}?organization_id=${organizationId}`,
    reviewWork: (profileId, organizationId = ORG) => `${COCKPIT}/sensitivity-profiles/${profileId}/review-work?organization_id=${organizationId}`,
    decision: (profileId) => `${COCKPIT}/sensitivity-profiles/${profileId}/decision?organization_id=${ORG}`,
    accessCapabilities: (organizationId = ORG) => `${INTAKE}/organizations/${organizationId}/access-capabilities`,
    claimLibrary: () => `${INTAKE}/organizations/${ORG}/claim-library/candidates`,
    evidenceLibrary: () => `${INTAKE}/organizations/${ORG}/evidence-library/candidates`,
    evidenceReview: (evidenceItemId, queueId) => `${INTAKE}/organizations/${ORG}/evidence-items/${evidenceItemId}/evidence-review/${queueId}/complete`,
    claimReview: (claimId, queueId) => `${INTAKE}/organizations/${ORG}/claims/${claimId}/claim-review/${queueId}/complete`,
    coverage: (dimensionKey) => `${INTAKE}/organizations/${ORG}/claims/${coverageClaimId}/coverage-dimensions/${dimensionKey}/internal-acceptance`,
    pipeline: () => `${INTAKE}/organizations/${ORG}/engagements/${PROJECT}/client-evidence-pipeline`,
    membership: (legacyId) => `${ACCESS}/organizations/${ORG}/memberships/${legacyId}`,
    globalRole: (legacyId) => `${ACCESS}/global-roles/${legacyId}`,
  };
  const pathOf = (r) => new URL(r.url).pathname;
  const writes = (requests) => requests.filter((r) => r.method !== "GET").map((r) => [r.method, pathOf(r), r.status]);

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
  async function auditsBy(actorKaiUserId) {
    return query(
      "SELECT action, organization_id::text, metadata FROM kai.audit_events WHERE actor_user_id = $1::uuid ORDER BY audit_event_id", [actorKaiUserId]);
  }
  async function sensitivityQueueRow(profileId, organizationId = ORG) {
    const [row] = await query(
      `SELECT review_queue_item_id::text, queue_status, review_status, updated_at, created_by::text FROM kai.review_queue_items
        WHERE organization_id = $1::uuid AND queue_type = 'sensitivity_review' AND target_object_id = $2::uuid`, [organizationId, profileId]);
    return row || null;
  }
  async function sensitivityDecisions(profileId) {
    return query(
      `SELECT decision_id::text, decision_outcome, decided_by::text, decided_by_role, review_queue_item_id::text FROM kai.intake_sensitivity_review_decisions
        WHERE organization_id = $1::uuid AND intake_sensitivity_profile_id = $2::uuid ORDER BY created_at`, [ORG, profileId]);
  }
  async function ledgerRows(table, column, id) {
    return query(`SELECT decided_by::text, decided_by_role FROM kai.${table} WHERE organization_id = $1::uuid AND ${column} = $2::uuid`, [ORG, id]);
  }
  async function coverageRows(dimensionKey) {
    return query(
      "SELECT decided_by::text, decided_by_role FROM kai.coverage_review_decisions WHERE organization_id = $1::uuid AND claim_id = $2::uuid AND dimension_key = $3",
      [ORG, coverageClaimId, dimensionKey]);
  }
  async function storedMembership(legacyId) {
    return query(
      `SELECT om.role_name, om.membership_status FROM kai.organization_memberships om JOIN kai.users u ON u.user_id = om.user_id
        WHERE u.legacy_public_userdata_id = $1 AND om.organization_id = $2::uuid`, [legacyId, ORG]);
  }
  async function globalRoleRows(legacyId) {
    return query(
      `SELECT r.role_name, ur.active, ur.revoked_at IS NOT NULL AS revoked FROM kai.user_roles ur
         JOIN kai.roles r ON r.role_id = ur.role_id JOIN kai.users u ON u.user_id = ur.user_id
        WHERE u.legacy_public_userdata_id = $1 AND ur.organization_id IS NULL AND ur.engagement_id IS NULL ORDER BY 1`, [legacyId]);
  }
  async function kaiUserRows(legacyId) {
    return query(
      `SELECT user_id::text, legacy_identity_source, status, email::text FROM kai.users
        WHERE legacy_identity_source = 'public.userdata' AND legacy_public_userdata_id = $1`, [legacyId]);
  }
  const reviewedBody = (queue) => buildSensitivityDecisionRequestBody({
    decision: "reviewed",
    expectedUpdatedAt: new Date(queue.updated_at).toISOString(),
    reviewQueueItemId: queue.review_queue_item_id,
    formState: { ...defaultSensitivityReviewFormState(), reviewed_personal_data_status: "present", reviewed_minor_data_status: "absent" },
  });
  const needsMoreInformation = (queue) => ({ expected_updated_at: new Date(queue.updated_at).toISOString(), decision: "needs_more_information" });

  /**
   * One fresh attempt per operation, each on its own eligible object. Returns
   * every route answer plus the tables each attempt changed.
   */
  async function freshAttempts(legacyId, key, { sensitivityDecision = true } = {}) {
    const outcome = {};
    const step = async (label, run) => {
      const before = await allKaiCounts();
      outcome[label] = await run();
      outcome[label].changed = changedTables(before, await allKaiCounts());
    };
    await step("reviewWork", () => api(legacyId, "POST", paths.reviewWork(profiles[key]), {}));
    const queue = await sensitivityQueueRow(profiles[key]);
    if (sensitivityDecision && queue) {
      await step("sensitivityDecision", () => api(legacyId, "POST", paths.decision(profiles[key]), reviewedBody(queue)));
    }
    const evidenceQueueRow = await evidenceQueue(EVIDENCE[key]);
    await step("evidenceReview", () => api(legacyId, "POST", paths.evidenceReview(EVIDENCE[key], evidenceQueueRow.review_queue_item_id),
      needsMoreInformation(evidenceQueueRow)));
    const claimQueueRow = await claimQueue(CLAIMS[key]);
    await step("claimReview", () => api(legacyId, "POST", paths.claimReview(CLAIMS[key], claimQueueRow.review_queue_item_id),
      needsMoreInformation(claimQueueRow)));
    await step("coverageAcceptance", () => api(legacyId, "POST", paths.coverage(DIMENSIONS[key]), {}));
    for (const [label, path] of [
      ["cockpitCapabilities", paths.cockpitCapabilities()],
      ["cockpitQueue", paths.cockpitQueue()],
      ["profileRead", paths.profile(profiles[key])],
      ["accessCapabilities", paths.accessCapabilities()],
      ["claimLibrary", paths.claimLibrary()],
      ["evidenceLibrary", paths.evidenceLibrary()],
    ]) {
      await step(label, () => api(legacyId, "GET", path));
    }
    return outcome;
  }
  // The tables a fresh, accepted write changes (no other table).
  const FRESH_WRITE_TABLES = Object.freeze({
    reviewWork: ["audit_events", "review_queue_items", "upload_lifecycle_audit"],
    sensitivityDecision: ["audit_events", "intake_sensitivity_review_decisions", "intake_source_candidates", "review_queue_items", "upload_lifecycle_audit"],
    evidenceReview: ["audit_events", "evidence_review_decisions", "upload_lifecycle_audit"],
    claimReview: ["audit_events", "claim_review_decisions", "upload_lifecycle_audit"],
    coverageAcceptance: ["audit_events", "coverage_review_decisions", "upload_lifecycle_audit"],
  });
  // review work and P2-10 create (201); the decisions record (200).
  const FRESH_WRITE_STATUS = Object.freeze({ reviewWork: 201, sensitivityDecision: 200, evidenceReview: 200, claimReview: 200, coverageAcceptance: 201 });
  function assertFreshWrite(outcome, label) {
    const r = outcome[label];
    assert.deepEqual([r.status, r.data?.replayed, r.changed], [FRESH_WRITE_STATUS[label], false, FRESH_WRITE_TABLES[label]], `${label}: ${JSON.stringify(r)}`);
  }
  const summarize = (outcome) => Object.fromEntries(Object.entries(outcome).map(([label, r]) => [label, {
    status: r.status, blockingReason: r.blockingReason, replayed: r.data?.replayed ?? undefined, changed: r.changed,
  }]));

  async function openKnowledgeStudio(page) {
    await page.goto("/impact-library");
    await page.waitForText("Knowledge Studio");
    await page.clickNav("Knowledge Studio");
    await page.waitFor(async () => page.evaluate(`Boolean(document.querySelector(".nav-tabs"))`), "Knowledge Studio tabs");
    await page.idle();
  }
  async function clientReviewsText(page) {
    await openKnowledgeStudio(page);
    await page.selectProject(PROJECT);
    await page.idle();
    await page.clickTab("Reviews");
    await page.waitForText("Waiting for Get Kinder review");
    return page.text();
  }
  async function openAdminKaiAccess(page) {
    await page.goto("/admin?tab=organizations");
    await page.waitForText(ORG_NAME);
    await page.clickOrganizationKaiAccess(ORG_NAME);
    await page.waitForText(`KAI Access — ${ORG_NAME}`);
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
    // E. Fresh writes per authorization predicate
    // =====================================================================
    await test("E0: the superuser provisions the reviewer through the governed routes (organization role, then global role)", async () => {
      const before = await allKaiCounts();
      const membership = await api(USERS.superuser, "PUT", paths.membership(USERS.reviewer), { role_name: "gk_reviewer", membership_status: "active" });
      assert.equal(membership.status, 200, JSON.stringify(membership));
      const role = await api(USERS.superuser, "PUT", paths.globalRole(USERS.reviewer), { role_name: "gk_reviewer", action: "assign" });
      assert.equal(role.status, 200, JSON.stringify(role));
      assert.deepEqual(await storedMembership(USERS.reviewer), [{ role_name: "gk_reviewer", membership_status: "active" }]);
      assert.deepEqual(await globalRoleRows(USERS.reviewer), [{ role_name: "gk_reviewer", active: true, revoked: false }]);
      assert.deepEqual(changedTables(before, await allKaiCounts()), ["audit_events", "organization_memberships", "user_roles"]);
      const actions = (await auditsBy(kaiUserIds.superuser)).map((row) => row.action);
      assert.deepEqual(actions, ["organization_membership_assigned", "global_kai_role_assigned"]);
      // An NPO administrator cannot reach either half.
      const npoGlobal = await api(USERS.npoAdmin, "PUT", paths.globalRole(USERS.reviewer), { role_name: "gk_reviewer", action: "revoke" });
      const npoMembership = await api(USERS.npoAdmin, "PUT", paths.membership(USERS.firstTime), { role_name: "gk_reviewer", membership_status: "active" });
      assert.deepEqual([npoGlobal.status, npoGlobal.blockingReason], [403, "platform_superuser_required"]);
      assert.deepEqual([npoMembership.status, npoMembership.errorCode, npoMembership.blockingReason], [403, "authorization_denied", "non_client_membership_not_client_managed"]);
      results.E0 = "PASS: membership PUT 200 + global-role PUT 200, audited; NPO admin refused both";
    });

    // G1 (before E1's decision): the organization sees this exact file waiting.
    const npoPage = await session(USERS.npoAdmin);
    await test("G1: before the decision the organization sees the chosen file waiting for sensitivity review", async () => {
      const body = await clientReviewsText(npoPage);
      assert.ok(body.includes(`${NAMES.withBoth}: Sensitivity review (Waiting for Get Kinder)`), body.slice(0, 3000));
      assert.ok(body.includes(`${NAMES.unrelated}: Sensitivity review (Waiting for Get Kinder)`));
      results.G1 = `PASS: ${NAMES.withBoth} at Sensitivity review (Waiting for Get Kinder)`;
    });

    let withBothOutcome = null;
    await test("E1: with both halves every operation accepts a fresh write on its own object", async () => {
      const otherBefore = await allKaiCounts();
      const otherOrg = await api(USERS.reviewer, "POST", paths.reviewWork(profiles.otherOrg, OTHER_ORG), {});
      assert.deepEqual([otherOrg.status, otherOrg.blockingReason], [403, "missing_active_organization_membership"], JSON.stringify(otherOrg));
      assert.deepEqual(changedTables(otherBefore, await allKaiCounts()), [], "the cross-organization attempt wrote nothing");

      withBothOutcome = await freshAttempts(USERS.reviewer, "withBoth");
      console.log(`[reviewer-authorization] E1 with both halves: ${JSON.stringify(summarize(withBothOutcome))}`);
      const o = withBothOutcome;
      for (const label of ["reviewWork", "sensitivityDecision", "evidenceReview", "claimReview", "coverageAcceptance"]) assertFreshWrite(o, label);
      for (const label of ["cockpitQueue", "profileRead", "accessCapabilities", "claimLibrary", "evidenceLibrary"]) {
        assert.equal(o[label].status, 200, `${label}: ${JSON.stringify(o[label])}`);
      }
      assert.equal(o.cockpitCapabilities.data.can_manage_sensitivity_review, true);
      assert.equal(o.accessCapabilities.data.internalKnowledgeWorkspace, true);
      for (const label of ["cockpitCapabilities", "cockpitQueue", "profileRead", "accessCapabilities", "claimLibrary", "evidenceLibrary"]) {
        assert.deepEqual(o[label].changed, [], `${label} is a read`);
      }
      const queue = await sensitivityQueueRow(profiles.withBoth);
      assert.equal(queue.created_by, kaiUserIds.reviewer, "the reviewer created the review work");
      assert.deepEqual([queue.queue_status, queue.review_status], ["resolved", "resolved"]);
      const decisions = await sensitivityDecisions(profiles.withBoth);
      assert.equal(decisions.length, 1);
      assert.deepEqual([decisions[0].decision_outcome, decisions[0].decided_by, decisions[0].decided_by_role, decisions[0].review_queue_item_id],
        ["reviewed", kaiUserIds.reviewer, "gk_reviewer", queue.review_queue_item_id]);
      assert.deepEqual(await ledgerRows("evidence_review_decisions", "evidence_item_id", EVIDENCE.withBoth), [{ decided_by: kaiUserIds.reviewer, decided_by_role: "gk_reviewer" }]);
      assert.deepEqual(await ledgerRows("claim_review_decisions", "claim_id", CLAIMS.withBoth), [{ decided_by: kaiUserIds.reviewer, decided_by_role: "gk_reviewer" }]);
      assert.deepEqual(await coverageRows(DIMENSIONS.withBoth), [{ decided_by: kaiUserIds.reviewer, decided_by_role: "gk_reviewer" }]);
      const actions = (await auditsBy(kaiUserIds.reviewer)).map((row) => row.action);
      console.log(`[reviewer-authorization] E1 reviewer audit actions: ${JSON.stringify(actions)}`);
      assert.ok(actions.includes("sensitivity_review_queue_item_created"));
      assert.ok(actions.includes("sensitivity_review_decision_recorded"));
      results.E1 = "PASS: review work 201 (fresh), sensitivity decision 200, P2-12 200, P2-09 200, P2-10 201, cockpit/library/capability reads 200; cross-organization review work 403";
    });

    await test("G2: after reload the organization sees that exact file's sensitivity review complete and its separate source review waiting", async () => {
      const decisions = await sensitivityDecisions(profiles.withBoth);
      const [candidate] = await query(
        `SELECT intake_source_candidate_id::text, candidate_status FROM kai.intake_source_candidates
          WHERE organization_id = $1::uuid AND intake_sensitivity_profile_id = $2::uuid`, [ORG, profiles.withBoth]);
      assert.equal(candidate.candidate_status, "needs_gk_review", "the reviewed decision handed off one source candidate");
      const [sourceReview] = await query(
        `SELECT queue_type, queue_status FROM kai.review_queue_items WHERE organization_id = $1::uuid
          AND target_object_type = 'intake_source_candidate' AND target_object_id = $2::uuid`, [ORG, candidate.intake_source_candidate_id]);
      assert.deepEqual(sourceReview, { queue_type: "source_candidate_review", queue_status: "open" }, "a separate, open source-candidate review");
      const pipeline = await api(USERS.npoAdmin, "GET", paths.pipeline());
      const byId = Object.fromEntries(pipeline.data.files.map((file) => [file.intakeFileId, file]));
      const stageStatus = (fileId, key) => byId[fileId].stages.find((s) => s.key === key)?.status ?? null;
      // The viewer is the organization's (stored) client_admin, which now holds
      // the P1-08 step itself (owner decision 2026-10-19): the source review is
      // the organization's own next action, still separate from the sensitivity review.
      assert.deepEqual([stageStatus(FILES.withBoth, "sensitivity_review"), stageStatus(FILES.withBoth, "source_review"), byId[FILES.withBoth].currentStage, byId[FILES.withBoth].nextAction],
        ["complete", "waiting_for_client", "source_review", "promote_source"]);
      assert.deepEqual([stageStatus(FILES.unrelated, "sensitivity_review"), byId[FILES.unrelated].currentStage], ["waiting_for_get_kinder", "sensitivity_review"],
        "an unrelated file is not marked reviewed");
      const body = await clientReviewsText(npoPage);
      assert.ok(body.includes(`${NAMES.withBoth}: Your action is needed: review this file's source candidate and promote it as a source in Data Sources.`), body.slice(0, 3000));
      assert.ok(!body.includes(`${NAMES.withBoth}: Sensitivity review (Waiting for Get Kinder)`));
      assert.ok(body.includes(`${NAMES.unrelated}: Sensitivity review (Waiting for Get Kinder)`));
      assert.deepEqual(npoPage.exceptions, []);
      results.G2 = `PASS: decision ${decisions[0].decision_id} on profile ${profiles.withBoth}; pipeline sensitivity_review complete, source_review the organization administrator's promote_source (candidate ${candidate.intake_source_candidate_id}, open source_candidate_review); unrelated file still at sensitivity review`;
    });

    await test("E2-E3: after the global role is revoked (organization role unchanged) each operation answers by its own policy", async () => {
      const revoke = await api(USERS.superuser, "PUT", paths.globalRole(USERS.reviewer), { role_name: "gk_reviewer", action: "revoke" });
      assert.equal(revoke.status, 200, JSON.stringify(revoke));
      assert.deepEqual(await globalRoleRows(USERS.reviewer), [{ role_name: "gk_reviewer", active: false, revoked: true }]);
      assert.deepEqual(await storedMembership(USERS.reviewer), [{ role_name: "gk_reviewer", membership_status: "active" }], "membership unchanged");

      const o = await freshAttempts(USERS.reviewer, "afterGlobalRevoke");
      console.log(`[reviewer-authorization] E3 after global revocation: ${JSON.stringify(summarize(o))}`);
      // Global role + any active membership (globalRolesOnly): refused, nothing written.
      assert.equal(o.cockpitCapabilities.data.can_manage_sensitivity_review, false);
      for (const label of ["cockpitQueue", "profileRead", "sensitivityDecision"]) {
        assert.deepEqual([o[label].status, o[label].blockingReason, o[label].changed], [403, "role_not_allowed", []], `${label}: ${JSON.stringify(o[label])}`);
      }
      assert.deepEqual(await sensitivityDecisions(profiles.afterGlobalRevoke), []);
      // Organization role or global role (combineGlobalRoles): fresh writes accepted.
      for (const label of ["reviewWork", "evidenceReview", "claimReview"]) assertFreshWrite(o, label);
      assert.equal((await sensitivityQueueRow(profiles.afterGlobalRevoke)).created_by, kaiUserIds.reviewer, "a new review work item, created by the reviewer");
      assert.deepEqual(await ledgerRows("evidence_review_decisions", "evidence_item_id", EVIDENCE.afterGlobalRevoke), [{ decided_by: kaiUserIds.reviewer, decided_by_role: "gk_reviewer" }]);
      assert.deepEqual(await ledgerRows("claim_review_decisions", "claim_id", CLAIMS.afterGlobalRevoke), [{ decided_by: kaiUserIds.reviewer, decided_by_role: "gk_reviewer" }]);
      // Organization role only: accepted.
      assertFreshWrite(o, "coverageAcceptance");
      assert.deepEqual(await coverageRows(DIMENSIONS.afterGlobalRevoke), [{ decided_by: kaiUserIds.reviewer, decided_by_role: "gk_reviewer" }]);
      for (const label of ["accessCapabilities", "claimLibrary", "evidenceLibrary"]) assert.equal(o[label].status, 200, label);
      assert.equal(o.accessCapabilities.data.internalKnowledgeWorkspace, true);
      results.E3 = "PASS: cockpit capability false, queue/profile read 403 and sensitivity decision 403 (role_not_allowed, nothing written); review work 201 fresh, P2-12 200, P2-09 200 (organization role, combineGlobalRoles); P2-10 201 and library reads 200 (organization role)";
    });

    await test("E4: after the organization role is also removed every operation refuses a fresh write and nothing persists", async () => {
      const removal = await api(USERS.superuser, "PUT", paths.membership(USERS.reviewer), { role_name: "gk_reviewer", membership_status: "inactive" });
      assert.equal(removal.status, 200, JSON.stringify(removal));
      assert.deepEqual(await storedMembership(USERS.reviewer), [{ role_name: "gk_reviewer", membership_status: "inactive" }]);
      // The open sensitivity item for the decision attempt (opened by the
      // superuser's own global role), so the decision is a fresh attempt too.
      const before = await allKaiCounts();
      const o = await freshAttempts(USERS.reviewer, "afterMembershipRemoval", { sensitivityDecision: false });
      console.log(`[reviewer-authorization] E4 after organization-role removal: ${JSON.stringify(summarize(o))}`);
      for (const label of ["reviewWork", "evidenceReview", "claimReview", "coverageAcceptance", "cockpitQueue", "profileRead", "accessCapabilities", "claimLibrary", "evidenceLibrary"]) {
        assert.deepEqual([o[label].status, o[label].blockingReason], [403, "missing_active_organization_membership"], `${label}: ${JSON.stringify(o[label])}`);
      }
      assert.equal(o.cockpitCapabilities.data.can_manage_sensitivity_review, false);
      assert.deepEqual(changedTables(before, await allKaiCounts()), [], "nothing persisted");
      assert.equal(await sensitivityQueueRow(profiles.afterMembershipRemoval), null);
      results.E4 = "PASS: review work, P2-12, P2-09, P2-10, cockpit/library/capability reads all 403 (VAL-AUT-003); nothing persisted";
    });

    // =====================================================================
    // F. A never-signed-in Get Kinder account made a GK reviewer
    // =====================================================================
    const adminPage = await session(USERS.superuser);
    let firstTimeKaiUserId = null;

    await test("F1: the superuser gives a never-signed-in account the gk_reviewer organization role from /admin KAI Access", async () => {
      assert.deepEqual(await kaiUserRows(USERS.firstTime), [], "no KAI identity before provisioning");
      await openAdminKaiAccess(adminPage);
      const before = await allKaiCounts();
      const mark = adminPage.mark();
      await adminPage.modalGrant(email(USERS.firstTime), "gk_reviewer");
      await adminPage.idle();
      const grantWrites = writes(adminPage.requestsSince(mark));
      console.log(`[reviewer-authorization] F1 grant writes: ${JSON.stringify(grantWrites)}; tables ${JSON.stringify(changedTables(before, await allKaiCounts()))}`);
      assert.deepEqual(grantWrites, [["POST", `${paths.membership(USERS.firstTime)}/roles`, 200]], "the additive grant (owner decision B/E C04)");
      const identities = await kaiUserRows(USERS.firstTime);
      assert.equal(identities.length, 1, "exactly one KAI identity");
      assert.deepEqual([identities[0].legacy_identity_source, identities[0].status, identities[0].email],
        ["public.userdata", "active", email(USERS.firstTime)], "mapped to the Get Kinder account, with its email");
      firstTimeKaiUserId = identities[0].user_id;
      assert.deepEqual(await storedMembership(USERS.firstTime), [{ role_name: "gk_reviewer", membership_status: "active" }]);
      assert.deepEqual(await globalRoleRows(USERS.firstTime), []);
      assert.deepEqual(changedTables(before, await allKaiCounts()), ["audit_events", "organization_memberships", "users"]);
      await adminPage.waitFor(async () => Boolean(await adminPage.accessRowText(USERS.firstTime)), "the new roster row");
      const row = await adminPage.accessRowText(USERS.firstTime);
      assert.match(row, new RegExp(email(USERS.firstTime).replace(/\./g, "\\.")), "the roster shows the account's email");
      assert.match(row, /gk_reviewer/);
      assert.match(row, /None/, "no global role yet");
      assert.match(row, /Grant gk_reviewer/);
      const toast = await adminPage.text();
      assert.ok(toast.includes("Sensitivity reviews also need the global gk_reviewer role."), "the grant is not reported as complete reviewer access");
      assert.ok(!toast.includes("Granted gk reviewer access"), "no completion claim for half of the provisioning");
      results.F1 = "PASS: membership PUT 200; one active kai.users identity with the account email; roster shows email, gk_reviewer, global None; toast names the missing global role";
    });

    await test("F2: a failed global-role grant leaves the roster showing the partial state, and a retry completes it", async () => {
      await query(`CREATE FUNCTION kai.synthetic_reject_user_role_write() RETURNS trigger LANGUAGE plpgsql AS $$
                   BEGIN RAISE EXCEPTION 'synthetic global-role write failure'; END $$`);
      await query(`CREATE TRIGGER synthetic_reject_user_role_write BEFORE INSERT OR UPDATE ON kai.user_roles
                   FOR EACH ROW EXECUTE FUNCTION kai.synthetic_reject_user_role_write()`);
      try {
        const before = await allKaiCounts();
        const mark = adminPage.mark();
        await adminPage.clickAccessRowButton(USERS.firstTime, "Grant gk_reviewer");
        await adminPage.waitFor(async () => adminPage.evaluate(`Boolean(document.querySelector(".admin-edit-card .alert-warning"))`), "the modal error");
        await adminPage.idle();
        const failed = writes(adminPage.requestsSince(mark));
        console.log(`[reviewer-authorization] F2 failed grant: ${JSON.stringify(failed)}`);
        assert.equal(failed.length, 1);
        assert.equal(failed[0][1], paths.globalRole(USERS.firstTime));
        assert.ok(failed[0][2] >= 400, "the grant failed");
        assert.deepEqual(changedTables(before, await allKaiCounts()), [], "nothing persisted");
        assert.deepEqual(await globalRoleRows(USERS.firstTime), []);
        const row = await adminPage.accessRowText(USERS.firstTime);
        assert.match(row, /None/, "still no global role shown");
        assert.match(row, /Grant gk_reviewer/, "the grant is still offered");
        assert.match(row, /gk_reviewer/, "the organization half is still shown");
      } finally {
        await query("DROP TRIGGER synthetic_reject_user_role_write ON kai.user_roles");
        await query("DROP FUNCTION kai.synthetic_reject_user_role_write()");
      }
      const mark = adminPage.mark();
      await adminPage.clickAccessRowButton(USERS.firstTime, "Grant gk_reviewer");
      await adminPage.waitFor(async () => /Revoke gk_reviewer/.test(await adminPage.accessRowText(USERS.firstTime) || ""), "the granted global role");
      await adminPage.idle();
      assert.deepEqual(writes(adminPage.requestsSince(mark)), [["PUT", paths.globalRole(USERS.firstTime), 200]]);
      assert.deepEqual(await globalRoleRows(USERS.firstTime), [{ role_name: "gk_reviewer", active: true, revoked: false }]);
      assert.equal((await kaiUserRows(USERS.firstTime)).length, 1, "the global grant reused the same identity");
      assert.deepEqual(adminPage.exceptions, []);
      results.F2 = "PASS: global-role PUT failure shown in the modal, roster still gk_reviewer / None / Grant offered, nothing persisted; retry 200";
    });

    await test("F3: the account's first KAI sign-in resolves the provisioned identity and completes a sensitivity review", async () => {
      const firstPage = await session(USERS.firstTime);
      await firstPage.goto("/impact-library");
      await firstPage.waitForText("Knowledge Studio");
      await firstPage.idle();
      const identities = await kaiUserRows(USERS.firstTime);
      assert.deepEqual(identities.map((row) => [row.user_id, row.status]), [[firstTimeKaiUserId, "active"]], "the same identity, no duplicate");
      const access = await firstPage.fetchJson("GET", paths.accessCapabilities());
      assert.equal(access.data.internalKnowledgeWorkspace, true);
      assert.equal(access.data.organizationAccessManagement, false);
      assert.equal((await firstPage.fetchJson("GET", paths.cockpitCapabilities())).data.can_manage_sensitivity_review, true);
      const before = await allKaiCounts();
      const work = await firstPage.fetchJson("POST", paths.reviewWork(profiles.firstSignIn), {});
      assert.deepEqual([work.status, work.data?.replayed], [201, false], JSON.stringify(work));
      const queue = await sensitivityQueueRow(profiles.firstSignIn);
      const decision = await firstPage.fetchJson("POST", paths.decision(profiles.firstSignIn), reviewedBody(queue));
      assert.equal(decision.status, 200, JSON.stringify(decision));
      const decisions = await sensitivityDecisions(profiles.firstSignIn);
      assert.deepEqual(decisions.map((d) => [d.decision_outcome, d.decided_by, d.decided_by_role]), [["reviewed", firstTimeKaiUserId, "gk_reviewer"]]);
      const after = await sensitivityQueueRow(profiles.firstSignIn);
      assert.deepEqual([after.queue_status, after.review_status], ["resolved", "resolved"]);
      const actions = (await auditsBy(firstTimeKaiUserId)).map((row) => row.action);
      assert.ok(actions.includes("sensitivity_review_queue_item_created") && actions.includes("sensitivity_review_decision_recorded"), JSON.stringify(actions));
      assert.deepEqual(changedTables(before, await allKaiCounts()),
        ["audit_events", "intake_sensitivity_review_decisions", "intake_source_candidates", "review_queue_items", "upload_lifecycle_audit"]);
      assert.deepEqual((await kaiUserRows(USERS.firstTime)).length, 1);
      assert.deepEqual(firstPage.exceptions, []);
      results.F3 = "PASS: first sign-in resolved the provisioned identity (one row, active); capabilities true; review work 201 + decision reviewed 200 by the account (gk_reviewer), audited";
    });

    await test("F4: under the runner's shared kai.users mirror (email nullable) a never-signed-in account is still provisioned with its email", async () => {
      await query("ALTER TABLE kai.users ALTER COLUMN email DROP NOT NULL");
      const membership = await api(USERS.superuser, "PUT", paths.membership(USERS.firstTimeSharedMirror), { role_name: "client_reviewer", membership_status: "active" });
      assert.equal(membership.status, 200, JSON.stringify(membership));
      const identities = await kaiUserRows(USERS.firstTimeSharedMirror);
      console.log(`[reviewer-authorization] F4 identity: ${JSON.stringify(identities.map(({ status, email: value }) => ({ status, email: value })))}`);
      assert.deepEqual(identities.map((row) => [row.status, row.email]), [["active", email(USERS.firstTimeSharedMirror)]]);
      results.F4 = "PASS: membership PUT 200; identity carries the account email";
    });

    console.log(`[reviewer-authorization] results: ${JSON.stringify(results, null, 2)}`);
  } finally {
    for (const page of pages) await page.close().catch(() => {});
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await seedPool.end();
  }
}
