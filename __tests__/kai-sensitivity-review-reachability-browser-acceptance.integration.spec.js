import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Browser acceptance of the human file sensitivity review (B1A-2 Phase-5
 * decision) reached from Knowledge Studio after the Impact Library redesign,
 * run only by
 *   node scripts/kai-client-knowledge-studio-browser-acceptance-local-postgres.js \
 *     __tests__/kai-sensitivity-review-reachability-browser-acceptance.integration.spec.js
 * against that runner's ephemeral loopback PostgreSQL. Skipped otherwise.
 *
 * Package D gated the one Phase-5 review card to the Processing tab, while its
 * Review Queue entry point (Reviews tab) and its zero-queue file entry point
 * (Files tab Web Intake) only set the selected profile - the card stayed
 * hidden. This proves both entry points now open that card and that the
 * existing decision route records the reviewer's decision.
 *
 * Real: every KAI router/service/read model on the runner cluster,
 * resolveKaiActorContext with real memberships and global roles, the built
 * frontend bundle, a real headless Chrome over the DevTools protocol with one
 * isolated browser context (and harness cookie) per actor, the P1-06 review
 * work (browser-driven for the zero-queue file), the B1A-2 decision route,
 * its P1-07 handoff, and the client evidence-pipeline read.
 * Simulated: the Get Kinder session login (req.user from a harness cookie),
 * the runner's synthetic kai.intake_batches / kai.intake_files mirrors, the
 * P1-03..P1-05 rows of the two fresh synthetic files (the P1 worker's
 * output), and, for the queue path only, the earlier "start review work"
 * step (the real P1-06 service called directly).
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

test("sensitivity review reachability browser acceptance isolation: a non-loopback runner URL is refused", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
});

if (!RUNNER_DATABASE_URL || !CHROME || !WORKDIR) {
  test("sensitivity review reachability browser acceptance requires its runner", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_DATABASE_URL);
  await runBrowserAcceptance();
}

// ---------------------------------------------------------------------------
// Minimal Chrome DevTools protocol client (Node's built-in WebSocket), the
// same shape as the other Knowledge Studio acceptance specs.
// ---------------------------------------------------------------------------

async function launchChrome() {
  const profileDir = join(WORKDIR, "chrome-profile-sensitivity-review");
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
  // An isolated browser context per actor: the harness login cookie is
  // per-context, so two actors never share a session.
  const { browserContextId } = await browser.send("Target.createBrowserContext", { disposeOnDetach: true });
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const requests = [];
  const byId = new Map();
  const exceptions = [];
  const paused = [];
  const listener = (message) => {
    if (message.sessionId !== sessionId) return;
    const { method, params } = message;
    if (method === "Fetch.requestPaused") {
      paused.push({ requestId: params.requestId, url: params.request.url });
      return;
    }
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
    // The Reviews tab's sensitivity review action for one pipeline file.
    clickFileReviewAction: (intakeFileId) => clickWhere(`sensitivity review action for ${intakeFileId}`,
      `() => [...document.querySelectorAll('button[data-sensitivity-review-file="${intakeFileId}"]')]
        .find((el) => el.offsetParent !== null && !el.disabled)`),
    fileReviewActionIds: () => evaluate(`[...document.querySelectorAll("button[data-sensitivity-review-file]")]
      .filter((el) => el.offsetParent !== null).map((el) => el.getAttribute("data-sensitivity-review-file")).sort()`),
    reviewPanelFileId: () => evaluate(`(() => {
      const el = document.querySelector("[data-client-sensitivity-review-panel]");
      return el ? el.getAttribute("data-client-sensitivity-review-panel") : null;
    })()`),
    switchOrganization: async (name) => {
      await clickWhere("organization switcher", `() => document.querySelector(".gk-shell-org-switcher-btn")`);
      await waitFor(async () => evaluate(`Boolean(document.querySelector(".gk-shell-org-switcher-menu"))`), "organization menu");
      await clickWhere(`organization ${name}`, `() => [...document.querySelectorAll(".gk-shell-org-switcher-menu button")]
        .find((el) => el.innerText.trim() === ${JSON.stringify(name)})`);
    },
    // Holds every matching response in the browser (the server has already
    // answered) until release(), to prove a late answer cannot populate a
    // context the reviewer has since left.
    async holdResponses(urlPattern) {
      await browser.send("Fetch.enable", { patterns: [{ urlPattern, requestStage: "Response" }] }, sessionId);
      return {
        pausedUrls: () => paused.map((entry) => entry.url),
        async release() {
          for (const entry of paused.splice(0)) await browser.send("Fetch.continueRequest", { requestId: entry.requestId }, sessionId);
          await browser.send("Fetch.disable", {}, sessionId);
        },
      };
    },
    // The "Select" button on the visible list row that shows `rowText`.
    selectRow: (rowText) => clickWhere(`Select on ${rowText}`, `() => [...document.querySelectorAll("li")]
      .filter((el) => el.offsetParent !== null && el.innerText.includes(${JSON.stringify(rowText)}))
      .map((li) => [...li.querySelectorAll("button")].find((b) => b.innerText.trim() === "Select")).find(Boolean)`),
    // The rendered text of the visible card whose heading is `heading`.
    cardText: (heading) => evaluate(`(() => {
      const h = [...document.querySelectorAll("h5")].find((el) => el.offsetParent !== null && el.innerText.trim() === ${JSON.stringify(heading)});
      const card = h && h.closest(".admin-card");
      return card ? card.innerText : null;
    })()`),
    clickInCard: (heading, label) => clickWhere(`${label} in ${heading}`, `() => {
      const h = [...document.querySelectorAll("h5")].find((el) => el.innerText.trim() === ${JSON.stringify(heading)});
      const card = h && h.closest(".admin-card");
      return card && [...card.querySelectorAll("button")].find((b) => b.innerText.trim() === ${JSON.stringify(label)});
    }`),
    // Sets the decision form's <select> on the row whose label is `rowLabel`,
    // through React's value setter so its onChange runs.
    setFormRow: async (rowLabel, value) => {
      const ok = await evaluate(`(() => {
        const label = [...document.querySelectorAll(".col-7")].find((el) => el.offsetParent !== null && el.innerText.trim() === ${JSON.stringify(rowLabel)});
        const el = label && label.parentElement.querySelector("select");
        if (!el) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
        setter.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return el.value === ${JSON.stringify(value)};
      })()`);
      assert.ok(ok, `form ${rowLabel} = ${value}`);
    },
    selectProject: async (engagementId) => {
      const ok = await evaluate(`(() => {
        const el = document.getElementById("gk-shell-project-select");
        if (!el) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
        setter.call(el, ${JSON.stringify(engagementId)});
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      })()`);
      assert.ok(ok, "project selector present");
    },
    pipelineFileText: (intakeFileId) => evaluate(`(() => {
      const el = document.querySelector('[data-pipeline-file="${intakeFileId}"]');
      return el ? el.innerText : null;
    })()`),
    // A same-origin request from this actor's real session (cookie), for the
    // direct-route negative checks.
    fetchJson: (method, path, body) => evaluate(`(async () => {
      const response = await fetch(${JSON.stringify(`${baseUrl}${path}`)}, {
        method: ${JSON.stringify(method)},
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        ${body === undefined ? "" : `body: ${JSON.stringify(JSON.stringify(body))},`}
      });
      let parsed = null;
      try { parsed = await response.json(); } catch { parsed = null; }
      return { status: response.status, errorCode: parsed?.error?.code ?? null };
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
  const { submitSensitivityProfileDecision } = await import("../Backend/kai/services/kaiReviewCockpitService.js");
  const sprint2IntakeApiRouter = (await import("../Backend/kai/routes/sprint2IntakeApi.js")).default;
  const kaiAccessAdministrationApiRouter = (await import("../Backend/kai/routes/kaiAccessAdministrationApi.js")).default;
  const { requireKaiSprint2Enabled } = await import("../Backend/kai/config/kaiSprint2Config.js");
  const { requireKaiSprint2Authenticated } = await import("../Backend/kai/middleware/kaiSprint2Authentication.js");
  const query = async (sql, params = []) => (await seedPool.query(sql, params)).rows;
  const ENV = { KAI_SPRINT2_ENABLED: "true" };
  const noAudit = () => ({ prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } });

  // Fresh synthetic organizations, so no smoke-seed queue row shares this
  // organization's Review Queue.
  const ORG = "00000000-0000-4000-8000-0000000000f1";
  const ORG_B = "00000000-0000-4000-8000-0000000000f2";
  const PROJECT = "7c000000-0000-4000-8000-0000000000f1";
  const PROJECT_2 = "7c000000-0000-4000-8000-0000000000f2";
  const BATCH = "10000000-0000-4000-8000-0000000000f1";
  const FILE_QUEUE = "20000000-0000-4000-8000-0000000000f1";
  const FILE_ZERO = "20000000-0000-4000-8000-0000000000f2";
  // Mixed-role fixtures, seeded only when the mixed-role cases start.
  const FILE_MIXED_QUEUE = "20000000-0000-4000-8000-0000000000f3";
  const FILE_MIXED_ZERO = "20000000-0000-4000-8000-0000000000f4";
  const FILE_MIXED_NMI = "20000000-0000-4000-8000-0000000000f5";
  const FILE_MIXED_NOT_CREATED = "20000000-0000-4000-8000-0000000000f6";
  const FILE_BOUND_ORG_ADMIN = "20000000-0000-4000-8000-0000000000f7";
  const FILE_GK_NOT_CREATED = "20000000-0000-4000-8000-0000000000f8";
  const NAMES = Object.freeze({
    queue: "synthetic_annual_report_2025_26.csv",
    zero: "synthetic_programme_log_2025_26.csv",
    mixedQueue: "synthetic_volunteer_hours_2025_26.csv",
    mixedZero: "synthetic_referrals_2025_26.csv",
    mixedNmi: "synthetic_survey_results_2025_26.csv",
    mixedNotCreated: "synthetic_attendance_2025_26.csv",
    boundOrgAdmin: "synthetic_bound_org_admin_2025_26.csv",
    gkNotCreated: "synthetic_site_visits_2025_26.csv",
  });
  const FIELD_KEYS = ["households_served", "programme_month"];
  const USERS = Object.freeze({ gkReviewer: 981, ordinaryClient: 982, gkOutsider: 983, boundClientAdmin: 984, boundClientAdminTwoOrgs: 985 });

  // The real organization-display query reads this production column when a
  // bound Get Kinder organization admin signs in. The runner's base mirror
  // does not include it.
  await query("ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS logo_url text");
  await query(`INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES
                 ($1::uuid, 'Harbourline Synthetic Review Society', 'harbourline-synthetic-review'),
                 ($2::uuid, 'Other Synthetic Review Collective', 'other-synthetic-review')
               ON CONFLICT (organization_id) DO NOTHING`, [ORG, ORG_B]);
  await query("INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code, project_metadata) VALUES ($1::uuid, $2::uuid, 'Project Synthetic Review', '{}'::jsonb)",
    [PROJECT, ORG]);
  await query("INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code, project_metadata) VALUES ($1::uuid, $2::uuid, 'Project Synthetic Second', '{}'::jsonb)",
    [PROJECT_2, ORG]);
  await query(`INSERT INTO kai.intake_batches (intake_batch_id, organization_id, engagement_id, batch_code, processing_status, review_status)
               VALUES ($1::uuid, $2::uuid, $3::uuid, 'synthetic-review-2026', 'received', 'not_reviewed')`, [BATCH, ORG, PROJECT]);
  const kaiUserIds = {};
  for (const [key, legacyId, role, global, organizations] of [
    ["gkReviewer", USERS.gkReviewer, "gk_reviewer", true, [ORG]],
    // An ordinary client with no sensitivity-review access. A stored
    // client_admin grant is now organization-administrator authority (owner
    // decision 2026-10-19), so the ordinary client is a client_contributor.
    ["ordinaryClient", USERS.ordinaryClient, "client_contributor", false, [ORG]],
    // A global GK reviewer whose only active membership is another organization.
    ["gkOutsider", USERS.gkOutsider, "gk_reviewer", true, [ORG_B]],
    // A bound client administrator without a global GK role.
    ["boundClientAdmin", USERS.boundClientAdmin, "client_admin", false, [ORG]],
    // The same client role in two organizations, for context-switch checks.
    ["boundClientAdminTwoOrgs", USERS.boundClientAdminTwoOrgs, "client_admin", false, [ORG, ORG_B]],
  ]) {
    const [globalRole, membershipRole] = Array.isArray(role) ? role : [role, role];
    await query("INSERT INTO public.userdata (id) VALUES ($1) ON CONFLICT DO NOTHING", [legacyId]);
    const kaiUser = await findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: legacyId, email: `user${legacyId}@harbourline.test` });
    kaiUserIds[key] = kaiUser.user_id;
    for (const organizationId of organizations) {
      await query("INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status) VALUES ($1::uuid, $2::uuid, $3, 'active')",
        [organizationId, kaiUser.user_id, membershipRole]);
    }
    if (global) {
      await query("INSERT INTO kai.user_roles (user_id, role_id) SELECT $1::uuid, role_id FROM kai.roles WHERE role_name = $2", [kaiUser.user_id, globalRole]);
    }
  }
  // October 14: global GK actors now mount the GK workspace (covered by
  // the assembled J3 campaign). Retain client-surface sensitivity, replay,
  // stale-response, and zero-write coverage using the accepted bound-admin
  // exception, without granting this client a global GK role.
  await query("INSERT INTO public.organizations (id, name, status) VALUES (1986, 'Bound Synthetic Admin Organization', 'active')");
  await query("INSERT INTO kai.gk_organization_bindings (gk_organization_id, kai_organization_id, status) VALUES (1986, $1::uuid, 'active')", [ORG]);
  for (const legacyId of [USERS.boundClientAdmin, USERS.boundClientAdminTwoOrgs]) {
    await query("INSERT INTO public.user_org_memberships (user_id, org_id, role, is_active) VALUES ($1, 1986, 'admin', true)", [legacyId]);
  }
  const gkReviewerService = {
    actorType: "human",
    actorUserId: kaiUserIds.gkReviewer,
    source: "public.userdata",
    kaiRoles: ["gk_reviewer"],
    platformSuperuser: false,
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" }],
  };

  /** P1-03..P1-05 rows of one fresh confirmed Project file (the P1 worker's output). */
  async function seedFreshFile(intakeFileId, name, checksumChar) {
    const checksum = checksumChar.repeat(64);
    await query(
      `INSERT INTO kai.intake_files (intake_file_id, intake_batch_id, organization_id, engagement_id, original_filename, safe_filename,
         checksum, hash_algorithm, upload_state, object_version_id, verified_checksum, verified_size_bytes, verified_at,
         mime_type, file_size_bytes, malware_scan_status, review_status, file_policy_status, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $5, $6, 'sha256', 'confirmed', 'synthetic-v1', $6, 512, now(),
         'text/csv', 512, 'clean', 'not_reviewed', 'passed', now())`,
      [intakeFileId, BATCH, ORG, PROJECT, name, checksum],
    );
    const [run] = await query(
      `INSERT INTO kai.intake_parser_runs (organization_id, intake_file_id, parser_name, parser_version, checksum, parser_status, started_at)
       VALUES ($1::uuid, $2::uuid, 'kai_local_profiling_kernel', '1.0.0', $3, 'running', now()) RETURNING parser_run_id::text`,
      [ORG, intakeFileId, checksum],
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
      [ORG, intakeFileId, run.parser_run_id, checksum, JSON.stringify(profile)],
    );
    await query("UPDATE kai.intake_parser_runs SET parser_status = 'completed', completed_at = now(), output_profile_id = $2::uuid WHERE parser_run_id = $1::uuid",
      [run.parser_run_id, fileProfile.file_profile_id]);
    const [dictionary] = await query(
      `INSERT INTO kai.data_dictionaries (organization_id, intake_file_id, file_profile_id, profile_canonical_sha256)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4) RETURNING data_dictionary_id::text`,
      [ORG, intakeFileId, fileProfile.file_profile_id, fileProfile.profile_canonical_sha256],
    );
    for (const key of FIELD_KEYS) {
      await query(
        `INSERT INTO kai.data_dictionary_fields (data_dictionary_id, organization_id, file_profile_id, profile_field_key, field_label_safe, data_type)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $4, 'number')`,
        [dictionary.data_dictionary_id, ORG, fileProfile.file_profile_id, key],
      );
    }
    const [sensitivity] = await query(
      `INSERT INTO kai.intake_sensitivity_profiles (organization_id, intake_file_id, file_profile_id, data_dictionary_id, profile_canonical_sha256)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5) RETURNING intake_sensitivity_profile_id::text`,
      [ORG, intakeFileId, fileProfile.file_profile_id, dictionary.data_dictionary_id, fileProfile.profile_canonical_sha256],
    );
    return sensitivity.intake_sensitivity_profile_id;
  }

  // --- harness app ---------------------------------------------------------
  const publicDir = new URL("../public/", import.meta.url).pathname;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const match = /(?:^|;\s*)kai_harness_user=(\d+)/.exec(req.headers.cookie || "");
    if (match) req.user = { id: Number(match[1]), email: `user${match[1]}@harbourline.test` };
    req.isAuthenticated = () => Boolean(req.user);
    next();
  });
  app.use("/api/kai/sprint2/intake", requireKaiSprint2Enabled, requireKaiSprint2Authenticated, sprint2IntakeApiRouter);
  app.use("/api/kai/sprint2/access-administration", requireKaiSprint2Enabled, requireKaiSprint2Authenticated, kaiAccessAdministrationApiRouter);
  app.get("/impact-library", (_req, res) => res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><title>Impact Library</title>
    <link rel="stylesheet" href="/css/style.css" /><link rel="stylesheet" href="/css/gk-design-tokens.css" /></head>
    <body><div id="impact-evidence-library-root"></div><script src="/js/bundles/entry.js"></script>
    <script>window.renderImpactEvidenceLibrary();</script></body></html>`));
  app.use(express.static(publicDir));
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchChrome();

  const COCKPIT = "/api/kai/sprint2/intake/admin/review-cockpit";
  const decisionPath = (profileId, organizationId = ORG) => `${COCKPIT}/sensitivity-profiles/${profileId}/decision?organization_id=${organizationId}`;
  const reviewWorkPath = (profileId, organizationId = ORG) => `${COCKPIT}/sensitivity-profiles/${profileId}/review-work?organization_id=${organizationId}`;
  const profilePath = (profileId, organizationId = ORG) => `${COCKPIT}/sensitivity-profiles/${profileId}?organization_id=${organizationId}`;
  const pathOf = (r) => new URL(r.url).pathname;
  const posts = (requests) => requests.filter((r) => r.method === "POST").map((r) => [pathOf(r), r.status]);

  // The client boundary (the evidence-pipeline acceptance's list).
  const ALLOWED_PATHS = new Set([`${COCKPIT}/capabilities`]);
  const GK_ONLY_FRAGMENTS = ["/review-cockpit", "/evidence-library", "/claim-library", "/eligible-claims", "/traceability",
    "/review-queue", "/sources", "/client-followups", "/evidence-items", "/source-versions", "/data-dictionaries"];
  const GK_CONTROLS = ["Record decision", "Promote", "Approve", "Reject", "Submit review", "Needs more information",
    "Review sensitivity & allowed use", "Sensitivity & allowed-use review", "Review cockpit"];
  const DECISION_VALUE_LEAKS = ["reviewed_personal_data_status", "needs_more_information", "reviewed_snapshot", "allowed_use_status"];
  // `requests` defaults to the page's whole history; a later check passes its
  // own window so earlier deliberate direct-route negatives are not counted.
  function assertClientBoundary(page, label, body, requests = page.requests()) {
    for (const r of requests) {
      const path = pathOf(r);
      if (ALLOWED_PATHS.has(path)) continue;
      for (const fragment of GK_ONLY_FRAGMENTS) assert.ok(!path.includes(fragment), `${label}: GK-only request ${r.method} ${path}`);
    }
    for (const control of GK_CONTROLS) assert.ok(!body.includes(control), `${label}: GK control visible: ${control}`);
    for (const leak of DECISION_VALUE_LEAKS) assert.ok(!body.includes(leak), `${label}: GK decision data visible: ${leak}`);
    assert.equal(requests.filter((r) => r.method === "POST").length, 0, `${label}: the client issues no write`);
  }

  async function governedCounts(profileId, actorKaiUserId = kaiUserIds.gkReviewer) {
    const [row] = await query(`SELECT
      (SELECT count(*) FROM kai.intake_sensitivity_review_decisions WHERE organization_id = $1::uuid AND intake_sensitivity_profile_id = $2::uuid)::int AS decisions,
      (SELECT count(*) FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'sensitivity_review' AND target_object_id = $2::uuid)::int AS sensitivity_queue,
      (SELECT count(*) FROM kai.audit_events WHERE organization_id = $1::uuid AND action = 'sensitivity_review_decision_recorded' AND actor_user_id = $3::uuid)::int AS decision_audits,
      (SELECT count(*) FROM kai.upload_lifecycle_audit a JOIN kai.intake_sensitivity_profiles p
          ON p.organization_id = a.organization_id AND p.intake_file_id = a.intake_file_id
        WHERE a.organization_id = $1::uuid AND p.intake_sensitivity_profile_id = $2::uuid AND a.operation = 'sensitivity_review_decision_recorded')::int AS lifecycle_audits,
      (SELECT count(*) FROM kai.intake_source_candidates WHERE organization_id = $1::uuid AND intake_sensitivity_profile_id = $2::uuid)::int AS source_candidates,
      (SELECT count(*) FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'source_candidate_review')::int AS source_queue,
      (SELECT count(*) FROM kai.sources WHERE organization_id = $1::uuid)::int AS sources,
      (SELECT count(*) FROM kai.source_versions WHERE organization_id = $1::uuid)::int AS source_versions,
      (SELECT count(*) FROM kai.evidence_items WHERE organization_id = $1::uuid)::int AS evidence,
      (SELECT count(*) FROM kai.claims WHERE organization_id = $1::uuid)::int AS claims`, [ORG, profileId, actorKaiUserId]);
    return row;
  }
  // Every kai table's row count: a delta over all of them proves which tables
  // a step wrote, including every downstream source, evidence, claim,
  // generated-output, export, and release-authority table.
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
  const diff = (before, after) => Object.fromEntries(Object.keys(after).map((key) => [key, after[key] - before[key]]));
  async function sensitivityQueueRow(profileId) {
    const [row] = await query(
      `SELECT review_queue_item_id::text, queue_status, review_status, updated_at FROM kai.review_queue_items
        WHERE organization_id = $1::uuid AND queue_type = 'sensitivity_review' AND target_object_id = $2::uuid`, [ORG, profileId]);
    return row || null;
  }
  async function decisionHead(profileId) {
    return query(
      `SELECT decision_outcome, decided_by::text FROM kai.intake_sensitivity_review_decisions
        WHERE organization_id = $1::uuid AND intake_sensitivity_profile_id = $2::uuid ORDER BY created_at`, [ORG, profileId]);
  }

  async function openKnowledgeStudio(page) {
    await page.goto("/impact-library");
    await page.waitForText("Knowledge Studio");
    await page.clickNav("Knowledge Studio");
    await page.waitFor(async () => page.evaluate(`Boolean(document.querySelector(".nav-tabs"))`), "Knowledge Studio tabs");
    await page.idle();
  }
  async function clientReviewsTab(page) {
    await openKnowledgeStudio(page);
    // gk_reviewer may not list Projects (list_engagement_contexts); a client may.
    await page.waitFor(async () => page.evaluate(`Boolean(document.getElementById("gk-shell-project-select"))`), "project selector");
    await page.selectProject(PROJECT);
    await page.waitFor(async () => Boolean(await page.pipelineFileText(FILE_QUEUE)), "pipeline entry");
    await page.clickTab("Reviews");
    // Owner decision 2026-10-19: a file may wait on Get Kinder, on this actor,
    // or on the organization's administrator; wait for the card itself.
    await page.waitFor(async () => /Waiting for Get Kinder review|Waiting for your organization\u2019s administrator|Ready for you in Data Sources|No action is currently required from you\./
      .test(await page.text()), "the Reviews card");
    await page.idle();
    return page.text();
  }

  const gkPage = await openPage(browser, { baseUrl, legacyUserId: USERS.gkReviewer });
  const clientPage = await openPage(browser, { baseUrl, legacyUserId: USERS.ordinaryClient });
  const outsiderPage = await openPage(browser, { baseUrl, legacyUserId: USERS.gkOutsider });
  const mixedPage = await openPage(browser, { baseUrl, legacyUserId: USERS.boundClientAdmin });
  const twoOrgPage = await openPage(browser, { baseUrl, legacyUserId: USERS.boundClientAdminTwoOrgs });
  const results = {};
  try {
    const profileQueue = await seedFreshFile(FILE_QUEUE, NAMES.queue, "a");
    const profileZero = await seedFreshFile(FILE_ZERO, NAMES.zero, "b");
    // Queue path: review work already opened earlier (the real P1-06 service),
    // so the item is on the organization's Review Queue.
    const ensured = await ensureSensitivityReviewQueueItem(
      { organizationId: ORG, intakeSensitivityProfileId: profileQueue, actorContext: gkReviewerService, now: new Date().toISOString() },
      { env: ENV, metadataOnlyAudit: noAudit() },
    );
    assert.equal(ensured.ok, true, JSON.stringify(ensured));
    const queueItemId = ensured.data.reviewQueueItem.review_queue_item_id;
    const staleQueueStamp = new Date((await sensitivityQueueRow(profileQueue)).updated_at).toISOString();

    await test("case 1: the client Reviews tab names the pending file sensitivity review, who owns it, and that this account cannot perform it - with no GK control or GK read", async () => {
      const body = await clientReviewsTab(clientPage);
      const reviews = body.slice(body.indexOf("Reviews\n"));
      console.log(`[sensitivity-review-browser] client Reviews (before):\n${reviews.slice(0, 1600)}`);
      // The organization has administrators (owner decision 2026-10-19): the
      // ordinary client is told its organization's administrator does this step.
      assert.ok(body.includes(`${NAMES.queue}: Sensitivity review (Waiting for your organization)`));
      assert.ok(body.includes(`${NAMES.zero}: Sensitivity review (Waiting for your organization)`));
      assert.ok(body.includes("Waiting for your organization\u2019s administrator"));
      assert.ok(body.includes("No action is currently required from you."));
      const clientCard = await clientPage.cardText("Reviews");
      assert.ok(clientCard.includes("No action is currently required from you."), "the ordinary client's Reviews card keeps the no-action explanation");
      assert.ok(!clientCard.includes("Get Kinder sensitivity review needed"), "no Get Kinder review work is assigned to an ordinary client");
      assert.ok(body.includes("Your organization\u2019s administrator completes these steps in Data Sources. No action is required from you."), "who does it is explained");
      assert.ok(body.includes("Your account does not have sensitivity-review access for this organization"), "whether this user may act");
      assert.ok(!body.includes("Evidence and Impact Fact reviews are completed by Get Kinder reviewers."), "the old Evidence/Impact-Fact-only explanation is gone");
      assertClientBoundary(clientPage, "case 1", body);
      assert.deepEqual(clientPage.exceptions, []);
      results.case1_client_before = "PASS";
    });

    await test("case 2 (the regression): the GK Review Queue's sensitivity entry opens the review card on Processing", async () => {
      await openKnowledgeStudio(gkPage);
      await gkPage.clickTab("Reviews");
      await gkPage.waitForText("Sensitivity / allowed-use");
      await gkPage.waitFor(() => gkPage.visibleButton("Review sensitivity & allowed use"), "the Review Queue sensitivity entry");
      const mark = gkPage.mark();
      await gkPage.clickButton("Review sensitivity & allowed use");
      await gkPage.waitFor(() => gkPage.visibleButton("Submit review"), "the sensitivity review card's decision form", { timeout: 8000 });
      await gkPage.idle();
      assert.equal(await gkPage.activeTab(), "Processing", "the reviewer is taken to the tab that holds the card");
      const reads = gkPage.requestsSince(mark).filter((r) => r.method === "GET" && r.url.endsWith(profilePath(profileQueue)));
      assert.ok(reads.length >= 1 && reads.every((r) => r.status === 200), "the selected profile's detail was read");
      const body = await gkPage.text();
      assert.ok(body.includes("Needs review"));
      assert.ok(body.includes("open / needs_gk_review"));
      assert.ok(await gkPage.visibleButton("Needs more information"));
      assert.equal(posts(gkPage.requestsSince(mark)).length, 0, "opening the review writes nothing");
      assert.deepEqual(gkPage.exceptions, []);
      results.case2_queue_entry_opens_card = "PASS";
    });

    await test("case 3: the reviewer's 'reviewed' decision uses exactly the existing decision route, persists with audit, resolves only the sensitivity item, and promotes nothing", async () => {
      const before = await governedCounts(profileQueue);
      await gkPage.setFormRow("Personal data", "present");
      await gkPage.setFormRow("Minor data", "absent");
      const mark = gkPage.mark();
      await gkPage.clickButton("Submit review");
      await gkPage.waitForText("Review recorded.");
      await gkPage.idle();
      const since = gkPage.requestsSince(mark);
      console.log(`[sensitivity-review-browser] requests after Submit review: ${JSON.stringify(since.map((r) => [r.method, pathOf(r), r.status]))}`);
      assert.deepEqual(posts(since), [[`${COCKPIT}/sensitivity-profiles/${profileQueue}/decision`, 200]], "exactly the existing decision request");
      assert.ok(since.some((r) => r.method === "GET" && r.url.endsWith(profilePath(profileQueue)) && r.status === 200), "re-read after the decision");
      const delta = diff(before, await governedCounts(profileQueue));
      console.log(`[sensitivity-review-browser] governed delta: ${JSON.stringify(delta)}`);
      assert.deepEqual(delta, {
        decisions: 1, sensitivity_queue: 0, decision_audits: 1, lifecycle_audits: 1, source_candidates: 1, source_queue: 1,
        sources: 0, source_versions: 0, evidence: 0, claims: 0,
      });
      const queue = await sensitivityQueueRow(profileQueue);
      assert.equal(queue.review_queue_item_id, queueItemId, "the existing queue item was transitioned");
      assert.deepEqual([queue.queue_status, queue.review_status], ["resolved", "resolved"]);
      const [decision] = await decisionHead(profileQueue);
      assert.deepEqual([decision.decision_outcome, decision.decided_by], ["reviewed", kaiUserIds.gkReviewer], "decided by the human reviewer");
      const [candidate] = await query("SELECT candidate_status FROM kai.intake_source_candidates WHERE organization_id = $1::uuid AND intake_sensitivity_profile_id = $2::uuid",
        [ORG, profileQueue]);
      assert.equal(candidate.candidate_status, "needs_gk_review", "the source candidate awaits its own separate human decision");
      const body = await gkPage.text();
      assert.ok(body.includes("Reviewed"));
      assert.match(body, /Outcome\s*reviewed/);
      assert.ok(body.includes("Review recorded. This file is now a source candidate waiting for Get Kinder source review"),
        "the result line reports the server's completed P1-07 handoff");
      assert.deepEqual(gkPage.exceptions, []);
      results.case3_reviewed_decision = "PASS";
    });

    await test("case 4: a stale or unsupported decision is rejected by the existing route and persists nothing", async () => {
      const before = await governedCounts(profileQueue);
      const stale = await gkPage.fetchJson("POST", decisionPath(profileQueue), {
        expected_updated_at: staleQueueStamp, review_queue_item_id: queueItemId, decision: "needs_more_information",
      });
      assert.equal(stale.status, 409, JSON.stringify(stale));
      const unsupported = await gkPage.fetchJson("POST", decisionPath(profileQueue), {
        expected_updated_at: staleQueueStamp, review_queue_item_id: queueItemId, decision: "approved",
      });
      assert.deepEqual([unsupported.status, unsupported.errorCode], [422, "validation_blocker"], JSON.stringify(unsupported));
      assert.deepEqual(await governedCounts(profileQueue), before, "nothing persisted");
      results.case4_stale_and_unsupported = "PASS";
    });

    await test("case 5: the client sees the sensitivity review complete and the next Get Kinder stage, never the decision values", async () => {
      const body = await clientReviewsTab(clientPage);
      console.log(`[sensitivity-review-browser] client Reviews (after):\n${body.slice(body.indexOf("Reviews"), body.indexOf("Reviews") + 900)}`);
      assert.ok(body.includes(`${NAMES.queue}: Source review (Waiting for your organization)`));
      assert.ok(body.includes(`${NAMES.zero}: Sensitivity review (Waiting for your organization)`));
      await clientPage.clickTab("Files");
      await clientPage.waitFor(async () => Boolean(await clientPage.pipelineFileText(FILE_QUEUE)), "Files pipeline entry");
      const entry = await clientPage.pipelineFileText(FILE_QUEUE);
      assert.match(entry, /Sensitivity review\s+Complete/);
      assert.match(entry, /Source review\s+Waiting for your organization/);
      assertClientBoundary(clientPage, "case 5", await clientPage.text());
      assert.deepEqual(clientPage.exceptions, []);
      results.case5_client_after = "PASS";
    });

    await test("case 6: the zero-queue file's review is opened from Files and started through the existing review-work route", async () => {
      // A gk_reviewer cannot list Projects, so Web Intake stays organization-wide:
      // load the organization's batches, then the batch's files.
      await openKnowledgeStudio(gkPage);
      assert.equal(await gkPage.activeTab(), "Files");
      await gkPage.clickButton("Load existing batches");
      await gkPage.waitForText("synthetic-review-2026");
      await gkPage.selectRow("synthetic-review-2026");
      await gkPage.idle();
      await gkPage.clickInCard("Batch files", "Load");
      await gkPage.waitForText(NAMES.zero);
      await gkPage.idle();
      await gkPage.selectRow(NAMES.zero);
      let mark = gkPage.mark();
      await gkPage.clickInCard("File status", "Refresh");
      await gkPage.waitFor(() => gkPage.visibleButton("Open sensitivity & allowed-use review"), "the Files sensitivity review entry");
      await gkPage.idle();
      assert.ok(gkPage.requestsSince(mark).some((r) => r.method === "GET" && r.url.includes(`/admin/review-cockpit/intake-files/${FILE_ZERO}/sensitivity-profile`) && r.status === 200),
        "the GK-only file lookup found the profile");
      await gkPage.clickButton("Open sensitivity & allowed-use review");
      await gkPage.waitForText("No sensitivity review work has been started for this source yet.");
      assert.equal(await gkPage.activeTab(), "Processing");
      assert.ok(gkPage.requests().some((r) => r.method === "GET" && r.url.endsWith(profilePath(profileZero)) && r.status === 200));
      assert.equal(await sensitivityQueueRow(profileZero), null, "no review work exists yet");

      const before = await governedCounts(profileZero);
      mark = gkPage.mark();
      await gkPage.clickInCard("Sensitivity & allowed-use review", "Review sensitivity & allowed use");
      await gkPage.waitFor(() => gkPage.visibleButton("Submit review"), "the decision form after review work starts");
      await gkPage.idle();
      assert.deepEqual(posts(gkPage.requestsSince(mark)), [[`${COCKPIT}/sensitivity-profiles/${profileZero}/review-work`, 201]]);
      mark = gkPage.mark();
      await gkPage.clickButton("Needs more information");
      await gkPage.waitForText("Marked as needing more information.");
      await gkPage.idle();
      assert.deepEqual(posts(gkPage.requestsSince(mark)), [[`${COCKPIT}/sensitivity-profiles/${profileZero}/decision`, 200]]);
      const delta = diff(before, await governedCounts(profileZero));
      console.log(`[sensitivity-review-browser] zero-queue governed delta: ${JSON.stringify(delta)}`);
      assert.deepEqual(delta, {
        decisions: 1, sensitivity_queue: 1, decision_audits: 1, lifecycle_audits: 1, source_candidates: 0, source_queue: 0,
        sources: 0, source_versions: 0, evidence: 0, claims: 0,
      });
      const queue = await sensitivityQueueRow(profileZero);
      assert.deepEqual([queue.queue_status, queue.review_status], ["open", "needs_gk_review"], "needs_more_information keeps the review open");
      assert.deepEqual((await decisionHead(profileZero)).map((d) => d.decision_outcome), ["needs_more_information"]);
      assert.deepEqual(gkPage.exceptions, []);
      results.case6_zero_queue_entry = "PASS";
    });

    await test("case 7: a client and a non-member GK reviewer cannot read or decide this organization's sensitivity review", async () => {
      const before = await governedCounts(profileZero);
      const queue = await sensitivityQueueRow(profileZero);
      const body = {
        expected_updated_at: new Date(queue.updated_at).toISOString(),
        review_queue_item_id: queue.review_queue_item_id,
        decision: "reviewed",
        reviewed_snapshot: {
          reviewed_personal_data_status: "absent", reviewed_minor_data_status: "absent",
          reviewed_health_housing_justice_immigration_status: "absent", reviewed_indigenous_governance_status: "absent",
          reviewed_staff_notes_status: "absent", reviewed_story_testimonial_status: "absent", reviewed_small_cell_risk_status: "absent",
          reviewed_financial_records_status: "absent", reviewed_consent_basis_status: "absent", reviewed_allowed_use_status: "unknown",
          reviewed_llm_processing_allowed: false, reviewed_product_learning_allowed: false,
          reviewed_public_use_allowed: false, reviewed_funder_use_allowed: false,
        },
      };
      await outsiderPage.goto("/impact-library");
      for (const [label, page] of [["client_contributor", clientPage], ["non-member gk_reviewer", outsiderPage]]) {
        const decided = await page.fetchJson("POST", decisionPath(profileZero), body);
        assert.equal(decided.status, 403, `${label} decision: ${JSON.stringify(decided)}`);
        const work = await page.fetchJson("POST", reviewWorkPath(profileQueue));
        assert.equal(work.status, 403, `${label} review work: ${JSON.stringify(work)}`);
        const read = await page.fetchJson("GET", profilePath(profileZero));
        assert.equal(read.status, 403, `${label} profile read: ${JSON.stringify(read)}`);
      }
      // The outsider's own-organization Knowledge Studio offers nothing from this organization.
      const outsiderMark = outsiderPage.mark();
      await openKnowledgeStudio(outsiderPage);
      const outsiderBody = await outsiderPage.text();
      for (const name of Object.values(NAMES)) assert.ok(!outsiderBody.includes(name), `non-member sees no ${name}`);
      assert.ok(!outsiderPage.requestsSince(outsiderMark).some((r) => r.url.includes(ORG)), "non-member issues no request for this organization");
      assert.deepEqual(await governedCounts(profileZero), before, "nothing persisted");
      results.case7_authorization = "PASS";
    });

    await test("case 8: an AI/assistant actor and a feature-disabled service cannot record the human decision", async () => {
      const before = await governedCounts(profileZero);
      const queue = await sensitivityQueueRow(profileZero);
      const payload = {
        expected_updated_at: new Date(queue.updated_at).toISOString(),
        review_queue_item_id: queue.review_queue_item_id,
        decision: "needs_more_information",
      };
      const assistant = await submitSensitivityProfileDecision({
        organizationId: ORG, intakeSensitivityProfileId: profileZero, payload,
        actorContext: { ...gkReviewerService, actorType: "assistant" },
      }, { env: ENV });
      assert.equal(assistant.ok, false);
      assert.equal(assistant.error.code, "authorization_denied");
      const disabled = await submitSensitivityProfileDecision({
        organizationId: ORG, intakeSensitivityProfileId: profileZero, payload, actorContext: gkReviewerService,
      }, { env: { KAI_SPRINT2_ENABLED: "false" } });
      assert.equal(disabled.ok, false);
      assert.equal(disabled.error.code, "feature_disabled");
      assert.deepEqual(await governedCounts(profileZero), before, "nothing persisted");
      results.case8_ai_and_feature_gate = "PASS";
    });

    // -----------------------------------------------------------------------
    // Client-surface sensitivity review uses the binding-derived administrator
    // exception. Mixed global GK reviewers now use the GK workspace, proved
    // by the integrated campaign instead of pinning the former client UI.
    const mixedActor = kaiUserIds.boundClientAdmin;
    const mixedProfiles = {};
    const mixedQueueItems = {};
    const MIXED_ALLOWED_PASSIVE = new Set([`${COCKPIT}/capabilities`, `${COCKPIT}/queue`]);
    function assertNoUnrelatedGkRequests(page, label, requests) {
      for (const r of requests) {
        const path = pathOf(r);
        for (const fragment of ["/claim-library", "/evidence-library", "/eligible-claims", "/traceability", "/review-queue", "/sources",
          "/evidence-items", "/source-versions", "/data-dictionaries", "/board-reporting"]) {
          assert.ok(!path.includes(fragment), `${label}: unrelated GK request ${r.method} ${path}`);
        }
      }
    }
    function sensitivityWrites(requests) {
      return posts(requests).filter(([path]) => path.startsWith(`${COCKPIT}/`));
    }
    const mixedBody = async () => mixedPage.text();

    await test("case 9 (bound client administrator): the client Studio mounts, Reviews offers 'Review sensitivity & allowed use' only for files at that stage, and loading it reads no GK detail and writes nothing", async () => {
      mixedProfiles.queue = await seedFreshFile(FILE_MIXED_QUEUE, NAMES.mixedQueue, "c");
      mixedProfiles.zero = await seedFreshFile(FILE_MIXED_ZERO, NAMES.mixedZero, "d");
      mixedProfiles.nmi = await seedFreshFile(FILE_MIXED_NMI, NAMES.mixedNmi, "e");
      for (const key of ["queue", "nmi"]) {
        const opened = await ensureSensitivityReviewQueueItem(
          { organizationId: ORG, intakeSensitivityProfileId: mixedProfiles[key], actorContext: gkReviewerService, now: new Date().toISOString() },
          { env: ENV, metadataOnlyAudit: noAudit() },
        );
        assert.equal(opened.ok, true, JSON.stringify(opened));
        mixedQueueItems[key] = opened.data.reviewQueueItem.review_queue_item_id;
      }

      const mark = mixedPage.mark();
      const body = await clientReviewsTab(mixedPage);
      const tabs = await mixedPage.evaluate(`[...document.querySelectorAll(".nav-tabs button")].map((el) => el.innerText.trim())`);
      // Data Sources: the organization administrator's evidence-to-draft
      // workflow (owner decision 2026-10-18), offered by the client Studio only.
      assert.deepEqual(tabs, ["Files", "Data Sources", "Evidence", "Gaps", "Funder Requirements", "Generated Drafts", "Reviews"], "the client Studio, not the GK one");
      const note = await mixedPage.evaluate(`(() => { const el = document.querySelector("[data-get-kinder-review-access]"); return el ? el.innerText : null; })()`);
      console.log(`[sensitivity-review-browser] mixed-role access note: ${note}`);
      assert.match(note, /^Your organization-scoped review access can complete this organization's sensitivity reviews here/);
      assert.ok(!note.includes("Contact a Get Kinder administrator"), "an authorized reviewer is not sent elsewhere for this review");
      // Files at sensitivity review (FILE_QUEUE is already at source review).
      assert.deepEqual(await mixedPage.fileReviewActionIds(), [FILE_ZERO, FILE_MIXED_QUEUE, FILE_MIXED_ZERO, FILE_MIXED_NMI].sort());
      // Owner decision 2026-10-18: FILE_QUEUE's open source candidate is this
      // administrator's own promotion step (Data Sources), not a Get Kinder wait.
      assert.ok(body.includes(`${NAMES.queue}: Your action is needed: review this file's source candidate and promote it`));
      // The Reviews card offers the action, so it must not also say no action is needed.
      const reviewsCard = await mixedPage.cardText("Reviews");
      console.log(`[sensitivity-review-browser] mixed-role Reviews card:\n${reviewsCard}`);
      assert.ok(reviewsCard.includes("Review sensitivity & allowed use"), "the Reviews card shows the authorized review action");
      assert.ok(!reviewsCard.includes("No action is currently required from you."), "no contradictory no-action message beside the review action");
      // Owner decision 2026-10-19: the four sensitivity reviews and the promotion
      // are this administrator's own work, counted together.
      assert.ok(reviewsCard.includes("5 files in this project are ready for sensitivity review, source preparation, source promotion, or evidence extraction, "
        + "which your role can complete in Data Sources."), "it counts only the actionable files");
      assert.ok(!reviewsCard.includes("Get Kinder sent follow-up questions"), "no client follow-up work is claimed");
      // Owner decision 2026-10-18: FILE_QUEUE's promotable candidate is this administrator's source work.
      assert.ok(reviewsCard.includes("Ready for you in Data Sources"), "the administrator's source work is listed");
      assert.equal(await mixedPage.reviewPanelFileId(), null, "no review panel until the reviewer opens one");
      const since = mixedPage.requestsSince(mark);
      for (const r of since) {
        const path = pathOf(r);
        if (path.includes("/review-cockpit")) assert.ok(MIXED_ALLOWED_PASSIVE.has(path), `no GK lookup or detail read on load: ${r.method} ${path}`);
      }
      assert.equal(posts(since).length, 0, "loading the client Studio writes nothing");
      assertNoUnrelatedGkRequests(mixedPage, "case 9", since);
      assert.deepEqual(mixedPage.exceptions, []);
      results.case9_mixed_role_action_offered = "PASS";
    });

    await test("case 10 (bound client administrator, existing review work): opening the review reads the file's profile and reuses its queue item; 'reviewed' records one decision, resolves the item, and hands off one needs_gk_review candidate - nothing downstream", async () => {
      const profileId = mixedProfiles.queue;
      let mark = mixedPage.mark();
      await mixedPage.clickFileReviewAction(FILE_MIXED_QUEUE);
      await mixedPage.waitFor(() => mixedPage.visibleButton("Submit review"), "the shared decision form");
      await mixedPage.idle();
      let since = mixedPage.requestsSince(mark);
      assert.deepEqual(since.filter((r) => r.method === "GET" && pathOf(r).includes("/review-cockpit/")).map((r) => [pathOf(r), r.status]), [
        [`${COCKPIT}/intake-files/${FILE_MIXED_QUEUE}/sensitivity-profile`, 200],
        [`${COCKPIT}/sensitivity-profiles/${profileId}`, 200],
      ], "the existing file lookup, then the profile detail");
      assert.equal(posts(since).length, 0, "opening the review writes nothing");
      assert.equal(await mixedPage.reviewPanelFileId(), FILE_MIXED_QUEUE);
      let body = await mixedBody();
      assert.ok(body.includes(NAMES.mixedQueue));
      assert.ok(body.includes("open / needs_gk_review"), "the existing queue item is shown");
      assert.ok(!(await mixedPage.visibleButton("Start review work")), "no start action when review work exists");
      for (const field of ["Personal data", "Minor data", "Consent basis", "Ordinary KAI processing (allowed use)"]) assert.ok(body.includes(field), field);

      const before = await governedCounts(profileId, mixedActor);
      const beforeAll = await allKaiCounts();
      await mixedPage.setFormRow("Personal data", "present");
      await mixedPage.setFormRow("Minor data", "absent");
      mark = mixedPage.mark();
      await mixedPage.clickButton("Submit review");
      await mixedPage.waitForText("Sensitivity decision recorded.");
      await mixedPage.waitForText(`${NAMES.mixedQueue}: Your action is needed: review this file's source candidate and promote it`);
      await mixedPage.idle();
      since = mixedPage.requestsSince(mark);
      console.log(`[sensitivity-review-browser] mixed requests after Submit review: ${JSON.stringify(since.map((r) => [r.method, pathOf(r), r.status]))}`);
      assert.deepEqual(sensitivityWrites(since), [[`${COCKPIT}/sensitivity-profiles/${profileId}/decision`, 200]], "exactly the existing decision request");
      assert.equal(posts(since).length, 1, "no other write");
      assert.ok(since.some((r) => r.method === "GET" && r.url.endsWith(profilePath(profileId)) && r.status === 200), "authoritative re-read");
      assert.ok(since.some((r) => r.method === "GET" && pathOf(r).endsWith(`/engagements/${PROJECT}/client-evidence-pipeline`) && r.status === 200),
        "the client pipeline is re-read");
      const delta = diff(before, await governedCounts(profileId, mixedActor));
      console.log(`[sensitivity-review-browser] mixed existing-queue governed delta: ${JSON.stringify(delta)}`);
      assert.deepEqual(delta, {
        decisions: 1, sensitivity_queue: 0, decision_audits: 1, lifecycle_audits: 1, source_candidates: 1, source_queue: 1,
        sources: 0, source_versions: 0, evidence: 0, claims: 0,
      });
      const tables = changedTables(beforeAll, await allKaiCounts());
      console.log(`[sensitivity-review-browser] mixed existing-queue changed tables: ${JSON.stringify(tables)}`);
      assert.deepEqual(tables, ["audit_events", "intake_sensitivity_review_decisions", "intake_source_candidates", "review_queue_items", "upload_lifecycle_audit"],
        "no promotion, source, source version, evidence, claim, generated output, export, or release-authority row");
      const queue = await sensitivityQueueRow(profileId);
      assert.equal(queue.review_queue_item_id, mixedQueueItems.queue, "the existing queue item was reused");
      assert.deepEqual([queue.queue_status, queue.review_status], ["resolved", "resolved"]);
      const decisions = await query(
        "SELECT decision_outcome, decided_by::text, decided_by_role FROM kai.intake_sensitivity_review_decisions WHERE organization_id = $1::uuid AND intake_sensitivity_profile_id = $2::uuid",
        [ORG, profileId]);
      assert.deepEqual(decisions, [{ decision_outcome: "reviewed", decided_by: mixedActor, decided_by_role: "client_admin" }]);
      const candidates = await query(
        "SELECT candidate_status, created_by::text FROM kai.intake_source_candidates WHERE organization_id = $1::uuid AND intake_sensitivity_profile_id = $2::uuid",
        [ORG, profileId]);
      assert.deepEqual(candidates, [{ candidate_status: "needs_gk_review", created_by: mixedActor }]);
      body = await mixedBody();
      assert.ok(body.includes("Source-candidate handoff completed"));
      assert.ok(body.includes("No source has been approved or promoted."));
      assert.match(body, /Outcome\s*reviewed/);
      assert.deepEqual(mixedPage.exceptions, []);
      results.case10_mixed_existing_queue_reviewed = "PASS";
    });

    await test("case 11 (bound client administrator, zero review work): 'Start review work' is an explicit step that creates one item and its audit; reopening reuses it; the 'reviewed' decision then hands off", async () => {
      const profileId = mixedProfiles.zero;
      await mixedPage.clickButton("Close review");
      let mark = mixedPage.mark();
      await mixedPage.clickFileReviewAction(FILE_MIXED_ZERO);
      await mixedPage.waitForText("No sensitivity review work has been started for this source yet.");
      await mixedPage.waitFor(() => mixedPage.visibleButton("Start review work"), "the explicit start action");
      await mixedPage.idle();
      assert.equal(posts(mixedPage.requestsSince(mark)).length, 0, "opening the review writes nothing");
      assert.equal(await sensitivityQueueRow(profileId), null, "no review work exists yet");
      assert.ok(!(await mixedPage.visibleButton("Submit review")), "no decision form before review work exists");

      const beforeWork = await allKaiCounts();
      mark = mixedPage.mark();
      await mixedPage.clickButton("Start review work");
      await mixedPage.waitFor(() => mixedPage.visibleButton("Submit review"), "the decision form after review work starts");
      await mixedPage.idle();
      let since = mixedPage.requestsSince(mark);
      assert.deepEqual(posts(since), [[`${COCKPIT}/sensitivity-profiles/${profileId}/review-work`, 201]]);
      assert.ok(since.some((r) => r.method === "GET" && r.url.endsWith(profilePath(profileId)) && r.status === 200), "authoritative re-read");
      assert.deepEqual(changedTables(beforeWork, await allKaiCounts()), ["audit_events", "review_queue_items", "upload_lifecycle_audit"]);
      const created = await sensitivityQueueRow(profileId);
      assert.deepEqual([created.queue_status, created.review_status], ["open", "needs_gk_review"]);
      const [workAudit] = await query(
        `SELECT count(*)::int AS count FROM kai.audit_events
          WHERE organization_id = $1::uuid AND action = 'sensitivity_review_queue_item_created' AND actor_user_id = $2::uuid AND metadata->>'object_id' = $3`,
        [ORG, mixedActor, profileId]);
      assert.equal(workAudit.count, 1, "the review-work audit, attributed to the mixed-role reviewer");
      assert.equal((await decisionHead(profileId)).length, 0, "starting review work records no decision");

      // Leave and come back: the existing item is reused, never duplicated.
      await mixedPage.clickTab("Files");
      await mixedPage.clickTab("Reviews");
      await mixedPage.waitForText("Ready for you in Data Sources");
      await mixedPage.idle();
      assert.equal(await mixedPage.reviewPanelFileId(), null, "leaving Reviews closes the panel");
      mark = mixedPage.mark();
      await mixedPage.clickFileReviewAction(FILE_MIXED_ZERO);
      await mixedPage.waitFor(() => mixedPage.visibleButton("Submit review"), "the decision form on revisit");
      await mixedPage.idle();
      assert.equal(posts(mixedPage.requestsSince(mark)).length, 0, "revisiting writes nothing");
      assert.ok(!(await mixedPage.visibleButton("Start review work")));
      assert.equal((await query("SELECT count(*)::int AS count FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'sensitivity_review' AND target_object_id = $2::uuid",
        [ORG, profileId]))[0].count, 1, "still exactly one review item");

      const before = await governedCounts(profileId, mixedActor);
      mark = mixedPage.mark();
      await mixedPage.clickButton("Submit review");
      await mixedPage.waitForText("Sensitivity decision recorded.");
      await mixedPage.waitForText(`${NAMES.mixedZero}: Your action is needed: review this file's source candidate and promote it`);
      await mixedPage.idle();
      since = mixedPage.requestsSince(mark);
      assert.deepEqual(posts(since), [[`${COCKPIT}/sensitivity-profiles/${profileId}/decision`, 200]]);
      assert.deepEqual(diff(before, await governedCounts(profileId, mixedActor)), {
        decisions: 1, sensitivity_queue: 0, decision_audits: 1, lifecycle_audits: 1, source_candidates: 1, source_queue: 1,
        sources: 0, source_versions: 0, evidence: 0, claims: 0,
      });
      const queue = await sensitivityQueueRow(profileId);
      assert.equal(queue.review_queue_item_id, created.review_queue_item_id);
      assert.deepEqual([queue.queue_status, queue.review_status], ["resolved", "resolved"]);
      assert.deepEqual((await decisionHead(profileId)).map((d) => [d.decision_outcome, d.decided_by]), [["reviewed", mixedActor]]);
      assert.ok((await mixedBody()).includes("Source-candidate handoff completed"));
      assert.deepEqual(mixedPage.exceptions, []);
      results.case11_mixed_zero_queue = "PASS";
    });

    await test("case 12 (bound client administrator): 'needs_more_information' stays open with no candidate, and a decision made stale underneath is refused (409) and refreshed, never overridden", async () => {
      const profileId = mixedProfiles.nmi;
      await mixedPage.clickButton("Close review");
      await mixedPage.clickFileReviewAction(FILE_MIXED_NMI);
      await mixedPage.waitFor(() => mixedPage.visibleButton("Needs more information"), "the decision form");
      await mixedPage.idle();
      const before = await governedCounts(profileId, mixedActor);
      let mark = mixedPage.mark();
      await mixedPage.clickButton("Needs more information");
      await mixedPage.waitForText("Marked as needing more information.");
      await mixedPage.idle();
      assert.deepEqual(posts(mixedPage.requestsSince(mark)), [[`${COCKPIT}/sensitivity-profiles/${profileId}/decision`, 200]]);
      assert.deepEqual(diff(before, await governedCounts(profileId, mixedActor)), {
        decisions: 1, sensitivity_queue: 0, decision_audits: 1, lifecycle_audits: 1, source_candidates: 0, source_queue: 0,
        sources: 0, source_versions: 0, evidence: 0, claims: 0,
      });
      let queue = await sensitivityQueueRow(profileId);
      assert.deepEqual([queue.queue_status, queue.review_status], ["open", "needs_gk_review"], "the review stays open");
      let body = await mixedBody();
      assert.ok(body.includes("The sensitivity review stays open; no source candidate is created."));
      assert.ok(!body.includes("Source-candidate handoff completed"));
      assert.ok(body.includes(`${NAMES.mixedNmi}: Your action is needed: review this file's sensitivity & allowed use`), "the file is still at sensitivity review");

      // Another reviewer records a decision after this form was loaded.
      const loadedStamp = new Date(queue.updated_at).toISOString();
      const elsewhere = await submitSensitivityProfileDecision({
        organizationId: ORG, intakeSensitivityProfileId: profileId, actorContext: gkReviewerService,
        payload: { expected_updated_at: loadedStamp, review_queue_item_id: queue.review_queue_item_id, decision: "needs_more_information" },
      }, { env: ENV, metadataOnlyAudit: noAudit() });
      assert.equal(elsewhere.ok, true, JSON.stringify(elsewhere));
      const beforeStale = await governedCounts(profileId, mixedActor);
      mark = mixedPage.mark();
      await mixedPage.clickButton("Submit review");
      await mixedPage.waitForText("Sensitivity review state changed since this was loaded - showing the refreshed state.");
      await mixedPage.idle();
      const since = mixedPage.requestsSince(mark);
      assert.deepEqual(posts(since), [[`${COCKPIT}/sensitivity-profiles/${profileId}/decision`, 409]], "one refused request, not retried");
      assert.ok(since.some((r) => r.method === "GET" && r.url.endsWith(profilePath(profileId)) && r.status === 200), "refreshed");
      assert.deepEqual(await governedCounts(profileId, mixedActor), beforeStale, "the stale decision persisted nothing");
      queue = await sensitivityQueueRow(profileId);
      assert.deepEqual([queue.queue_status, queue.review_status], ["open", "needs_gk_review"]);
      body = await mixedBody();
      assert.ok(!body.includes("Sensitivity decision recorded."), "a refused decision is never shown as recorded");
      assert.deepEqual(mixedPage.exceptions, []);
      results.case12_mixed_needs_more_information_and_stale = "PASS";
    });

    await test("case 13 (bound client administrator): when the P1-07 handoff refuses, the recorded decision is shown with 'Source candidate not created', nothing is retried, and no candidate exists", async () => {
      // Review work first (the P1-06 predicate holds), then, in this throwaway
      // runner database only, make the profile fail the P1-07 predicate - the
      // same technique as the P1-07 handoff integration scenario E.
      mixedProfiles.notCreated = await seedFreshFile(FILE_MIXED_NOT_CREATED, NAMES.mixedNotCreated, "f");
      const opened = await ensureSensitivityReviewQueueItem(
        { organizationId: ORG, intakeSensitivityProfileId: mixedProfiles.notCreated, actorContext: gkReviewerService, now: new Date().toISOString() },
        { env: ENV, metadataOnlyAudit: noAudit() },
      );
      assert.equal(opened.ok, true, JSON.stringify(opened));
      await query("ALTER TABLE kai.intake_sensitivity_profiles DROP CONSTRAINT intake_sensitivity_profiles_p1_05_public_use_check");
      await query("UPDATE kai.intake_sensitivity_profiles SET public_use_allowed = true WHERE intake_sensitivity_profile_id = $1::uuid", [mixedProfiles.notCreated]);
      await query("ALTER TABLE kai.intake_sensitivity_profiles ADD CONSTRAINT intake_sensitivity_profiles_p1_05_public_use_check CHECK (public_use_allowed = false) NOT VALID");

      await mixedPage.clickButton("Close review");
      await mixedPage.clickTab("Files");
      await mixedPage.clickTab("Reviews");
      await mixedPage.waitFor(async () => (await mixedPage.fileReviewActionIds()).includes(FILE_MIXED_NOT_CREATED), "the new file's action");
      await mixedPage.idle();
      await mixedPage.clickFileReviewAction(FILE_MIXED_NOT_CREATED);
      await mixedPage.waitFor(() => mixedPage.visibleButton("Submit review"), "the decision form");
      await mixedPage.idle();
      const profileId = mixedProfiles.notCreated;
      const before = await governedCounts(profileId, mixedActor);
      const mark = mixedPage.mark();
      await mixedPage.clickButton("Submit review");
      await mixedPage.waitForText("Source candidate not created");
      await mixedPage.idle();
      await new Promise((r) => setTimeout(r, 1500));
      await mixedPage.idle();
      assert.deepEqual(posts(mixedPage.requestsSince(mark)), [[`${COCKPIT}/sensitivity-profiles/${profileId}/decision`, 200]], "exactly one decision; never retried");
      assert.deepEqual(diff(before, await governedCounts(profileId, mixedActor)), {
        decisions: 1, sensitivity_queue: 0, decision_audits: 1, lifecycle_audits: 1, source_candidates: 0, source_queue: 0,
        sources: 0, source_versions: 0, evidence: 0, claims: 0,
      });
      const body = await mixedBody();
      console.log(`[sensitivity-review-browser] not_created panel: ${body.slice(body.indexOf("Sensitivity decision recorded."), body.indexOf("Sensitivity decision recorded.") + 500)}`);
      assert.ok(body.includes("Sensitivity decision recorded."), "the committed decision is shown");
      assert.ok(body.includes("validation_blocker"), "the handoff's error code is shown");
      assert.ok(body.includes("it does not retry this handoff"), "a resubmission is not presented as a retry");
      assert.ok(!body.includes("Source-candidate handoff completed"));
      assert.match(body, /Outcome\s*reviewed/);
      assert.deepEqual(mixedPage.exceptions, []);
      results.case13_mixed_handoff_not_created = "PASS";
    });

    await test("case 13A (GK reviewer): when the P1-07 handoff refuses, the GK Studio card reports the recorded decision and the uncreated source candidate - never plain success", async () => {
      // The same throwaway-database technique as case 13, for the GK card.
      const profileId = await seedFreshFile(FILE_GK_NOT_CREATED, NAMES.gkNotCreated, "9");
      const opened = await ensureSensitivityReviewQueueItem(
        { organizationId: ORG, intakeSensitivityProfileId: profileId, actorContext: gkReviewerService, now: new Date().toISOString() },
        { env: ENV, metadataOnlyAudit: noAudit() },
      );
      assert.equal(opened.ok, true, JSON.stringify(opened));
      await query("ALTER TABLE kai.intake_sensitivity_profiles DROP CONSTRAINT intake_sensitivity_profiles_p1_05_public_use_check");
      await query("UPDATE kai.intake_sensitivity_profiles SET public_use_allowed = true WHERE intake_sensitivity_profile_id = $1::uuid", [profileId]);
      await query("ALTER TABLE kai.intake_sensitivity_profiles ADD CONSTRAINT intake_sensitivity_profiles_p1_05_public_use_check CHECK (public_use_allowed = false) NOT VALID");

      await openKnowledgeStudio(gkPage);
      await gkPage.clickTab("Reviews");
      await gkPage.waitFor(() => gkPage.visibleButton("Review sensitivity & allowed use"), "a Review Queue sensitivity entry");
      // Open the entry whose card reads this file's profile.
      const entries = await gkPage.evaluate(`[...document.querySelectorAll("button")].filter((el) => el.offsetParent !== null && el.innerText.trim() === "Review sensitivity & allowed use").length`);
      let opened13A = false;
      for (let index = 0; index < entries && !opened13A; index += 1) {
        if (index > 0) await gkPage.clickTab("Reviews");
        const mark = gkPage.mark();
        await gkPage.evaluate(`[...document.querySelectorAll("button")].filter((el) => el.offsetParent !== null && el.innerText.trim() === "Review sensitivity & allowed use")[${index}].click()`);
        await gkPage.idle();
        opened13A = gkPage.requestsSince(mark).some((r) => r.method === "GET" && r.url.endsWith(profilePath(profileId)) && r.status === 200);
      }
      assert.ok(opened13A, "the GK card opened this file's profile");
      await gkPage.waitFor(() => gkPage.visibleButton("Submit review"), "the decision form");
      await gkPage.setFormRow("Personal data", "present");
      await gkPage.setFormRow("Minor data", "absent");
      const before = await governedCounts(profileId);
      const mark = gkPage.mark();
      await gkPage.clickButton("Submit review");
      await gkPage.waitForText("the source candidate was not created");
      await gkPage.idle();
      assert.deepEqual(posts(gkPage.requestsSince(mark)), [[`${COCKPIT}/sensitivity-profiles/${profileId}/decision`, 200]], "exactly one decision; never retried");
      assert.deepEqual(diff(before, await governedCounts(profileId)), {
        decisions: 1, sensitivity_queue: 0, decision_audits: 1, lifecycle_audits: 1, source_candidates: 0, source_queue: 0,
        sources: 0, source_versions: 0, evidence: 0, claims: 0,
      });
      const body = await gkPage.text();
      assert.ok(body.includes("Review recorded, but the source candidate was not created (validation_blocker). No source review item exists for this file yet."));
      assert.ok(!body.includes("This file is now a source candidate"), "a refused handoff is never reported as done");
      assert.deepEqual(gkPage.exceptions, []);
      results.case13A_gk_handoff_not_created = "PASS";
    });

    await test("case 14: an ordinary client never gets the action or GK data; a non-member GK reviewer cannot look up this organization's file; changing project or organization clears the panel and a late answer populates nothing", async () => {
      const clientMark = clientPage.mark();
      const clientBody = await clientReviewsTab(clientPage);
      assert.deepEqual(await clientPage.fileReviewActionIds(), []);
      assert.ok(clientBody.includes(`${NAMES.mixedNmi}: Sensitivity review (Waiting for your organization)`));
      const clientCard = await clientPage.cardText("Reviews");
      assert.ok(clientCard.includes("No action is currently required from you."), "a pending administrator step leaves the ordinary client's no-action explanation");
      assert.ok(!clientCard.includes("Get Kinder sensitivity review needed"));
      assertClientBoundary(clientPage, "case 14", clientBody, clientPage.requestsSince(clientMark));
      assertNoUnrelatedGkRequests(clientPage, "case 14", clientPage.requestsSince(clientMark));

      const lookup = await outsiderPage.fetchJson("GET", `${COCKPIT}/intake-files/${FILE_MIXED_NMI}/sensitivity-profile?organization_id=${ORG}`);
      assert.equal(lookup.status, 403, JSON.stringify(lookup));

      const beforeAll = await allKaiCounts();
      await clientReviewsTab(twoOrgPage);
      // Project change closes the panel.
      await twoOrgPage.clickFileReviewAction(FILE_MIXED_NMI);
      await twoOrgPage.waitFor(() => twoOrgPage.visibleButton("Submit review"), "the decision form");
      await twoOrgPage.idle();
      await twoOrgPage.selectProject(PROJECT_2);
      await twoOrgPage.waitFor(async () => (await twoOrgPage.reviewPanelFileId()) === null, "the panel to close on project change");
      await twoOrgPage.idle();
      assert.ok(!(await twoOrgPage.text()).includes(NAMES.mixedNmi), "no previous-project file shown");
      // A qualified reviewer in a Project with no file at sensitivity review is given no review task.
      await twoOrgPage.waitFor(async () => (await twoOrgPage.cardText("Reviews") || "").includes("No action is currently required from you."),
        "the empty Project's no-action message");
      const emptyProjectCard = await twoOrgPage.cardText("Reviews");
      assert.deepEqual(await twoOrgPage.fileReviewActionIds(), []);
      assert.ok(!emptyProjectCard.includes("Get Kinder sensitivity review needed"), "no fabricated sensitivity review task");
      await twoOrgPage.selectProject(PROJECT);
      await twoOrgPage.waitFor(async () => (await twoOrgPage.fileReviewActionIds()).includes(FILE_MIXED_NMI), "the project's actions");
      await twoOrgPage.idle();
      assert.equal(await twoOrgPage.reviewPanelFileId(), null, "returning does not reopen the panel");

      // File change replaces the panel.
      await twoOrgPage.clickFileReviewAction(FILE_MIXED_NMI);
      await twoOrgPage.waitFor(() => twoOrgPage.visibleButton("Submit review"), "the NMI form");
      await twoOrgPage.idle();
      await twoOrgPage.clickFileReviewAction(FILE_ZERO);
      await twoOrgPage.waitFor(async () => (await twoOrgPage.reviewPanelFileId()) === FILE_ZERO, "the panel to switch files");
      await twoOrgPage.waitFor(() => twoOrgPage.visibleButton("Submit review"), "the other file's form");
      await twoOrgPage.idle();
      const panelText = await twoOrgPage.evaluate(`document.querySelector("[data-client-sensitivity-review-panel]").innerText`);
      assert.ok(panelText.includes(NAMES.zero) && !panelText.includes(NAMES.mixedNmi), "only the selected file's review is shown");

      // A late detail answer for Organization A arrives after switching to B.
      await twoOrgPage.clickButton("Close review");
      const hold = await twoOrgPage.holdResponses("*/review-cockpit/sensitivity-profiles/*");
      const mark = twoOrgPage.mark();
      await twoOrgPage.clickFileReviewAction(FILE_MIXED_NMI);
      await twoOrgPage.waitFor(async () => hold.pausedUrls().length > 0, "the held Organization A detail response");
      // The switcher lists organization ids (no display binding in this fixture).
      await twoOrgPage.switchOrganization(ORG_B);
      await twoOrgPage.waitFor(async () => twoOrgPage.evaluate(`Boolean(document.querySelector(".nav-tabs")
        && !document.querySelector('#gk-shell-project-select option[value="${PROJECT}"]'))`), "Organization B's Studio");
      await new Promise((r) => setTimeout(r, 500));
      await hold.release();
      await new Promise((r) => setTimeout(r, 1000));
      await twoOrgPage.idle();
      const orgBBody = await twoOrgPage.text();
      assert.equal(await twoOrgPage.reviewPanelFileId(), null, "no review panel in Organization B");
      for (const name of Object.values(NAMES)) assert.ok(!orgBBody.includes(name), `Organization B shows no Organization A file: ${name}`);
      assert.ok(!orgBBody.includes("What KAI detected"));
      assert.deepEqual(await twoOrgPage.fileReviewActionIds(), []);
      const afterSwitch = twoOrgPage.requestsSince(mark).filter((r) => !pathOf(r).includes(`/sensitivity-profiles/${mixedProfiles.nmi}`)
        && !pathOf(r).includes(`/intake-files/${FILE_MIXED_NMI}/`));
      for (const r of afterSwitch) {
        if (r.url.includes(ORG)) assert.fail(`no further Organization A request after the switch: ${r.method} ${pathOf(r)}`);
      }
      assert.equal(posts(twoOrgPage.requestsSince(mark)).length, 0);
      assert.deepEqual(changedTables(beforeAll, await allKaiCounts()), [], "context switching wrote nothing");
      assert.deepEqual(twoOrgPage.exceptions, []);
      results.case14_isolation = "PASS";
    });

    await test("case 15: existing bound Get Kinder organization admin completes sensitivity review through Knowledge Studio with client_admin audit attribution", async () => {
      const legacyOrgAdminId = 986;
      const legacyGkOrganizationId = 1986;
      await query("INSERT INTO public.userdata (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
        [legacyOrgAdminId, "bound-admin@harbourline.test"]);
      await query("INSERT INTO public.organizations (id, name, status) VALUES ($1, $2, 'active') ON CONFLICT (id) DO NOTHING",
        [legacyGkOrganizationId, "Bound Synthetic Admin Organization"]);
      await query("INSERT INTO public.user_org_memberships (user_id, org_id, role, is_active) VALUES ($1, $2, 'admin', true)",
        [legacyOrgAdminId, legacyGkOrganizationId]);
      await query("INSERT INTO kai.gk_organization_bindings (gk_organization_id, kai_organization_id, status) VALUES ($1, $2::uuid, 'active') ON CONFLICT DO NOTHING",
        [legacyGkOrganizationId, ORG]);

      const kaiAdmin = await findOrCreateKaiUserByLegacyPublicUserdataId({
        legacyPublicUserdataId: legacyOrgAdminId,
        email: "bound-admin@harbourline.test",
      });
      kaiUserIds.boundOrgAdmin = kaiAdmin.user_id;
      const gkRoles = await query(
        `SELECT count(*)::int AS count FROM kai.user_roles ur
           JOIN kai.roles r ON r.role_id = ur.role_id
          WHERE ur.user_id = $1::uuid AND r.role_name IN ('gk_admin', 'gk_operator', 'gk_reviewer')`,
        [kaiAdmin.user_id],
      );
      assert.equal(gkRoles[0].count, 0, "the organization administrator has no global GK reviewer role");

      const profileId = await seedFreshFile(FILE_BOUND_ORG_ADMIN, NAMES.boundOrgAdmin, "7");
      const orgAdminPage = await openPage(browser, { baseUrl, legacyUserId: legacyOrgAdminId });
      try {
        const body = await clientReviewsTab(orgAdminPage);
        assert.ok((await orgAdminPage.fileReviewActionIds()).includes(FILE_BOUND_ORG_ADMIN));
        assert.ok(body.includes("Knowledge Studio"));
        assert.ok((await orgAdminPage.cardText("Reviews")).includes("Review sensitivity & allowed use"));
        const accessNote = await orgAdminPage.evaluate(`document.querySelector('[data-get-kinder-review-access]')?.innerText || ''`);
        assert.match(accessNote, /^Your organization-scoped review access can complete this organization's sensitivity reviews here/);
        results.case15_bound_admin_copy = "PASS: the rebuilt bundle names a bound-only client_admin's organization-scoped review access";

        const capability = await orgAdminPage.fetchJson("GET", `${COCKPIT}/capabilities?organization_id=${ORG}`);
        assert.equal(capability.status, 200);
        await orgAdminPage.fetchJson("GET", `${COCKPIT}/sensitivity-profiles/${profileId}?organization_id=${ORG}`)
          .then((response) => assert.equal(response.status, 200, JSON.stringify(response)));
        const crossTenantRead = await orgAdminPage.fetchJson("GET", `${COCKPIT}/sensitivity-profiles/${profileId}?organization_id=${ORG_B}`);
        assert.equal(crossTenantRead.status, 403);

        const before = await governedCounts(profileId, kaiAdmin.user_id);
        const mark = orgAdminPage.mark();
        await orgAdminPage.clickFileReviewAction(FILE_BOUND_ORG_ADMIN);
        await orgAdminPage.waitFor(() => orgAdminPage.visibleButton("Start review work"), "organization admin review-work control");
        await orgAdminPage.clickButton("Start review work");
        await orgAdminPage.waitFor(() => orgAdminPage.visibleButton("Submit review"), "organization admin decision form");
        await orgAdminPage.clickButton("Submit review");
        await orgAdminPage.waitForText("Sensitivity decision recorded.");
        await orgAdminPage.idle();

        const since = orgAdminPage.requestsSince(mark);
        assert.deepEqual(sensitivityWrites(since), [
          [`${COCKPIT}/sensitivity-profiles/${profileId}/review-work`, 201],
          [`${COCKPIT}/sensitivity-profiles/${profileId}/decision`, 200],
        ]);
        // The explicit detail read above may be reused by the open panel; the
        // decision still passes through the real route exactly once.
        const delta = diff(before, await governedCounts(profileId, kaiAdmin.user_id));
        assert.deepEqual(delta, {
          decisions: 1, sensitivity_queue: 1, decision_audits: 1, lifecycle_audits: 1, source_candidates: 1, source_queue: 1,
          sources: 0, source_versions: 0, evidence: 0, claims: 0,
        });
        const [candidate] = await query(
          "SELECT intake_source_candidate_id::text, candidate_status, created_by::text FROM kai.intake_source_candidates WHERE organization_id = $1::uuid AND intake_sensitivity_profile_id = $2::uuid",
          [ORG, profileId],
        );
        assert.deepEqual([candidate.candidate_status, candidate.created_by], ["needs_gk_review", kaiAdmin.user_id]);
        const afterDecision = await governedCounts(profileId, kaiAdmin.user_id);
        const sourceReview = await orgAdminPage.fetchJson("POST", `${COCKPIT}/source-candidates/${candidate.intake_source_candidate_id}/decision?organization_id=${ORG}`,
          { outcome: "promoted", reviewed_source_type: "organization_primary_record" });
        // Owner decision 2026-10-18: the bound administrator may also make the
        // P1-08 promotion for its own organization, attributed to itself.
        assert.equal(sourceReview.status, 200, JSON.stringify(sourceReview.body));
        const afterPromotion = await governedCounts(profileId, kaiAdmin.user_id);
        assert.deepEqual([afterPromotion.sources - afterDecision.sources, afterPromotion.source_versions - afterDecision.source_versions], [1, 1]);
        assert.deepEqual(await query(
          "SELECT decision_status, created_by::text FROM kai.intake_promotion_decisions WHERE organization_id = $1::uuid AND intake_source_candidate_id = $2::uuid",
          [ORG, candidate.intake_source_candidate_id]), [{ decision_status: "promoted", created_by: kaiAdmin.user_id }]);
        const decision = await query(
          `SELECT decision_outcome, decided_by::text, decided_by_role
             FROM kai.intake_sensitivity_review_decisions
            WHERE organization_id = $1::uuid AND intake_sensitivity_profile_id = $2::uuid`,
          [ORG, profileId],
        );
        assert.deepEqual(decision, [{ decision_outcome: "reviewed", decided_by: kaiAdmin.user_id, decided_by_role: "client_admin" }]);
        const audit = await query(
          `SELECT count(*)::int AS count FROM kai.audit_events
            WHERE organization_id = $1::uuid AND action = 'sensitivity_review_decision_recorded'
              AND actor_user_id = $2::uuid AND metadata->>'object_id' = $3`,
          [ORG, kaiAdmin.user_id, profileId],
        );
        assert.equal(audit[0].count, 1);
        assert.deepEqual(orgAdminPage.exceptions, []);
        results.case15_bound_org_admin = "PASS";
      } finally {
        await orgAdminPage.close();
      }
    });

    console.log(`[sensitivity-review-browser] results ${JSON.stringify(results)}`);
  } finally {
    await gkPage.close().catch(() => {});
    await clientPage.close().catch(() => {});
    await outsiderPage.close().catch(() => {});
    await mixedPage.close().catch(() => {});
    await twoOrgPage.close().catch(() => {});
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await seedPool.end();
    const { default: ambientPool } = await import("../Backend/db/pg.js");
    await ambientPool.end().catch(() => {});
  }
}
