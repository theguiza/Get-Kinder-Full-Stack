import { createHash } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { syntheticXlsxWorkbook, SYNTHETIC_XLSX_MIME } from "./support/kaiSyntheticXlsxWorkbook.js";

/**
 * Four-view Knowledge Studio direct-view acceptance (owner task 2026-11-07,
 * "Final Local MVP UX and Functional Acceptance"). Run only by
 *   node scripts/kai-client-knowledge-studio-browser-acceptance-local-postgres.js \
 *     __tests__/kai-knowledge-studio-four-view-direct-browser-acceptance.integration.spec.js
 * against that runner's ephemeral loopback PostgreSQL. Skipped otherwise.
 *
 * Unlike the legacy specs, this one uses no former-tab aliases and no harness
 * that reveals hidden controls: every step clicks a visible, enabled,
 * unobstructed control with a real mouse event (or a real key press), using
 * the four tab labels Sources | Impact | Evidence | Drafts (Impact default).
 *
 * The page is the real views/impact-library.ejs (site header, Bootstrap 5.3.5
 * from its CDN with its SRI hash, fonts, inline styles) rendered with harness
 * locals. With KAI_KS_SCREENSHOT_DIR set, desktop and mobile screenshots of
 * every view are written there (synthetic data only).
 *
 * Real: every KAI router, service, repository and validator on the runner
 * cluster; the built bundle; the P1 profiler on synthetic CSV/XLSX/TXT bytes;
 * P2-01 extraction, paired-outcome measurement and interpretation, the record
 * count measurement, P2-03 proposal, generation and the internal drafts read.
 * Simulated, as in the existing client acceptances: the Get Kinder session
 * (harness cookie); the P1-03..P1-05 rows (from the real profiler); the P1-06
 * queue item and sensitivity decision (real services, stubbed audit); the
 * document text reader's storage adapter; the model provider (patched SDK
 * Messages.create repeating each cited claim statement).
 * Not exercised: cross-source linked reach (its worker re-reads file bytes
 * from object storage, which this runner does not provide).
 */

const RUNNER_DATABASE_URL = process.env.KAI_CLIENT_BROWSER_ACCEPTANCE_DATABASE_URL;
const CHROME = process.env.KAI_CLIENT_BROWSER_ACCEPTANCE_CHROME;
const WORKDIR = process.env.KAI_CLIENT_BROWSER_ACCEPTANCE_WORKDIR;
const SCREENSHOT_DIR = process.env.KAI_KS_SCREENSHOT_DIR || "";
const DESKTOP = Object.freeze({ width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
const MOBILE = Object.freeze({ width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

function assertLoopbackDatabaseUrl(urlString) {
  const host = new URL(urlString).hostname.toLowerCase();
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error(`browser acceptance refused a non-loopback database URL host: ${host}`);
  }
}

test("four-view direct browser acceptance isolation: a non-loopback runner URL is refused", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
});

if (!RUNNER_DATABASE_URL || !CHROME || !WORKDIR) {
  test("four-view direct browser acceptance requires its runner", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_DATABASE_URL);
  await runBrowserAcceptance();
}

// ---------------------------------------------------------------------------
// Minimal Chrome DevTools protocol client (same shape as the other specs).
// ---------------------------------------------------------------------------

async function launchChrome() {
  const profileDir = join(WORKDIR, "chrome-profile-four-view-direct");
  mkdirSync(profileDir, { recursive: true });
  const child = spawn(CHROME, [
    "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profileDir}`, "--no-first-run",
    "--no-default-browser-check", "--disable-gpu", "--disable-extensions", "--disable-background-networking", "about:blank",
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
  const { browserContextId } = await browser.send("Target.createBrowserContext", { disposeOnDetach: true });
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const requests = [];
  const byId = new Map();
  const exceptions = [];
  const failedAssets = [];
  let interceptor = null;
  const listener = (message) => {
    if (message.sessionId !== sessionId) return;
    const { method, params } = message;
    if (method === "Network.requestWillBeSent" && params.type !== "Document" && params.request.url.includes("/api/")) {
      const entry = { url: params.request.url, method: params.request.method, postData: params.request.postData, status: null, done: false, at: Date.now() };
      requests.push(entry);
      byId.set(params.requestId, entry);
    } else if (method === "Network.responseReceived" && byId.has(params.requestId)) {
      byId.get(params.requestId).status = params.response.status;
    } else if ((method === "Network.loadingFinished" || method === "Network.loadingFailed") && byId.has(params.requestId)) {
      byId.get(params.requestId).done = true;
    } else if (method === "Network.loadingFailed") {
      failedAssets.push(`${params.type} ${params.errorText} ${params.blockedReason || ""}`);
    } else if (method === "Runtime.exceptionThrown") {
      exceptions.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text);
    } else if (method === "Fetch.requestPaused") {
      handlePaused(params);
    }
  };
  // Response hold (CDP Fetch at the response stage), used only to delay a
  // real server response so a Project switch can overtake it.
  const handlePaused = async (params) => {
    const { requestId } = params;
    try {
      const override = interceptor ? await interceptor({ url: params.request.url }) : null;
      if (override) {
        await browser.send("Fetch.fulfillRequest", {
          requestId, responseCode: override.status,
          responseHeaders: [{ name: "Content-Type", value: "application/json" }],
          body: Buffer.from(JSON.stringify(override.body)).toString("base64"),
        }, sessionId);
      } else await browser.send("Fetch.continueRequest", { requestId }, sessionId);
    } catch (error) {
      exceptions.push(`interception: ${error.message}`);
    }
  };
  browser.listeners.add(listener);
  for (const domain of ["Page", "Network", "Runtime"]) await browser.send(`${domain}.enable`, {}, sessionId);
  await browser.send("Network.setCookie", { name: "kai_harness_user", value: String(legacyUserId), url: baseUrl }, sessionId);

  const evaluate = async (expression) => {
    const result = await browser.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (result.exceptionDetails) throw new Error(`evaluate failed: ${result.exceptionDetails.text} ${expression.slice(0, 160)}`);
    return result.result.value;
  };
  // Only what is rendered: innerText omits hidden (display:none) views.
  const text = () => evaluate("document.body ? document.body.innerText : ''");
  const idle = async () => {
    let quietSince = Date.now();
    for (let i = 0; i < 600; i += 1) {
      await new Promise((r) => setTimeout(r, 50));
      for (const request of requests) if (!request.done && Date.now() - request.at > 15000) { request.done = true; request.abandoned = true; }
      if (requests.some((request) => !request.done)) quietSince = Date.now();
      else if (Date.now() - quietSince > 500) return;
    }
    const recent = requests.filter((request) => !request.done).map((request) => `${request.method} ${request.url} ${request.status}`);
    throw new Error(`network never went idle:\n${recent.join("\n")}`);
  };
  const waitFor = async (predicate, description, { timeout = 20000 } = {}) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`timed out waiting for ${description}\n--- visible page ---\n${(await text()).slice(0, 4000)}`);
  };
  const waitForText = (needle, options) => waitFor(async () => (await text()).includes(needle), `visible text: ${needle}`, options);
  // A real mouse click at the centre of a visible, enabled control that is
  // not covered by anything else. Never reveals or opens anything itself.
  const finder = (selector, label) => (label === null
    ? `document.querySelector(${JSON.stringify(selector)})`
    : `[...document.querySelectorAll(${JSON.stringify(selector)})].find((el) => el.offsetParent !== null && el.innerText.trim() === ${JSON.stringify(label)})`);
  const pointOf = (selector, label = null) => evaluate(`(() => {
    const el = ${finder(selector, label)};
    if (!el || el.disabled || el.offsetParent === null || el.closest("[hidden]")) return null;
    el.scrollIntoView({ block: "center", inline: "nearest" });
    const rect = el.getBoundingClientRect();
    const x = rect.x + Math.min(rect.width / 2, 20), y = rect.y + rect.height / 2;
    const target = document.elementFromPoint(x, y);
    return el === target || el.contains(target) || target?.closest("label")?.control === el ? { x, y } : null;
  })()`);
  const click = async (selector, label = null, description = label || selector) => {
    await browser.send("Page.bringToFront", {}, sessionId);
    let point = null;
    for (let attempt = 0; attempt < 100 && !point; attempt += 1) {
      point = await pointOf(selector, label);
      if (!point) await new Promise((r) => setTimeout(r, 100));
    }
    if (!point) throw new Error(`no visible, enabled, unobstructed control: ${description}\n--- visible page ---\n${(await text()).slice(0, 3000)}`);
    for (const type of ["mousePressed", "mouseReleased"]) {
      await browser.send("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 }, sessionId);
    }
  };
  const key = async (keyName, code = keyName, keyCode = 0, text = "") => {
    await browser.send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", key: keyName, code, windowsVirtualKeyCode: keyCode, ...(text ? { text } : {}) }, sessionId);
    await browser.send("Input.dispatchKeyEvent", { type: "keyUp", key: keyName, code, windowsVirtualKeyCode: keyCode }, sessionId);
  };
  return {
    sessionId,
    requests: () => requests.slice(),
    mark: () => requests.length,
    requestsSince: (mark) => requests.slice(mark),
    exceptions,
    failedAssets,
    evaluate,
    text,
    idle,
    waitFor,
    waitForText,
    click,
    key,
    // The four-view nav, by its visible label only.
    tab: (label) => click("[data-knowledge-studio-tab]", label, `tab ${label}`),
    nav: (label) => click("a, button, [role=button]", label, `nav ${label}`),
    async selectProject(engagementId) {
      const ok = await evaluate(`(() => {
        const el = [...document.querySelectorAll("#gk-shell-project-select")].find((node) => node.offsetParent !== null);
        if (!el || el.disabled || ![...el.options].some((o) => o.value === ${JSON.stringify(engagementId)})) return false;
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, ${JSON.stringify(engagementId)});
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      })()`);
      assert.ok(ok, `visible Project selector with option ${engagementId}`);
    },
    api: (method, path, body) => evaluate(`(async () => {
      const response = await fetch(${JSON.stringify(path)}, {
        method: ${JSON.stringify(method)}, credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        ${body === undefined ? "" : `body: ${JSON.stringify(JSON.stringify(body))},`}
      });
      return { status: response.status, body: await response.json() };
    })()`),
    async holdResponses(patterns, handler) {
      interceptor = handler;
      await browser.send("Fetch.enable", { patterns }, sessionId);
    },
    async releaseHolds() {
      interceptor = null;
      await browser.send("Fetch.disable", {}, sessionId);
    },
    async viewport(metrics) {
      await browser.send("Page.bringToFront", {}, sessionId);
      await browser.send("Emulation.setDeviceMetricsOverride", metrics, sessionId);
      await new Promise((r) => setTimeout(r, 300));
    },
    async goto(path) {
      for (const request of requests) request.done = true;
      await browser.send("Page.navigate", { url: `${baseUrl}${path}` }, sessionId);
      await idle();
    },
    async reload() {
      for (const request of requests) request.done = true;
      await browser.send("Page.reload", { ignoreCache: false }, sessionId);
      await idle();
    },
    // First screen exactly as the viewport shows it, plus the whole document.
    async screenshot(name) {
      if (!SCREENSHOT_DIR) return;
      mkdirSync(SCREENSHOT_DIR, { recursive: true });
      const first = await browser.send("Page.captureScreenshot", { format: "png" }, sessionId);
      writeFileSync(join(SCREENSHOT_DIR, `${name}.png`), Buffer.from(first.data, "base64"));
      // The app shell scrolls inside a fixed-height container: expand it for the whole-view capture, then restore.
      await evaluate(`(() => { window.__ksExpanded = [];
        for (const el of document.querySelectorAll("*")) {
          const style = getComputedStyle(el);
          if ((/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 4) || el.classList.contains("gk-shell-root")) {
            window.__ksExpanded.push([el, el.getAttribute("style")]);
            el.style.setProperty("height", "auto", "important"); el.style.setProperty("max-height", "none", "important"); el.style.setProperty("overflow", "visible", "important");
          }
        } return true; })()`);
      const full = await browser.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }, sessionId);
      await evaluate(`(() => { for (const [el, style] of window.__ksExpanded || []) { if (style === null) el.removeAttribute("style"); else el.setAttribute("style", style); } return true; })()`);
      writeFileSync(join(SCREENSHOT_DIR, `${name}.full.png`), Buffer.from(full.data, "base64"));
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
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-unused-dummy-key";
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const messagesPrototype = Object.getPrototypeOf(new Anthropic({ apiKey: "sk-ant-test-unused-dummy-key" }).messages);
  const modelCalls = [];
  messagesPrototype.create = async function deterministicCreate(payload) {
    const requestBody = JSON.parse(payload.messages[0].content);
    modelCalls.push({ claims: requestBody.claims });
    return { content: [{ type: "text", text: JSON.stringify({
      blocks: requestBody.claims.map((claim) => ({ text: claim.claimStatement, citations: [{ claimId: claim.claimId, evidenceItemId: claim.evidenceItemId }] })),
    }) }] };
  };

  const { Pool } = await import("pg");
  const express = (await import("express")).default;
  const ejs = (await import("ejs")).default;
  const seedPool = new Pool({ connectionString: RUNNER_DATABASE_URL, ssl: false, max: 4 });
  const { profileLocalTrustedFile } = await import("../Backend/kai/profiling/localProfilingKernel.js");
  const { findOrCreateKaiUserByLegacyPublicUserdataId } = await import("../Backend/kai/db/kaiQueries.js");
  const { ensureSensitivityReviewQueueItem } = await import("../Backend/kai/services/kaiReviewQueueService.js");
  const { submitSensitivityProfileDecision } = await import("../Backend/kai/services/kaiReviewCockpitService.js");
  const sprint2IntakeApiRouter = (await import("../Backend/kai/routes/sprint2IntakeApi.js")).default;
  const { requireKaiSprint2Enabled } = await import("../Backend/kai/config/kaiSprint2Config.js");
  const { requireKaiSprint2Authenticated } = await import("../Backend/kai/middleware/kaiSprint2Authentication.js");
  const { BASE_PATH, claimProposalPath, evidenceExtractionPath } = await import("../frontend/impactEvidenceLibraryLogic.js");
  const { measurementDefinitionBody, sourceRecordCountMeasurementPath } = await import("../frontend/knowledgeStudio/clientSourceMeasurementLogic.js");
  const { pairedOutcomeMeasurementsPath, derivedMeasurementInterpretationPath } = await import("../frontend/knowledgeStudio/clientDerivedMeasurementLogic.js");
  const started = Date.now();
  const log = (message) => console.log(`[t+${Math.round((Date.now() - started) / 1000)}s] ${message}`);
  const query = async (sql, params = []) => (await seedPool.query(sql, params)).rows;
  const ENV = { KAI_SPRINT2_ENABLED: "true" };
  const noAudit = () => ({ prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } });

  const ORG = "0e000000-0000-4000-8000-0000000000a1";
  const PROJECT_A = "7e000000-0000-4000-8000-0000000000a1";
  const PROJECT_B = "7e000000-0000-4000-8000-0000000000b1";
  const PROJECT_EMPTY = "7e000000-0000-4000-8000-0000000000c1";
  const PROJECT_FILES = "7e000000-0000-4000-8000-0000000000d1";
  const BATCH = { [PROJECT_FILES]: "12000000-0000-4000-8000-0000000000d1", [PROJECT_A]: "12000000-0000-4000-8000-0000000000a1", [PROJECT_B]: "12000000-0000-4000-8000-0000000000b1" };
  const FILES = Object.freeze({
    sessions: "22000000-0000-4000-8000-0000000000a1",
    outcomes: "22000000-0000-4000-8000-0000000000a2",
    notes: "22000000-0000-4000-8000-0000000000a3",
    workshops: "22000000-0000-4000-8000-0000000000b1",
  });
  const USERS = Object.freeze({ gkReviewer: 981, clientAdmin: 983 });
  // Synthetic session log (Project A): 5 counted records after 1 blank.
  const SESSIONS_CSV = ["session_date,programme,attendees", "2026-09-02,literacy,12", "2026-09-09,literacy,", "",
    "2026-09-16,mentoring,8", "2026-09-16,mentoring,8", "2026-09-23,mentoring,11", ""].join("\n");
  // Synthetic workshop log (Project B): 3 records.
  const WORKSHOPS_CSV = ["workshop_date,facilitator_code", "2026-10-01,F1", "2026-10-08,F2", "2026-10-15,F1", ""].join("\n");
  // Synthetic baseline/follow-up confidence self-ratings (Project A): six
  // participants, each with one pre and one post rating.
  const OUTCOME_ROWS = [
    ["R01", "P01", "pre", 2], ["R02", "P01", "post", 4],
    ["R03", "P02", "pre", 3], ["R04", "P02", "post", 3],
    ["R05", "P03", "pre", 1], ["R06", "P03", "post", 3],
    ["R07", "P04", "pre", 4], ["R08", "P04", "post", 3],
    ["R09", "P05", "pre", 2], ["R10", "P05", "post", 5],
    ["R11", "P06", "pre", 3], ["R12", "P06", "post", 4],
  ];
  const OUTCOMES_XLSX = syntheticXlsxWorkbook({ sheets: [{ name: "Ratings", rows: [["record_ref", "client_code", "timepoint", "confidence_rating"], ...OUTCOME_ROWS] }] });
  const NOTES_TEXT = "Participants said the mentoring sessions were a regular, welcoming part of their week during the autumn term.";
  const PROJECT_NAMES = { [PROJECT_A]: "Riverside Mentoring 2026", [PROJECT_B]: "Workshop Pilot 2026", [PROJECT_EMPTY]: "New Project", [PROJECT_FILES]: "Files without findings" };

  log("imports done");
  // --- organization, Projects, GK binding, users ---------------------------
  await query("ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS logo_url text");
  await query("ALTER TABLE kai.intake_files ADD COLUMN IF NOT EXISTS file_extension text, ADD COLUMN IF NOT EXISTS storage_provider text, ADD COLUMN IF NOT EXISTS storage_object_key text");
  await query("INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES ($1::uuid, 'Riverside Community Society', 'riverside-community')", [ORG]);
  for (const engagementId of [PROJECT_A, PROJECT_B, PROJECT_FILES]) {
    await query("INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code, project_metadata) VALUES ($1::uuid, $2::uuid, $3, '{}'::jsonb)",
      [engagementId, ORG, PROJECT_NAMES[engagementId]]);
    await query(`INSERT INTO kai.intake_batches (intake_batch_id, organization_id, engagement_id, batch_code, processing_status, review_status)
                 VALUES ($1::uuid, $2::uuid, $3::uuid, 'intake', 'received', 'not_reviewed')`, [BATCH[engagementId], ORG, engagementId]);
  }
  await query("INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code, project_metadata) VALUES ($1::uuid, $2::uuid, $3, '{}'::jsonb)",
    [PROJECT_EMPTY, ORG, PROJECT_NAMES[PROJECT_EMPTY]]);
  for (const legacyId of Object.values(USERS)) await query("INSERT INTO public.userdata (id) VALUES ($1) ON CONFLICT DO NOTHING", [legacyId]);
  const [gkOrganization] = await query("INSERT INTO public.organizations (name, status) VALUES ('Riverside Community Society', 'approved') RETURNING id");
  await query("INSERT INTO kai.gk_organization_bindings (gk_organization_id, kai_organization_id, status) VALUES ($1, $2::uuid, 'active')", [gkOrganization.id, ORG]);
  await query("INSERT INTO public.user_org_memberships (org_id, user_id, role, is_active) VALUES ($1, $2, 'admin', true)", [gkOrganization.id, USERS.clientAdmin]);
  const gkReviewer = await findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: USERS.gkReviewer, email: `user${USERS.gkReviewer}@riverside.test` });
  await query("INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status) VALUES ($1::uuid, $2::uuid, 'gk_reviewer', 'active')", [ORG, gkReviewer.user_id]);
  await query("INSERT INTO kai.user_roles (user_id, role_id) SELECT $1::uuid, role_id FROM kai.roles WHERE role_name = 'gk_reviewer'", [gkReviewer.user_id]);
  await findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: USERS.clientAdmin, email: `user${USERS.clientAdmin}@riverside.test` });
  log("seeded users");
  const gkReviewerService = {
    actorType: "human", actorUserId: gkReviewer.user_id, kaiRoles: ["gk_reviewer"], platformSuperuser: false,
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" }],
  };

  /** P1-03..P1-05 persistence simulated from the real profile of the synthetic bytes. */
  async function seedProfiledFile({ fileId, engagementId, text = "", filename, extension = ".csv", workbookBytes = null }) {
    const bytes = workbookBytes || new TextEncoder().encode(text);
    const mime = extension === ".xlsx" ? SYNTHETIC_XLSX_MIME : extension === ".txt" ? "text/plain" : "text/csv";
    const profile = await profileLocalTrustedFile({ extension, declaredMime: mime, byteSize: bytes.byteLength, bytes });
    assert.equal(profile.status, "profiled", JSON.stringify(profile).slice(0, 400));
    const checksum = createHash("sha256").update(bytes).digest("hex");
    await query(
      `INSERT INTO kai.intake_files (intake_file_id, intake_batch_id, organization_id, engagement_id, original_filename, safe_filename,
         checksum, hash_algorithm, upload_state, object_version_id, verified_checksum, verified_size_bytes, verified_at,
         mime_type, file_extension, file_size_bytes, malware_scan_status, review_status, file_policy_status, created_at, storage_provider, storage_object_key)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $7, $7, $5, 'sha256', 'confirmed', 'synthetic-v1', $5, $6, now(),
         $8, $9, $6, 'clean', 'not_reviewed', 'passed', now(), 'local', 'synthetic-object')`,
      [fileId, BATCH[engagementId], ORG, engagementId, checksum, bytes.byteLength, filename, mime, extension],
    );
    const [run] = await query(
      `INSERT INTO kai.intake_parser_runs (organization_id, intake_file_id, parser_name, parser_version, checksum, parser_status, started_at)
       VALUES ($1::uuid, $2::uuid, 'kai_local_profiling_kernel', '1.0.0', $3, 'running', now()) RETURNING parser_run_id::text`, [ORG, fileId, checksum]);
    const [fileProfile] = await query(
      `INSERT INTO kai.intake_file_profiles (organization_id, intake_file_id, parser_run_id, parser_name, parser_version, checksum, profile, profile_canonical_sha256)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'kai_local_profiling_kernel', '1.0.0', $4, $5::jsonb, encode(digest($5::jsonb::text, 'sha256'), 'hex'))
       RETURNING file_profile_id::text, profile_canonical_sha256`, [ORG, fileId, run.parser_run_id, checksum, JSON.stringify(profile)]);
    await query("UPDATE kai.intake_parser_runs SET parser_status = 'completed', completed_at = now(), output_profile_id = $2::uuid WHERE parser_run_id = $1::uuid",
      [run.parser_run_id, fileProfile.file_profile_id]);
    const [dictionary] = await query(
      `INSERT INTO kai.data_dictionaries (organization_id, intake_file_id, file_profile_id, profile_canonical_sha256)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4) RETURNING data_dictionary_id::text`, [ORG, fileId, fileProfile.file_profile_id, fileProfile.profile_canonical_sha256]);
    for (const field of profile.fields || []) {
      await query(
        `INSERT INTO kai.data_dictionary_fields (data_dictionary_id, organization_id, file_profile_id, profile_field_key, field_label_safe, data_type)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $4, 'string')`, [dictionary.data_dictionary_id, ORG, fileProfile.file_profile_id, field.field_key]);
    }
    const [sensitivity] = await query(
      `INSERT INTO kai.intake_sensitivity_profiles (organization_id, intake_file_id, file_profile_id, data_dictionary_id, profile_canonical_sha256)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5) RETURNING intake_sensitivity_profile_id::text`,
      [ORG, fileId, fileProfile.file_profile_id, dictionary.data_dictionary_id, fileProfile.profile_canonical_sha256]);
    return { sensitivityProfileId: sensitivity.intake_sensitivity_profile_id, profile };
  }

  /** Real P1-06 item and GK sensitivity decision (AI permitted, every 7.2 category absent), then the real promotion. */
  async function promote(intakeSensitivityProfileId, page) {
    const ensured = await ensureSensitivityReviewQueueItem(
      { organizationId: ORG, intakeSensitivityProfileId, actorContext: gkReviewerService, now: new Date().toISOString() },
      { env: ENV, metadataOnlyAudit: noAudit() });
    assert.equal(ensured.ok, true, JSON.stringify(ensured));
    const [item] = await query("SELECT updated_at FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid", [ensured.data.reviewQueueItem.review_queue_item_id]);
    const decided = await submitSensitivityProfileDecision({
      organizationId: ORG, intakeSensitivityProfileId, actorContext: gkReviewerService,
      payload: {
        expected_updated_at: new Date(item.updated_at).toISOString(),
        review_queue_item_id: ensured.data.reviewQueueItem.review_queue_item_id,
        decision: "reviewed",
        reviewed_snapshot: {
          reviewed_personal_data_status: "absent", reviewed_minor_data_status: "absent",
          reviewed_health_housing_justice_immigration_status: "absent", reviewed_indigenous_governance_status: "absent",
          reviewed_staff_notes_status: "absent", reviewed_story_testimonial_status: "absent", reviewed_small_cell_risk_status: "absent",
          reviewed_financial_records_status: "absent", reviewed_consent_basis_status: "unknown", reviewed_allowed_use_status: "allowed",
          reviewed_llm_processing_allowed: true, reviewed_product_learning_allowed: false, reviewed_public_use_allowed: false, reviewed_funder_use_allowed: false,
        },
      },
    }, { env: ENV });
    assert.equal(decided.ok, true, JSON.stringify(decided));
    const candidateId = decided.data.source_candidate_handoff.intake_source_candidate_id;
    const promoted = await page.api("POST", `${BASE_PATH}/admin/review-cockpit/source-candidates/${candidateId}/decision?organization_id=${ORG}`,
      { outcome: "promoted", reviewed_source_type: "organization_primary_record" });
    assert.equal(promoted.status, 200, JSON.stringify(promoted.body));
    const [version] = await query("SELECT source_version_id::text FROM kai.source_versions WHERE intake_source_candidate_id = $1::uuid", [candidateId]);
    return version.source_version_id;
  }

  // --- harness app: the real views/impact-library.ejs ------------------------
  const viewsDir = new URL("../views/", import.meta.url).pathname;
  const publicDir = new URL("../public/", import.meta.url).pathname;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const match = /(?:^|;\s*)kai_harness_user=(\d+)/.exec(req.headers.cookie || "");
    if (match) req.user = { id: Number(match[1]), email: `user${match[1]}@riverside.test` };
    req.isAuthenticated = () => Boolean(req.user);
    next();
  });
  app.use("/api/kai/sprint2/intake", requireKaiSprint2Enabled, requireKaiSprint2Authenticated, sprint2IntakeApiRouter);
  app.get("/impact-library", async (_req, res) => {
    res.send(await ejs.renderFile(join(viewsDir, "impact-library.ejs"), { csrfToken: "", assetTag: "", user: null, currentPage: "impact-library" }));
  });
  app.use(express.static(publicDir));
  const server = await new Promise((resolve) => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  log(`server ${baseUrl}`);
  const browser = await launchChrome();
  log("chrome launched");
  const adminPage = await openPage(browser, { baseUrl, legacyUserId: USERS.clientAdmin });
  const gkPage = await openPage(browser, { baseUrl, legacyUserId: USERS.gkReviewer });
  log("pages created");
  const created = (response, label) => assert.ok([200, 201].includes(response.status), `${label}: ${response.status} ${JSON.stringify(response.body)}`);
  const ids = {};
  const findings = {};
  const writes = (page, mark) => page.requestsSince(mark).filter((r) => r.method !== "GET");
  const pathOf = (r) => { const u = new URL(r.url); return `${u.pathname}${u.search}`; };
  const textOf = (page, selector) => page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? el.innerText : null; })()`);
  const visible = (page, selector) => page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return Boolean(el && el.offsetParent !== null && !el.closest("[hidden]")); })()`);
  const activeView = (page) => page.evaluate(`[...document.querySelectorAll("[data-knowledge-studio-tab]")].filter((el) => el.getAttribute("aria-selected") === "true").map((el) => el.innerText.trim())`);
  const setField = (page, selector, value) => page.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el || el.offsetParent === null) return false;
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  // Layout and accessibility facts of what is rendered now.
  const layoutAudit = (page) => page.evaluate(`(() => {
    const doc = document.documentElement;
    const overflowX = doc.scrollWidth - doc.clientWidth;
    const studio = document.querySelector("[data-knowledge-studio-kind]");
    const clipped = studio ? [...studio.querySelectorAll("button, a, input, select, label, h1, h2, h5, h6")]
      .filter((el) => el.offsetParent !== null && !el.closest("[hidden]"))
      .filter((el) => { const r = el.getBoundingClientRect(); return r.right > doc.clientWidth + 1 || r.left < -1; })
      .map((el) => (el.innerText || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 60)) : [];
    const unnamed = studio ? [...studio.querySelectorAll("button, a[href], input, select, textarea")]
      .filter((el) => el.offsetParent !== null && !el.closest("[hidden]") && !el.closest("details:not([open]) > :not(summary)") && el.type !== "hidden")
      .filter((el) => {
        const name = (el.getAttribute("aria-label") || el.innerText || el.value && el.tagName === "BUTTON" && el.value || "").trim()
          || (el.id && document.querySelector('label[for="' + el.id + '"]')?.innerText.trim()) || el.closest("label")?.innerText.trim()
          || el.getAttribute("title") || el.getAttribute("aria-labelledby") && document.getElementById(el.getAttribute("aria-labelledby"))?.innerText.trim();
        return !name;
      }).map((el) => el.outerHTML.slice(0, 160)) : [];
    const smallText = studio ? [...studio.querySelectorAll("*")].filter((el) => el.offsetParent !== null && el.childElementCount === 0 && el.innerText?.trim())
      .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 11).length : 0;
    return { viewport: doc.clientWidth, overflowX, clipped: clipped.slice(0, 10), unnamed: unnamed.slice(0, 10), smallText };
  })()`);
  const styleAudit = (page) => page.evaluate(`(() => {
    const sheet = [...document.styleSheets].find((s) => (s.href || "").includes("bootstrap@5.3.5"));
    let rules = 0; try { rules = sheet ? sheet.cssRules.length : 0; } catch { rules = -1; }
    const probe = document.createElement("button"); probe.className = "btn btn-primary"; document.body.appendChild(probe);
    const bg = getComputedStyle(probe).backgroundColor; probe.remove();
    const tab = document.querySelector("[data-knowledge-studio-tab]");
    return { bootstrapSheet: Boolean(sheet), bootstrapRules: rules, btnPrimaryBackground: bg,
      tabBorderRadius: tab ? getComputedStyle(tab).borderTopLeftRadius : null, bodyFont: getComputedStyle(document.body).fontFamily.slice(0, 60) };
  })()`);
  // innerText per view, as rendered (for the report).
  const dumpView = async (page, label) => {
    const shown = await page.evaluate(`(() => { const s = document.querySelector("[data-knowledge-studio-kind]"); return s ? s.innerText : document.body.innerText; })()`);
    console.log(`[view-text ${label}] ${JSON.stringify(shown.slice(0, 6000))}`);
    return shown;
  };
  const openStudio = async (page, engagementId) => {
    await page.goto("/impact-library");
    await page.waitForText("Knowledge Studio");
    await page.nav("Knowledge Studio");
    await page.waitFor(async () => page.evaluate(`Boolean(document.querySelector("[data-knowledge-studio-nav]"))`), "the four-view nav");
    await page.idle();
    if (engagementId) {
      await page.selectProject(engagementId);
      await page.idle();
    }
  };

  try {
    log("pages opening");
    for (const page of [adminPage, gkPage]) {
      await page.goto("/impact-library");
      await page.viewport(DESKTOP);
    }
    log("pages open");

    await test("setup: Project A (session log, baseline/follow-up ratings, programme notes) and Project B (workshop log), promoted with AI permitted", { timeout: 240000 }, async () => {
      const sessions = await seedProfiledFile({ fileId: FILES.sessions, engagementId: PROJECT_A, text: SESSIONS_CSV, filename: "riverside-sessions-sept.csv" });
      log("sessions seeded");
      ids.sessionsVersion = await promote(sessions.sensitivityProfileId, gkPage);
      log("sessions promoted");
      const outcomes = await seedProfiledFile({ fileId: FILES.outcomes, engagementId: PROJECT_A, filename: "confidence-ratings.xlsx", extension: ".xlsx", workbookBytes: OUTCOMES_XLSX });
      log("outcomes seeded");
      ids.outcomesVersion = await promote(outcomes.sensitivityProfileId, gkPage);
      const notes = await seedProfiledFile({ fileId: FILES.notes, engagementId: PROJECT_A, text: NOTES_TEXT, filename: "mentoring-notes.txt", extension: ".txt" });
      ids.notesVersion = await promote(notes.sensitivityProfileId, gkPage);
      const workshops = await seedProfiledFile({ fileId: FILES.workshops, engagementId: PROJECT_B, text: WORKSHOPS_CSV, filename: "workshop-log-oct.csv" });
      ids.workshopsVersion = await promote(workshops.sensitivityProfileId, gkPage);
      // An uploaded, unpromoted file with no findings is still existing content.
      await seedProfiledFile({ fileId: "22000000-0000-4000-8000-0000000000d1", engagementId: PROJECT_FILES,
        text: WORKSHOPS_CSV.replace("2026-10-01", "2026-11-01"), filename: "not-yet-used.csv" });

      // Structural (field-presence) evidence of the session log, as Use for impact extracts it, with one structural claim.
      log("all promoted");
      const extracted = await adminPage.api("POST", evidenceExtractionPath(ORG, ids.sessionsVersion), {});
      created(extracted, "session log extraction");
      const structural = extracted.body.data.evidenceItems.filter((item) => item.evidence_type === "dictionary_field_presence_fact");
      assert.ok(structural.length >= 3, JSON.stringify(extracted.body.data.evidenceItems.map((item) => item.evidence_type)));
      const structuralClaim = await adminPage.api("POST", claimProposalPath(ORG, structural[0].evidence_item_id), {});
      created(structuralClaim, "structural claim");
      ids.structuralClaimId = structuralClaim.body.data.claim.claim_id;

      // Paired baseline/follow-up outcome: KAI's own computation, then the organization's stated meaning (which creates its evidence).
      log("structural claim");
      const paired = await adminPage.api("POST", pairedOutcomeMeasurementsPath(ORG, ids.outcomesVersion), {});
      console.log(`[paired] ${paired.status} ${JSON.stringify(paired.body).slice(0, 1500)}`);
      created(paired, "paired outcome measurement");
      const recorded = (paired.body.data?.measurements || paired.body.data?.recorded || []);
      const measurementId = recorded[0]?.source_derived_measurement_id || recorded[0]?.measurement?.source_derived_measurement_id;
      assert.ok(measurementId, "a recorded paired measurement");
      const meant = await adminPage.api("POST", derivedMeasurementInterpretationPath(ORG, measurementId), {
        indicator_label: "Confidence self-rating", meaning_text: "Each participant's own rating of their confidence, from 1 (low) to 5 (high).",
        score_direction: "higher_is_better", evidence_basis: "self_reported",
      });
      console.log(`[interpretation] ${meant.status} ${JSON.stringify(meant.body).slice(0, 1500)}`);
      created(meant, "paired interpretation");
      // The measurement's current evidence (stated under its current interpretation), as the UI picks it.
      const currentEvidenceId = meant.body.data.evidenceItem?.evidence_item_id;
      const [pairedEvidence] = await query(
        "SELECT evidence_item_id::text, statement FROM kai.evidence_items WHERE organization_id = $1::uuid AND evidence_item_id = $2::uuid",
        [ORG, currentEvidenceId]);
      assert.ok(pairedEvidence, "paired outcome evidence exists");
      ids.pairedEvidenceId = pairedEvidence.evidence_item_id;
      // The measurement's first, uninterpreted statement (P2-03 refuses it as a claim basis once a meaning is recorded).
      const [firstStatement] = await query(
        "SELECT evidence_item_id::text FROM kai.evidence_items WHERE organization_id = $1::uuid AND source_version_id = $2::uuid AND evidence_type = 'source_derived_measurement' AND evidence_item_id <> $3::uuid",
        [ORG, ids.outcomesVersion, ids.pairedEvidenceId]);
      ids.pairedFirstEvidenceId = firstStatement?.evidence_item_id || null;
      findings.pairedStatement = pairedEvidence.statement;
      const pairedClaim = await adminPage.api("POST", claimProposalPath(ORG, ids.pairedEvidenceId), {});
      created(pairedClaim, "paired claim");
      ids.pairedClaimId = pairedClaim.body.data.claim.claim_id;

      // Document statement evidence from the notes (real text extraction; the storage adapter returns the synthetic bytes).
      const { createPostgresDocumentEvidenceRepository } = await import("../Backend/kai/dictionary/postgresDocumentEvidenceRepository.js");
      const { createDocumentContentReader } = await import("../Backend/kai/parsing/documentContentReader.js");
      const { extractEvidenceFromSourceVersion } = await import("../Backend/kai/services/kaiEvidenceLineageService.js");
      log("paired claim");
      const bytes = new TextEncoder().encode(NOTES_TEXT);
      const documentRepository = createPostgresDocumentEvidenceRepository({
        runInTransaction: async (callback) => {
          const client = await seedPool.connect();
          try { await client.query("BEGIN"); const result = await callback(client); await client.query("COMMIT"); return result; }
          catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
        },
        documentContentReader: createDocumentContentReader({ storageAdapter: { async readObjectVersion() { return { ok: true, data: { bytes }, error: null }; } } }),
      });
      const docExtracted = await extractEvidenceFromSourceVersion({ organizationId: ORG, sourceVersionId: ids.notesVersion, actorContext: gkReviewerService, now: new Date().toISOString() },
        { env: ENV, documentEvidenceRepository: documentRepository });
      assert.equal(docExtracted.ok, true, JSON.stringify(docExtracted));
      ids.docEvidenceId = docExtracted.data.evidenceItems[0].evidence_item_id;
      findings.docType = docExtracted.data.evidenceItems[0].evidence_type;
      const docClaim = await adminPage.api("POST", claimProposalPath(ORG, ids.docEvidenceId), {});
      created(docClaim, "document claim");
      ids.docClaimId = docClaim.body.data.claim.claim_id;

      // Project B: its own counted workshop log and measured claim.
      const counted = await adminPage.api("POST", sourceRecordCountMeasurementPath(ORG, ids.workshopsVersion), measurementDefinitionBody({
        countedUnit: "workshop", unitLabel: "workshops", definitionText: "Each row of the workshop log records one delivered workshop.",
        inclusionRule: "Every data row after the header.", exclusionRule: "The header and empty rows.", periodStart: "2026-10-01", periodEnd: "2026-10-31",
      }));
      created(counted, "Project B count");
      const [bMeasurement] = await query("SELECT evidence_item_id::text FROM kai.evidence_measurements WHERE source_version_id = $1::uuid", [ids.workshopsVersion]);
      const bClaim = await adminPage.api("POST", claimProposalPath(ORG, bMeasurement.evidence_item_id), {});
      created(bClaim, "Project B claim");
      ids.bEvidenceId = bMeasurement.evidence_item_id;
      ids.bClaimId = bClaim.body.data.claim.claim_id;
      console.log(`[fixture] ${JSON.stringify({ ids, findings })}`);
    });

    await test("Sources first, Impact default: a confirmed empty Project offers Add files on desktop/mobile; content and uncertain GK reads keep neutral Impact", { timeout: 240000 }, async () => {
      for (const metrics of [DESKTOP, MOBILE]) {
        await adminPage.viewport(metrics);
        await openStudio(adminPage, PROJECT_EMPTY);
        assert.deepEqual(await adminPage.evaluate(`[...document.querySelectorAll("[data-knowledge-studio-tab]")].map((el) => el.innerText.trim())`),
          ["Sources", "Impact", "Evidence", "Drafts"]);
        assert.deepEqual(await activeView(adminPage), ["Impact"]);
        await adminPage.waitForText("Start building your impact picture");
        assert.ok((await adminPage.text()).includes("Add your existing reports, spreadsheets and other files so KAI can begin organizing your impact evidence."));
        const mark = adminPage.mark();
        await adminPage.click("button", "Add files");
        await adminPage.idle();
        assert.deepEqual(await activeView(adminPage), ["Sources"]);
        assert.equal(await visible(adminPage, '[data-knowledge-studio-view="sources"] input[type="file"]'), true, "the existing upload entry is visible");
        assert.equal(await adminPage.evaluate(`document.activeElement?.dataset.knowledgeStudioTab`), "sources", "CTA moves focus out of the hidden Impact pane");
        assert.equal(adminPage.requestsSince(mark).filter((r) => r.method !== "GET").length, 0, "navigation writes nothing");
        await adminPage.tab("Impact");
        await adminPage.idle();
        assert.equal(await visible(adminPage, "[data-impact-empty-project]"), true);
        assert.ok((await layoutAudit(adminPage)).overflowX <= 1);
      }
      await adminPage.viewport(DESKTOP);
      for (const project of [PROJECT_A, PROJECT_FILES]) {
        await openStudio(adminPage, project);
        assert.deepEqual(await activeView(adminPage), ["Impact"]);
        assert.equal(await visible(adminPage, "[data-impact-empty-project]"), false, "existing content is never a new Project");
      }
      for (const project of [PROJECT_A, PROJECT_EMPTY]) {
        await openStudio(gkPage, project);
        assert.deepEqual(await gkPage.evaluate(`[...document.querySelectorAll("[data-knowledge-studio-tab]")].map((el) => el.innerText.trim())`),
          ["Sources", "Impact", "Evidence", "Drafts"]);
        assert.deepEqual(await activeView(gkPage), ["Impact"]);
        assert.equal(await visible(gkPage, "[data-impact-empty-project]"), false, "GK lacks an authoritative upload read, so retains neutral Impact");
      }
    });

    await test("empty-Project prompt is suppressed for partial/error/loading or malformed reads and late responses after a Project switch", { timeout: 240000 }, async () => {
      const pipelinePattern = `*/engagements/${PROJECT_EMPTY}/client-evidence-pipeline*`;
      for (const override of [
        { status: 503, body: { ok: false, error: { code: "system_error" } } },
        ...["truncated", "reviewedImpactFactsTruncated"].map((flag) => ({ status: 200, body: { ok: true, data: {
          engagementId: PROJECT_EMPTY, files: [], reviewedImpactFacts: [], truncated: false, reviewedImpactFactsTruncated: false,
          [flag]: true, summary: { reasons: [] },
        } } })),
      ]) {
        try {
          await adminPage.holdResponses([{ urlPattern: pipelinePattern, requestStage: "Response" }], async () => override);
          await openStudio(adminPage, PROJECT_EMPTY);
          assert.equal(await visible(adminPage, "[data-impact-empty-project]"), false, JSON.stringify(override));
          assert.deepEqual(await activeView(adminPage), ["Impact"]);
        } finally { await adminPage.releaseHolds(); }
      }
      try {
        await adminPage.holdResponses([{ urlPattern: `*/sources?engagement_id=${PROJECT_EMPTY}*`, requestStage: "Response" }],
          async () => ({ status: 200, body: { ok: true, data: {} } }));
        await openStudio(adminPage, PROJECT_EMPTY);
        assert.equal(await visible(adminPage, "[data-impact-empty-project]"), false, "a missing Sources array is not an empty library");
      } finally { await adminPage.releaseHolds(); }
      await openStudio(adminPage, PROJECT_EMPTY);
      assert.equal(await visible(adminPage, "[data-impact-empty-project]"), true, "complete reads restore the prompt");
      await adminPage.tab("Drafts");
      await adminPage.idle();
      let release;
      const held = new Promise((resolve) => { release = resolve; });
      let intercepted = false;
      try {
        await adminPage.holdResponses([{ urlPattern: pipelinePattern, requestStage: "Response" }], async () => {
          intercepted = true;
          await held;
        });
        await adminPage.tab("Impact");
        await adminPage.waitFor(async () => intercepted, "the held pipeline response");
        assert.equal(await visible(adminPage, "[data-impact-empty-project]"), false, "loading is not empty");
        await adminPage.selectProject(PROJECT_A);
        await adminPage.waitForText(PROJECT_NAMES[PROJECT_A]);
        release();
        await adminPage.idle();
        assert.equal(await visible(adminPage, "[data-impact-empty-project]"), false, "a late empty read cannot repopulate the next Project");
      } finally { release(); await adminPage.releaseHolds(); }
    });

    await test("styles: the real page loads Bootstrap 5.3.5 (SRI verified by the browser) and the site styles", { timeout: 240000 }, async () => {
      await openStudio(adminPage, PROJECT_A);
      const styles = await styleAudit(adminPage);
      console.log(`[styles] ${JSON.stringify(styles)} failedAssets=${JSON.stringify(adminPage.failedAssets)}`);
      assert.equal(styles.bootstrapSheet, true, "the Bootstrap stylesheet is attached");
      assert.ok(styles.bootstrapRules > 100, "the Bootstrap stylesheet loaded (cross-origin rules readable after SRI/CORS)");
      assert.equal(styles.btnPrimaryBackground, "rgb(13, 110, 253)", "Bootstrap's .btn-primary applies");
    });

    // Recorded for Journey B (it is the Sources measurement action).
    await test("Journey B: Sources -> a recognizable file -> Count records; the form survives a visit to another view; one write; nothing else processed", { timeout: 240000 }, async () => {
      await openStudio(adminPage, PROJECT_A);
      assert.deepEqual(await activeView(adminPage), ["Impact"], "Impact is the default view");
      await adminPage.tab("Sources");
      await adminPage.idle();
      await adminPage.waitForText("riverside-sessions-sept.csv");
      const sourcesText = await dumpView(adminPage, "client sources A (before count)");
      assert.ok(!sourcesText.includes("workshop-log-oct.csv"), "Project B's file is not in Project A's Sources");
      const opener = `[data-client-open-source-measurement="${ids.sessionsVersion}"]`;
      await adminPage.click(opener, null, "Count records for the session log");
      await adminPage.waitForText("Counted records = data records minus blank records = 5");
      const mark = adminPage.mark();
      for (const [field, value] of [
        ["countedUnit", "programme session"], ["unitLabel", "programme sessions"],
        ["definitionText", "Each row of the session log records one delivered programme session."],
        ["inclusionRule", "Every data row after the header row that has at least one value."],
        ["exclusionRule", "The header row and empty rows."], ["periodStart", "2026-09-01"], ["periodEnd", "2026-09-30"],
      ]) assert.ok(await setField(adminPage, `[data-client-source-measurement-field="${field}"]`, value), field);
      // Navigate away and back: the open panel and typed definition are kept.
      await adminPage.tab("Impact");
      await adminPage.idle();
      assert.equal(await visible(adminPage, `[data-client-source-measurement-field="definitionText"]`), false, "the form is not shown in Impact");
      await adminPage.tab("Evidence");
      await adminPage.idle();
      await adminPage.tab("Sources");
      assert.equal(await adminPage.evaluate(`document.querySelector('[data-client-source-measurement-field="definitionText"]').value`),
        "Each row of the session log records one delivered programme session.", "typed definition kept across views");
      assert.deepEqual(writes(adminPage, mark), [], "switching views writes nothing");
      await adminPage.click('[data-client-source-measurement-field="periodAttested"]', null, "attest the period");
      await adminPage.click("[data-client-source-measurement-submit]", null, "Record definition and count");
      await adminPage.waitForText("Measurement: 5 programme sessions");
      await adminPage.idle();
      const [measurement] = await query("SELECT evidence_item_id::text, measured_value FROM kai.evidence_measurements WHERE source_version_id = $1::uuid", [ids.sessionsVersion]);
      assert.equal(Number(measurement.measured_value), 5);
      ids.countEvidenceId = measurement.evidence_item_id;
      await adminPage.click(`[data-client-source-measurement-propose-claim="${ids.countEvidenceId}"]`, null, "Propose a claim");
      await adminPage.waitForText("Claim: ");
      await adminPage.idle();
      const [claim] = await query("SELECT claim_id::text FROM kai.claims WHERE organization_id = $1::uuid AND evidence_item_id = $2::uuid", [ORG, ids.countEvidenceId]);
      ids.countClaimId = claim.claim_id;
      const sent = writes(adminPage, mark).map((r) => `${r.method} ${new URL(r.url).pathname}`);
      console.log(`[journey-b writes] ${JSON.stringify(sent)}`);
      assert.equal(sent.filter((w) => w.endsWith("/record-count-measurement") || w.includes("record-count")).length, 1, "exactly one measurement write");
      assert.equal(sent.filter((w) => w.endsWith("/claim-proposal") || w.includes("/claims")).length, 1, "exactly one claim proposal");
      assert.equal(sent.length, 2, "no other write or processing operation");
      // Navigate away and back again: the feedback is kept.
      await adminPage.tab("Drafts");
      await adminPage.idle();
      await adminPage.tab("Sources");
      await adminPage.waitForText("Measurement: 5 programme sessions");
      assert.equal((await query("SELECT count(*)::int AS n FROM kai.evidence_measurements WHERE source_version_id = $1::uuid", [ids.sessionsVersion]))[0].n, 1, "no duplicate measurement");
    });

    await test("Impact and Evidence content: Project A's findings, classified by their recorded type, with structural facts and ids behind disclosure", { timeout: 240000 }, async () => {
      await openStudio(adminPage, PROJECT_A);
      await adminPage.waitFor(async () => adminPage.evaluate(`Boolean(document.querySelector("[data-impact-section]"))`), "Impact sections");
      await adminPage.idle();
      const impact = await dumpView(adminPage, "client impact A");
      assert.ok(impact.includes(PROJECT_NAMES[PROJECT_A]), "the selected Project is the page identity");
      const sectionOf = (evidenceItemId) => adminPage.evaluate(`(() => { const el = document.querySelector('[data-impact-finding="${evidenceItemId}"]'); return el ? el.closest("[data-impact-section]").getAttribute("data-impact-section") : null; })()`);
      findings.impactSections = {
        paired: await sectionOf(ids.pairedEvidenceId), pairedFirst: ids.pairedFirstEvidenceId ? await sectionOf(ids.pairedFirstEvidenceId) : "none", count: await sectionOf(ids.countEvidenceId), doc: await sectionOf(ids.docEvidenceId),
        projectB: await sectionOf(ids.bEvidenceId),
      };
      console.log(`[impact-sections] ${JSON.stringify(findings.impactSections)}`);
      assert.equal(findings.impactSections.paired, "outcomes", "the paired baseline/follow-up measurement is an outcome finding");
      assert.equal(findings.impactSections.count, "other", "a record count is not presented as reach or outcome");
      assert.equal(findings.impactSections.doc, "other", "a document statement is not a measured outcome");
      assert.equal(findings.impactSections.projectB, null, "Project B evidence is absent from Project A");
      assert.equal(findings.impactSections.pairedFirst, null, "the superseded first statement of the same measurement is not an Impact finding");
      assert.ok(!/dictionary_field_presence_fact|source_derived_measurement|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/.test(impact), "no raw types or ids on Impact");
      // Readable measurements (2026-11-07): the recorded label and result lead; the
      // recorded column/worksheet keys are kept in the statement's detail only.
      findings.impactShowsRecordedFieldKeys = /field_\d|sheet_\d/.test(impact);
      assert.equal(findings.impactShowsRecordedFieldKeys, false, "no field_N or sheet_N keys on the Impact screen");
      assert.match(await textOf(adminPage, `[data-impact-finding="${ids.pairedEvidenceId}"] [data-finding-headline]`), /Confidence self-rating/, "the organization's recorded label leads");
      assert.match(await textOf(adminPage, `[data-impact-finding="${ids.pairedEvidenceId}"]`), /4 of 6 comparable participant pairs/, "the recorded result is shown");
      assert.ok(await adminPage.evaluate(`document.querySelector('[data-impact-finding="${ids.pairedEvidenceId}"] [data-finding-recorded-statement]').textContent.includes(${JSON.stringify(findings.pairedStatement)})`),
        "the recorded statement is kept, unchanged, in detail");
      assert.match(impact, /Reach and service delivery[\s\S]*No linked reach measurement is recorded for this Project\./, "reach states honestly that none exists");
      const shownPaired = await textOf(adminPage, `[data-impact-finding="${ids.pairedEvidenceId}"]`);
      console.log(`[impact-paired-card] ${JSON.stringify(shownPaired)} stored=${JSON.stringify(findings.pairedStatement)}`);
      // Evidence: readable findings first; structural facts behind a disclosure.
      await adminPage.tab("Evidence");
      await adminPage.idle();
      const evidence = await dumpView(adminPage, "client evidence A");
      assert.equal(await visible(adminPage, `[data-client-claim="${ids.structuralClaimId}"]`), false, "the structural claim is not on the initial Evidence screen");
      assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}/.test(evidence), "no ids on the initial Evidence screen");
      assert.ok(!/field_\d|sheet_\d/.test(evidence), "no column or worksheet keys on the initial Evidence screen");
      assert.ok(!/No further review is needed/.test(evidence), "no repeated approval line");
      assert.ok(!/\nClaim: /.test(evidence), "claim wording that restates or rephrases the finding is not repeated on the initial screen");
      assert.ok(!/Reviewed for internal use/.test(evidence), "rule-based internal use is not presented as a human review");
      findings.evidenceInitialLength = evidence.length;
    });

    await test("Journey A: Evidence -> select a claim -> visibly to Drafts -> generate -> open and read citations -> back to Evidence with the selection kept; no approval step", { timeout: 240000 }, async () => {
      await openStudio(adminPage, PROJECT_A);
      await adminPage.tab("Evidence");
      await adminPage.idle();
      const row = `[data-client-claim="${ids.countClaimId}"]`;
      await adminPage.waitFor(() => visible(adminPage, row), "the measured claim in Evidence");
      await adminPage.click(`${row} input[type=checkbox]`, null, "select the measured claim");
      await adminPage.waitForText("1/20 selected for a draft");
      await adminPage.click("button", "Create a draft", "Create a draft");
      await adminPage.waitFor(async () => (await activeView(adminPage))[0] === "Drafts", "Drafts view");
      await adminPage.idle();
      const drafts = await dumpView(adminPage, "client drafts A (selection carried)");
      assert.match(drafts, /riverside|programme session/i, "the selected claim is shown in Drafts");
      const before = await query("SELECT count(*)::int AS n FROM kai.generated_content_drafts WHERE organization_id = $1::uuid", [ORG]);
      const mark = adminPage.mark();
      await adminPage.click("button", "Generate internal evidence summary", "Generate internal evidence summary");
      await adminPage.waitForText("Internal evidence summary created");
      await adminPage.idle();
      const sent = writes(adminPage, mark).map((r) => `${r.method} ${new URL(r.url).pathname}`);
      console.log(`[journey-a writes] ${JSON.stringify(sent)}`);
      assert.equal(sent.length, 1, "one generation write, no approval or review request");
      const [draft] = await query(`SELECT d.generated_content_draft_id::text AS id, d.review_status, r.engagement_id::text AS engagement
        FROM kai.generated_content_drafts d JOIN kai.generation_runs r ON r.generation_run_id = d.generation_run_id ORDER BY d.created_at DESC LIMIT 1`);
      assert.equal((await query("SELECT count(*)::int AS n FROM kai.generated_content_drafts WHERE organization_id = $1::uuid", [ORG]))[0].n, before[0].n + 1);
      assert.equal(draft.engagement, PROJECT_A, "the draft belongs to Project A");
      ids.aDraftId = draft.id;
      await adminPage.waitFor(() => visible(adminPage, `[data-client-internal-draft-detail="${draft.id}"]`), "the focused draft reader");
      const reader = await dumpView(adminPage, "client draft reader A");
      assert.ok(await visible(adminPage, `[data-client-internal-draft-citation="${ids.countClaimId}"]`), "the citation is shown");
      findings.readerHasProvisionalLabel = /internal|provisional|not reviewed|ready for internal use/i.test(reader);
      await adminPage.click("[data-client-internal-draft-back]", null, "Back to drafts");
      await adminPage.waitFor(() => visible(adminPage, `[data-client-internal-draft="${draft.id}"]`), "the draft list");
      await adminPage.tab("Evidence");
      await adminPage.waitFor(() => visible(adminPage, `${row} input[type=checkbox]`), "the claim row");
      assert.equal(await adminPage.evaluate(`document.querySelector('${row} input[type=checkbox]').checked`), true, "the selection is kept");
      await adminPage.waitForText("1/20 selected for a draft");
      // Re-open the draft from the list (a previous draft).
      await adminPage.tab("Drafts");
      await adminPage.click(`[data-client-internal-draft="${draft.id}"] button`, null, "Read the draft");
      await adminPage.waitFor(() => visible(adminPage, `[data-client-internal-draft-detail="${draft.id}"]`), "reopened draft");
      await adminPage.click("[data-client-internal-draft-back]", null, "Back to drafts");
    });

    await test("Journey C: switching Project A -> B clears A's selection and findings; a delayed A response cannot overwrite B; back to A reloads A", { timeout: 240000 }, async () => {
      await openStudio(adminPage, PROJECT_A);
      await adminPage.tab("Evidence");
      await adminPage.waitFor(() => visible(adminPage, `[data-client-claim="${ids.countClaimId}"] input[type=checkbox]`), "A's claim");
      await adminPage.click(`[data-client-claim="${ids.countClaimId}"] input[type=checkbox]`, null, "select A's claim");
      await adminPage.waitForText("1/20 selected for a draft");
      // Go to B, then hold A's library responses, select A and switch back to B before they return.
      await adminPage.selectProject(PROJECT_B);
      await adminPage.idle();
      let held = 0;
      await adminPage.holdResponses([{ urlPattern: `*engagement_id=${PROJECT_A}*`, requestStage: "Response" }], async ({ url }) => {
        if (/evidence-library|claim-library|\/sources/.test(url)) { held += 1; await new Promise((r) => setTimeout(r, 3000)); }
      });
      await adminPage.selectProject(PROJECT_A);
      await new Promise((r) => setTimeout(r, 400));
      await adminPage.selectProject(PROJECT_B);
      await new Promise((r) => setTimeout(r, 4500));
      await adminPage.releaseHolds();
      await adminPage.idle();
      await adminPage.tab("Impact");
      await adminPage.idle();
      console.log(`[journey-c held A responses] ${held}`);
      const impactB = await dumpView(adminPage, "client impact B after delayed A");
      assert.ok(impactB.includes(PROJECT_NAMES[PROJECT_B]), "B is the page identity");
      for (const evidenceId of [ids.countEvidenceId, ids.pairedEvidenceId, ids.docEvidenceId]) {
        assert.equal(await adminPage.evaluate(`Boolean(document.querySelector('[data-impact-finding="${evidenceId}"]'))`), false, `A evidence ${evidenceId} absent from B`);
      }
      assert.equal(await adminPage.evaluate(`Boolean(document.querySelector('[data-impact-finding="${ids.bEvidenceId}"]'))`), true, "B's own finding shown");
      await adminPage.tab("Evidence");
      await adminPage.idle();
      assert.equal(await adminPage.evaluate(`Boolean(document.querySelector('[data-client-claim="${ids.countClaimId}"]'))`), false, "A's claim not listed in B");
      assert.ok(!(await adminPage.text()).includes("1/20 selected"), "A's selection is not kept for B");
      await adminPage.selectProject(PROJECT_A);
      await adminPage.idle();
      await adminPage.waitFor(() => visible(adminPage, `[data-client-claim="${ids.countClaimId}"]`), "A's claim after switching back");
      assert.equal(await adminPage.evaluate(`Boolean(document.querySelector('[data-client-claim="${ids.bClaimId}"]'))`), false, "B's claim not in A");
    });

    await test("Journey E: Project B reuses Project A's claim via 'Include evidence from other Projects'; the B draft cites it; after reload, without expansion, it appears in B through the citation", { timeout: 240000 }, async () => {
      await openStudio(adminPage, PROJECT_B);
      await adminPage.tab("Evidence");
      await adminPage.idle();
      assert.equal(await adminPage.evaluate(`Boolean(document.querySelector('[data-client-claim="${ids.countClaimId}"]'))`), false, "A's claim absent by default");
      await adminPage.click("[data-client-include-organization-library]", null, "Include evidence from other Projects");
      await adminPage.idle();
      const row = `[data-client-claim="${ids.countClaimId}"]`;
      await adminPage.waitFor(() => visible(adminPage, row), "A's claim with expansion");
      await adminPage.click(`${row} input[type=checkbox]`, null, "select A's claim in B");
      await adminPage.click("button", "Create a draft", "Create a draft");
      await adminPage.waitFor(async () => (await activeView(adminPage))[0] === "Drafts", "Drafts");
      await dumpView(adminPage, "client drafts B (cross-Project selection)");
      await adminPage.click("button", "Generate internal evidence summary", "Generate internal evidence summary");
      await adminPage.waitForText("Internal evidence summary created");
      await adminPage.idle();
      const [draft] = await query(`SELECT d.generated_content_draft_id::text AS id, r.engagement_id::text AS engagement,
          (SELECT jsonb_agg(c.claim_id::text) FROM kai.generated_content_citations c JOIN kai.generated_content_blocks b ON b.generated_content_block_id = c.generated_content_block_id
            WHERE b.generated_content_draft_id = d.generated_content_draft_id) AS cited
        FROM kai.generated_content_drafts d JOIN kai.generation_runs r ON r.generation_run_id = d.generation_run_id ORDER BY d.created_at DESC LIMIT 1`);
      assert.equal(draft.engagement, PROJECT_B, "the draft belongs to Project B");
      assert.deepEqual(draft.cited, [ids.countClaimId], "it cites Project A's claim");
      ids.bDraftId = draft.id;
      await adminPage.reload();
      await adminPage.waitForText("Knowledge Studio");
      await adminPage.nav("Knowledge Studio");
      await adminPage.waitFor(async () => adminPage.evaluate(`Boolean(document.getElementById("gk-shell-project-select"))`), "selector");
      await adminPage.selectProject(PROJECT_B);
      await adminPage.idle();
      await adminPage.tab("Evidence");
      await adminPage.idle();
      assert.equal(await adminPage.evaluate(`document.querySelector("[data-client-include-organization-library]").checked`), false, "expansion off after reload");
      await adminPage.waitFor(() => visible(adminPage, `[data-client-claim="${ids.countClaimId}"]`), "A's claim appears in B via the draft citation");
      assert.equal(await adminPage.evaluate(`Boolean(document.querySelector('[data-client-claim="${ids.pairedClaimId}"]'))`), false, "A's uncited claims stay absent");
      await adminPage.tab("Drafts");
      await adminPage.waitFor(() => visible(adminPage, `[data-client-internal-draft="${ids.bDraftId}"]`), "the B draft listed in B");
      assert.equal(await adminPage.evaluate(`Boolean(document.querySelector('[data-client-internal-draft="${ids.aDraftId}"]'))`), false, "A's draft is not listed in B");
    });

    await test("Journey D: GK Knowledge Studio scopes Sources, Evidence and Drafts reads to the selected Project; organization-wide work is labelled", { timeout: 240000 }, async () => {
      // B also shows A's session log: B's draft (Journey E) cites A's count claim, and a Project's working view
      // includes evidence reused in its drafts. A's other files were never reused by B.
      for (const [engagementId, own, others] of [
        [PROJECT_A, ["riverside-sessions-sept.csv", "confidence-ratings.xlsx", "mentoring-notes.txt"], ["workshop-log-oct.csv"]],
        [PROJECT_B, ["workshop-log-oct.csv", "riverside-sessions-sept.csv"], ["confidence-ratings.xlsx", "mentoring-notes.txt"]],
      ]) {
        await openStudio(gkPage, engagementId === PROJECT_A ? PROJECT_B : PROJECT_A);
        const mark = gkPage.mark();
        await gkPage.selectProject(engagementId);
        await gkPage.idle();
        for (const view of ["Sources", "Evidence", "Drafts"]) {
          await gkPage.tab(view);
          await gkPage.idle();
          const shown = await dumpView(gkPage, `gk ${view} ${engagementId === PROJECT_A ? "A" : "B"}`);
          if (view === "Sources") {
            for (const name of own) assert.ok(shown.includes(name), `${view}: ${name} shown`);
            for (const name of others) assert.ok(!shown.includes(name), `${view}: unrelated ${name} absent`);
          }
        }
        const reads = gkPage.requestsSince(mark).filter((r) => r.method === "GET").map(pathOf);
        console.log(`[journey-d reads ${engagementId}] ${JSON.stringify(reads)}`);
        const scoped = { sources: /\/organizations\/[^/]+\/sources(\?|$)/, evidence: /\/evidence-library\/candidates/, claims: /\/claim-library\/candidates/, drafts: /\/generated-content-drafts\?/ };
        for (const [fragment, pattern] of Object.entries(scoped)) {
          const matching = reads.filter((r) => pattern.test(r));
          assert.ok(matching.length > 0, `${fragment} read issued`);
          assert.ok(matching.every((r) => r.includes(`engagement_id=${engagementId}`)), `${fragment} reads carry the selected Project: ${JSON.stringify(matching)}`);
        }
        const all = await gkPage.text();
        const wrong = engagementId === PROJECT_A ? [ids.bEvidenceId] : [ids.pairedEvidenceId, ids.docEvidenceId];
        for (const evidenceId of wrong) {
          assert.equal(await gkPage.evaluate(`document.body.innerHTML.includes(${JSON.stringify(evidenceId)})`), false, `unrelated evidence ${evidenceId} absent`);
        }
        findings[`gkOrgWideLabel_${engagementId === PROJECT_A ? "A" : "B"}`] = /Across the organization|whole organization|organization-wide/i.test(all);
      }
      // The organization-wide review queue and gaps are opened on request and labelled.
      await gkPage.tab("Evidence");
      await gkPage.click("button", "Show review queue and gaps", "Show review queue and gaps");
      await gkPage.idle();
      const queue = await dumpView(gkPage, "gk evidence with review queue");
      findings.gkQueueLabelled = /organization/i.test(queue);
    });

    await test("Keyboard and hidden views: the tab order skips hidden views; tabs expose selection; arrow-key behaviour recorded", { timeout: 240000 }, async () => {
      await openStudio(adminPage, PROJECT_A);
      await adminPage.tab("Evidence");
      await adminPage.idle();
      await adminPage.tab("Sources");
      await adminPage.idle();
      await adminPage.tab("Impact");
      await adminPage.idle();
      // Visited views are mounted and hidden.
      const panes = await adminPage.evaluate(`[...document.querySelectorAll("[data-knowledge-studio-view]")].map((el) => [el.dataset.knowledgeStudioView, el.hidden])`);
      console.log(`[panes] ${JSON.stringify(panes)}`);
      assert.ok(panes.some(([, hidden]) => hidden), "visited views stay mounted, hidden");
      await adminPage.evaluate(`document.querySelector('[data-knowledge-studio-tab="impact"]').focus()`);
      const focusPath = [];
      for (let i = 0; i < 60; i += 1) {
        await adminPage.key("Tab", "Tab", 9);
        focusPath.push(await adminPage.evaluate(`(() => { const el = document.activeElement; if (!el || el === document.body) return null;
          return { inHidden: Boolean(el.closest("[hidden]")), visible: el.offsetParent !== null, view: el.closest("[data-knowledge-studio-view]")?.dataset.knowledgeStudioView || null,
            label: (el.innerText || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 40) }; })()`));
      }
      console.log(`[focus-path] ${JSON.stringify(focusPath.filter(Boolean).map((f) => `${f.view || "-"}:${f.label}`))}`);
      assert.ok(focusPath.filter(Boolean).every((f) => !f.inHidden && f.visible), "focus never enters a hidden view");
      // Arrow keys on the tablist (the WAI-ARIA tabs pattern).
      await adminPage.evaluate(`document.querySelector('[data-knowledge-studio-tab="impact"]').focus()`);
      await adminPage.key("ArrowRight", "ArrowRight", 39);
      findings.arrowKeyMoves = await adminPage.evaluate(`document.activeElement?.getAttribute("data-knowledge-studio-tab")`);
      findings.tabSemantics = await adminPage.evaluate(`(() => { const t = document.querySelector('[data-knowledge-studio-tab="impact"]');
        return { role: t.getAttribute("role"), selected: t.getAttribute("aria-selected"), controls: t.getAttribute("aria-controls"), tabindex: t.getAttribute("tabindex"),
          panelsWithRole: document.querySelectorAll("[role=tabpanel]").length }; })()`);
      // Enter/Space activation of a focused tab.
      await adminPage.evaluate(`document.querySelector('[data-knowledge-studio-tab="drafts"]').focus()`);
      await adminPage.key("Enter", "Enter", 13, "\r");
      await adminPage.idle();
      findings.enterActivates = (await activeView(adminPage))[0] === "Drafts";
      console.log(`[keyboard] ${JSON.stringify({ arrow: findings.arrowKeyMoves, semantics: findings.tabSemantics, enter: findings.enterActivates })}`);
      assert.equal(findings.enterActivates, true, "a focused tab activates with Enter");
      assert.equal(findings.arrowKeyMoves, "evidence", "ArrowRight moves focus to the next tab");
      assert.equal(findings.tabSemantics.role, "tab");
      assert.equal(findings.tabSemantics.controls, "knowledge-studio-panel-impact", "each tab names its panel");
      assert.ok(findings.tabSemantics.panelsWithRole >= 1, "views are tab panels");
      assert.ok(await adminPage.evaluate(`(() => { const p = document.getElementById("knowledge-studio-panel-drafts"); return Boolean(p && p.getAttribute("role") === "tabpanel" && p.getAttribute("aria-labelledby") === "knowledge-studio-tab-drafts"); })()`),
        "the Drafts panel is labelled by its tab");
      assert.deepEqual(await adminPage.evaluate(`[...document.querySelectorAll("[data-knowledge-studio-tab]")].map((el) => el.getAttribute("tabindex"))`), ["-1", "-1", "-1", "0"], "only the selected tab is a Tab stop");
      for (const page of [adminPage, gkPage]) {
        await page.tab("Impact");
        await page.key("Home", "Home", 36);
        assert.deepEqual(await activeView(page), ["Sources"], "Home opens the first tab");
        await page.key("ArrowLeft", "ArrowLeft", 37);
        assert.deepEqual(await activeView(page), ["Drafts"], "Left wraps to Drafts");
        await page.key("ArrowRight", "ArrowRight", 39);
        assert.deepEqual(await activeView(page), ["Sources"], "Right wraps to Sources");
        await page.key("ArrowRight", "ArrowRight", 39);
        assert.deepEqual(await activeView(page), ["Impact"]);
        await page.key("End", "End", 35);
        assert.deepEqual(await activeView(page), ["Drafts"]);
      }
      // Ask KAI's input has its own accessible name.
      findings.askKaiLabel = await adminPage.evaluate(`(() => { const input = document.querySelector("[data-knowledge-studio-ask-kai] input"); return input && input.labels && input.labels[0] ? input.labels[0].textContent.trim() : null; })()`);
      assert.match(findings.askKaiLabel || "", /whole organization library/, "Ask KAI input is labelled with its organization-wide scope");
    });

    await test("Sources and GK context: upload first, one primary status per file, detail on request; GK shows the shell's Project, not an empty selector; traceability readable", { timeout: 240000 }, async () => {
      await openStudio(adminPage, PROJECT_A);
      await adminPage.tab("Sources");
      await adminPage.waitFor(() => visible(adminPage, "[data-pipeline-file-primary-status]"), "file rows");
      const order = await adminPage.evaluate(`(() => { const top = (sel) => { const el = document.querySelector('[data-knowledge-studio-view="sources"] ' + sel); return el ? el.getBoundingClientRect().top : null; };
        return { upload: top("[data-intake-studio-heading]"), sources: top("[data-client-data-sources]"), status: top("[data-pipeline-file]") }; })()`);
      console.log(`[sources-order] ${JSON.stringify(order)}`);
      assert.ok(order.upload !== null && order.upload < order.sources && order.sources < order.status, "Add files first, then the sources, then file status");
      assert.ok(await visible(adminPage, '[data-knowledge-studio-view="sources"] input[type=file]'), "the upload input is visible without opening anything");
      const sources = await dumpView(adminPage, "client sources A");
      assert.ok(!/Batch id: |[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}/.test(sources), "no batch or other ids on the initial Sources screen");
      // The pipeline list re-renders while its read refreshes; read it once it is settled.
      await adminPage.waitFor(async () => (await adminPage.evaluate(`document.querySelectorAll("[data-pipeline-file]").length`)) >= 3, "all of Project A's files listed");
      await adminPage.idle();
      const primaries = await adminPage.evaluate(`[...document.querySelectorAll("[data-pipeline-file]")].map((li) => li.querySelectorAll("[data-pipeline-file-primary-status]").length)`);
      assert.ok(primaries.length >= 3 && primaries.every((n) => n === 1), `one primary status per file: ${JSON.stringify(primaries)}`);
      assert.equal((sources.match(/Security check/g) || []).length, 0, "per-stage lists are on request");
      // Detail is still there on request.
      await adminPage.click('[data-pipeline-file] [data-knowledge-studio-disclosure="processing-detail"] button', null, "Processing detail");
      assert.match(await textOf(adminPage, "[data-pipeline-file]"), /Security check/);
      await adminPage.click('[data-knowledge-studio-disclosure="processing-permissions"] button', null, "Correct processing permissions");
      await adminPage.waitFor(() => visible(adminPage, "[data-client-review-processing-permissions]"), "permission correction reachable");
      await adminPage.click('[data-knowledge-studio-disclosure="intake-details"] button', null, "Batches and upload details");
      await adminPage.waitForText("Batch id: ");
      // GK in the shell: readable shared context on Evidence; no misleading empty-selector text.
      await openStudio(gkPage, PROJECT_A);
      await gkPage.tab("Evidence");
      await gkPage.idle();
      const gkEvidence = await dumpView(gkPage, "gk evidence context");
      assert.ok(!/No KAI organization is available|No engagement is available/.test(gkEvidence), "no misleading 'not available' text");
      assert.match(await textOf(gkPage, "[data-gk-shared-context]"), new RegExp(PROJECT_NAMES[PROJECT_A]), "the shell's Project is named");
      assert.ok(!/field_\d|sheet_\d/.test(await textOf(gkPage, "[data-evidence-category], .list-group") || ""), "GK evidence leads with readable text");
    });

    await test("Visual capture and layout: client and GK, four views, desktop and mobile", { timeout: 240000 }, async () => {
      const audits = {};
      for (const [page, kind] of [[adminPage, "client"], [gkPage, "gk"]]) {
        for (const [metrics, size] of [[DESKTOP, "desktop"], [MOBILE, "mobile"]]) {
          await page.viewport(metrics);
          await openStudio(page, PROJECT_A);
          assert.deepEqual(await activeView(page), ["Impact"], `${kind}/${size}: Impact stays the default`);
          assert.deepEqual(await page.evaluate(`[...document.querySelectorAll("[data-knowledge-studio-tab]")].map((el) => el.innerText.trim())`),
            ["Sources", "Impact", "Evidence", "Drafts"]);
          for (const view of ["Sources", "Impact", "Evidence", "Drafts"]) {
            await page.tab(view);
            await page.idle();
            await new Promise((r) => setTimeout(r, 400));
            await page.screenshot(`${kind}-${size}-${view.toLowerCase()}`);
            audits[`${kind}-${size}-${view}`] = await layoutAudit(page);
            audits[`${kind}-${size}-${view}`].tabs = await page.evaluate(`(() => { const tabs = [...document.querySelectorAll("[data-knowledge-studio-tab]")].map((el) => el.getBoundingClientRect());
              const nav = document.querySelector("[data-knowledge-studio-nav]");
              return { rows: new Set(tabs.map((r) => Math.round(r.top))).size, allInView: tabs.every((r) => r.left >= 0 && r.right <= document.documentElement.clientWidth + 1),
                navScrolls: nav ? nav.scrollWidth - nav.clientWidth : null }; })()`);
          }
        }
        await page.viewport(DESKTOP);
      }
      console.log(`[layout] ${JSON.stringify(audits)}`);
      for (const [name, audit] of Object.entries(audits)) {
        assert.ok(audit.overflowX <= 1, `${name}: no horizontal page overflow (${audit.overflowX}px)`);
        assert.equal(audit.tabs.rows, 1, `${name}: the four tabs stay on one row`);
        assert.equal(audit.tabs.allInView, true, `${name}: all four tabs are fully in view`);
        assert.ok(audit.tabs.navScrolls <= 1, `${name}: the tab row fits without scrolling (${audit.tabs.navScrolls}px)`);
      }
      for (const page of [adminPage, gkPage]) assert.deepEqual(page.exceptions, [], "no uncaught page exception");
      console.log(`[findings] ${JSON.stringify(findings)}`);
    });
  } finally {
    await adminPage.close().catch(() => {});
    await gkPage.close().catch(() => {});
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await seedPool.end();
  }
}
