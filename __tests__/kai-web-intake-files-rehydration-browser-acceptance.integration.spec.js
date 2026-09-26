import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Browser acceptance of the Knowledge Studio Files persistence/rehydration
 * repair, run only by
 *   node scripts/kai-client-knowledge-studio-browser-acceptance-local-postgres.js \
 *     __tests__/kai-web-intake-files-rehydration-browser-acceptance.integration.spec.js
 * against that runner's ephemeral loopback PostgreSQL. Skipped otherwise.
 *
 * Real: every KAI router/service/read model on the runner cluster,
 * resolveKaiActorContext with real memberships and global roles (a GK
 * operator for the internal Knowledge Studio, a client_admin for the client one), the built
 * frontend bundle, and a real headless Chrome over the DevTools protocol.
 * Simulated: only the Get Kinder session login (req.user from a harness
 * cookie), and the runner's synthetic mirrors of kai.intake_batches (no
 * repository migration creates it) and of the kai.intake_files columns the
 * file read models select.
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

test("Files browser acceptance isolation: a non-loopback runner URL is refused", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
});

if (!RUNNER_DATABASE_URL || !CHROME || !WORKDIR) {
  test("Files rehydration browser acceptance requires its runner", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_DATABASE_URL);
  await runBrowserAcceptance();
}

// ---------------------------------------------------------------------------
// Minimal Chrome DevTools protocol client (Node's built-in WebSocket), the
// same shape as kai-client-knowledge-studio-browser-acceptance.
// ---------------------------------------------------------------------------

async function launchChrome() {
  const profileDir = join(WORKDIR, "chrome-profile-files");
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
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const requests = [];
  const byId = new Map();
  const exceptions = [];
  const listener = (message) => {
    if (message.sessionId !== sessionId) return;
    const { method, params } = message;
    if (method === "Network.requestWillBeSent" && params.type !== "Document" && params.request.url.includes("/api/")) {
      const entry = { url: params.request.url, method: params.request.method, status: null, done: false, requestId: params.requestId };
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
    throw new Error(`timed out waiting for ${description}\n--- page ---\n${(await text()).slice(0, 3000)}`);
  };
  const waitForText = (needle, options) => waitFor(async () => (await text()).includes(needle), `text: ${needle}`, options);
  const clickWhere = async (description, finder) => {
    const clicked = await evaluate(`(() => { const el = (${finder})(); if (!el) return false; el.click(); return true; })()`);
    if (!clicked) throw new Error(`no visible control: ${description}\n--- page ---\n${(await text()).slice(0, 2000)}`);
  };
  const clickNav = (label) => clickWhere(`nav ${label}`, `() => [...document.querySelectorAll("[role=button], a, button")]
    .filter((el) => el.offsetParent !== null).find((el) => el.innerText.trim() === ${JSON.stringify(label)})`);
  const clickTab = (label) => clickWhere(`tab ${label}`, `() => [...document.querySelectorAll(".nav-tabs button")]
    .filter((el) => el.offsetParent !== null).find((el) => el.innerText.trim() === ${JSON.stringify(label)})`);
  // The "Select" button on the list row that shows `rowText`.
  const selectRow = (rowText) => clickWhere(`Select on ${rowText}`, `() => [...document.querySelectorAll("li")]
    .filter((el) => el.offsetParent !== null && el.innerText.includes(${JSON.stringify(rowText)}))
    .map((li) => [...li.querySelectorAll("button")].find((b) => b.innerText.trim() === "Select")).find(Boolean)`);
  const clickInCard = (heading, label) => clickWhere(`${label} in ${heading}`, `() => {
    const h = [...document.querySelectorAll("h5")].find((el) => el.innerText.trim() === ${JSON.stringify(heading)});
    const card = h && h.closest(".admin-card");
    return card && [...card.querySelectorAll("button")].find((b) => b.innerText.trim() === ${JSON.stringify(label)});
  }`);
  const selectProject = async (engagementId) => {
    const ok = await evaluate(`(() => {
      const el = document.getElementById("gk-shell-project-select");
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
      setter.call(el, ${JSON.stringify(engagementId)});
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
    assert.ok(ok, "project selector present");
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
    clickNav,
    clickTab,
    selectRow,
    clickInCard,
    selectProject,
    async goto(path) {
      await browser.send("Page.navigate", { url: `${baseUrl}${path}` }, sessionId);
      await idle();
    },
    async reload() {
      await browser.send("Page.reload", { ignoreCache: true }, sessionId);
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
  const query = async (sql, params = []) => (await seedPool.query(sql, params)).rows;

  // The organization and file 1 are the repository's synthetic smoke-seed
  // rows; file 1's P1-04/P1-05 lineage (parser run, profile, dictionary,
  // sensitivity profile 80000000-...-0001) is the smoke seed's own.
  const ORG = "00000000-0000-4000-8000-000000000001";
  const PROJECT = Object.freeze({
    alpha: "7b000000-0000-4000-8000-00000000a1f0",
    beta: "7b000000-0000-4000-8000-00000000b2f0",
    gamma: "7b000000-0000-4000-8000-00000000c3f0",
  });
  const BATCH = Object.freeze({
    alpha: "10000000-0000-4000-8000-000000000001",
    beta: "10000000-0000-4000-8000-0000000000b2",
  });
  const FILE = Object.freeze({
    alphaOne: "20000000-0000-4000-8000-000000000001",
    alphaTwo: "20000000-0000-4000-8000-0000000000a2",
    beta: "20000000-0000-4000-8000-0000000000b1",
  });
  const PROFILE_A = "80000000-0000-4000-8000-000000000001";
  const NAMES = Object.freeze({
    alphaBatch: "alpha-intake-2026",
    betaBatch: "beta-intake-2026",
    alphaOne: "gate-a-one.pdf",
    alphaTwo: "alpha-outcomes.csv",
    beta: "beta-roster.csv",
  });
  const USERS = Object.freeze({ gk: 801, clientAdmin: 802 });

  await query(`INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES ($1::uuid, 'Harbourline Synthetic Society', 'harbourline-synthetic')
               ON CONFLICT (organization_id) DO NOTHING`, [ORG]);
  for (const [engagementId, code] of [[PROJECT.alpha, "Project Alpha"], [PROJECT.beta, "Project Beta"], [PROJECT.gamma, "Project Gamma"]]) {
    await query("INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code, project_metadata) VALUES ($1::uuid, $2::uuid, $3, '{}'::jsonb)",
      [engagementId, ORG, code]);
  }
  for (const [legacyId, role, global] of [[USERS.gk, "gk_operator", true], [USERS.clientAdmin, "client_admin", false]]) {
    await query("INSERT INTO public.userdata (id) VALUES ($1) ON CONFLICT DO NOTHING", [legacyId]);
    const kaiUser = await findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: legacyId, email: `user${legacyId}@harbourline.test` });
    await query("INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status) VALUES ($1::uuid, $2::uuid, $3, 'active')",
      [ORG, kaiUser.user_id, role]);
    if (global) {
      await query("INSERT INTO kai.user_roles (user_id, role_id) SELECT $1::uuid, role_id FROM kai.roles WHERE role_name = $2", [kaiUser.user_id, role]);
    }
  }

  // kai.intake_batches and the extra kai.intake_files read columns are the
  // runner's synthetic mirrors (see the runner).
  for (const [batchId, engagementId, code] of [[BATCH.alpha, PROJECT.alpha, NAMES.alphaBatch], [BATCH.beta, PROJECT.beta, NAMES.betaBatch]]) {
    await query(`INSERT INTO kai.intake_batches (intake_batch_id, organization_id, engagement_id, batch_code, processing_status, review_status)
                 VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'received', 'not_reviewed')`, [batchId, ORG, engagementId, code]);
  }
  // File 1 (smoke seed) joins Project Alpha; its verified checksum is the one
  // its seeded parser run was bound to, so the real projection resolves its
  // seeded sensitivity profile.
  // Walked through the real Gate A lifecycle edges (before its seeded
  // upload_expires_at), never a direct jump the lifecycle trigger denies.
  await query(`UPDATE kai.intake_files SET engagement_id = $2::uuid, mime_type = 'application/pdf', file_size_bytes = 1024,
                 malware_scan_status = 'clean', review_status = 'not_reviewed',
                 upload_state = 'upload_started', upload_state_changed_at = '2026-08-02T12:10:00Z'
               WHERE intake_file_id = $1::uuid`, [FILE.alphaOne, PROJECT.alpha]);
  await query(`UPDATE kai.intake_files SET upload_state = 'uploaded_unconfirmed', object_version_id = 'synthetic-v1',
                 upload_state_changed_at = '2026-08-02T12:20:00Z' WHERE intake_file_id = $1::uuid`, [FILE.alphaOne]);
  await query(`UPDATE kai.intake_files SET upload_state = 'confirmed', verified_checksum = checksum, verified_size_bytes = 1024,
                 verified_at = '2026-08-02T12:30:00Z', upload_state_changed_at = '2026-08-02T12:30:00Z' WHERE intake_file_id = $1::uuid`, [FILE.alphaOne]);
  for (const [fileId, batchId, engagementId, name, checksumChar] of [
    [FILE.alphaTwo, BATCH.alpha, PROJECT.alpha, NAMES.alphaTwo, "a"],
    [FILE.beta, BATCH.beta, PROJECT.beta, NAMES.beta, "b"],
  ]) {
    await query(`INSERT INTO kai.intake_files (intake_file_id, intake_batch_id, organization_id, engagement_id, original_filename, safe_filename,
                   checksum, hash_algorithm, upload_state, object_version_id, verified_checksum, verified_size_bytes, verified_at,
                   mime_type, file_size_bytes, malware_scan_status, review_status, created_at)
                 VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $5, repeat($6, 64), 'sha256', 'confirmed', 'synthetic-v1', repeat($6, 64), 512, now(),
                   'text/csv', 512, 'clean', 'not_reviewed', now())`,
      [fileId, batchId, ORG, engagementId, name, checksumChar]);
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

  const INTAKE = "/api/kai/sprint2/intake/admin";
  const isBatchList = (r) => r.method === "GET" && new URL(r.url).pathname === `${INTAKE}/batches`;
  const isBatchFiles = (batchId) => (r) => r.method === "GET" && new URL(r.url).pathname === `${INTAKE}/batches/${batchId}/files`;
  const isAnyBatchFiles = (r) => r.method === "GET" && /\/admin\/batches\/[0-9a-f-]{36}\/files$/.test(new URL(r.url).pathname);
  const isProfileDetail = (profileId) => (r) => r.method === "GET" && new URL(r.url).pathname.endsWith(`/sensitivity-profiles/${profileId}`);
  const shape = (r) => `${r.method} ${new URL(r.url).pathname.replace(ORG, ":org")}${new URL(r.url).search.replace(ORG, ":org")} -> ${r.status}`;
  function logIntake(label, requests) {
    const lines = requests.filter((r) => r.url.includes("/admin/batches") || r.url.includes("/admin/files/") || r.url.includes("sensitivity-profiles"))
      .map(shape);
    console.log(`[files-browser-acceptance] ${label}:\n  ${lines.join("\n  ") || "(none)"}`);
  }
  async function batchCounts() {
    const [row] = await query(`SELECT (SELECT count(*) FROM kai.intake_batches)::int AS batches, (SELECT count(*) FROM kai.intake_files)::int AS files,
      (SELECT count(*) FROM kai.intake_sensitivity_review_decisions)::int AS decisions`);
    return row;
  }

  async function openKnowledgeStudio(page) {
    await page.goto("/impact-library");
    await page.waitForText("Knowledge Studio");
    await page.clickNav("Knowledge Studio");
    await page.waitFor(async () => page.evaluate(`Boolean(document.getElementById("gk-shell-project-select"))`), "project selector");
    await page.idle();
  }

  // Case 1: Project Alpha, Files tab, no manual Load click at any point.
  async function assertAlphaReconstructed(page, label, sinceMark) {
    await page.waitForText(NAMES.alphaOne);
    await page.waitForText(NAMES.alphaTwo);
    await page.idle();
    const since = page.requestsSince(sinceMark);
    logIntake(label, since);
    const lists = since.filter(isBatchList);
    assert.ok(lists.length >= 1, `${label}: batch list read`);
    for (const r of lists) {
      assert.equal(r.status, 200, `${label}: batch list status`);
      assert.match(r.url, new RegExp(`organization_id=${ORG}`));
    }
    const alphaFiles = since.filter(isBatchFiles(BATCH.alpha));
    assert.ok(alphaFiles.length >= 1 && alphaFiles.every((r) => r.status === 200), `${label}: Alpha batch files read (200)`);
    assert.equal(since.filter(isBatchFiles(BATCH.beta)).length, 0, `${label}: Beta files never read while Alpha is active`);
    const body = await page.text();
    assert.ok(body.includes(`Batch id: ${BATCH.alpha}`), `${label}: the sole Alpha batch is selected`);
    assert.ok(body.includes(NAMES.alphaBatch), `${label}: Alpha batch listed`);
    assert.ok(!body.includes(NAMES.betaBatch) && !body.includes(NAMES.beta), `${label}: no Beta batch/file shown under Alpha`);
    assert.ok(!body.includes("No files listed yet."), `${label}: no zero-data state for persisted files`);
  }

  async function runLifecycle({ label, legacyUserId, otherTab, sensitivity }) {
    const before = await batchCounts();
    const page = await openPage(browser, { baseUrl, legacyUserId });
    try {
      await openKnowledgeStudio(page);

      // Case 1 - existing persisted data, reconstructed on Files entry.
      let mark = page.mark();
      await page.selectProject(PROJECT.alpha);
      await assertAlphaReconstructed(page, `${label} case 1 (Files entry, Alpha)`, mark);

      // Case 2 - the original failure: Files -> another tab -> Files.
      await page.clickTab(otherTab);
      await page.idle();
      assert.ok(!(await page.text()).includes(NAMES.alphaOne), `${label}: Files content unmounted on ${otherTab}`);
      mark = page.mark();
      await page.clickTab("Files");
      await assertAlphaReconstructed(page, `${label} case 2 (Files -> ${otherTab} -> Files)`, mark);

      // Case 3 - full reload, then Project Alpha again (the Project is not
      // persisted across a page instance), then Files.
      await page.reload();
      await page.waitForText("Knowledge Studio");
      await page.clickNav("Knowledge Studio");
      await page.waitFor(async () => page.evaluate(`Boolean(document.getElementById("gk-shell-project-select"))`), "project selector after reload");
      await page.idle();
      mark = page.mark();
      await page.selectProject(PROJECT.alpha);
      await assertAlphaReconstructed(page, `${label} case 3 (full reload)`, mark);

      if (sensitivity) {
        // A file-derived sensitivity profile from Project Alpha: select file 1,
        // read its file detail, and the seam reports the seeded P1-05 profile.
        await page.selectRow(NAMES.alphaOne);
        mark = page.mark();
        await page.clickInCard("File status", "Refresh");
        await page.waitForText("Sensitivity profile");
        await page.idle();
        const detail = page.requestsSince(mark).filter((r) => r.method === "GET" && r.url.includes(`/admin/files/${FILE.alphaOne}`));
        assert.ok(detail.length === 1 && detail[0].status === 200, `${label}: file detail read (200)`);
        await page.clickTab("Processing");
        await page.waitForText("Sensitivity & allowed-use review");
        await page.idle();
        assert.ok(page.requests().some(isProfileDetail(PROFILE_A)), `${label}: Alpha file-derived profile ${PROFILE_A} selected and read`);
        await page.clickTab("Files");
        await page.waitForText(NAMES.alphaOne);
        await page.idle();
      }

      // Case 4 - Project switch Alpha -> Beta.
      mark = page.mark();
      await page.selectProject(PROJECT.beta);
      await page.waitForText(NAMES.beta);
      await page.idle();
      let since = page.requestsSince(mark);
      logIntake(`${label} case 4 (Alpha -> Beta)`, since);
      assert.ok(since.some(isBatchList), `${label}: Beta batch list read`);
      assert.ok(since.filter(isBatchFiles(BATCH.beta)).every((r) => r.status === 200) && since.some(isBatchFiles(BATCH.beta)), `${label}: Beta files read (200)`);
      assert.equal(since.filter(isBatchFiles(BATCH.alpha)).length, 0, `${label}: no Alpha batch-files request after Beta became authoritative`);
      let body = await page.text();
      assert.ok(body.includes(`Batch id: ${BATCH.beta}`), `${label}: Beta batch selected`);
      for (const stale of [NAMES.alphaOne, NAMES.alphaTwo, NAMES.alphaBatch, BATCH.alpha]) {
        assert.ok(!body.includes(stale), `${label}: stale Alpha state survived the switch: ${stale}`);
      }
      if (sensitivity) {
        await page.clickTab("Processing");
        await page.idle();
        body = await page.text();
        assert.ok(!body.includes("Sensitivity & allowed-use review"), `${label}: Alpha's file-derived sensitivity profile survived into Beta`);
        await page.clickTab("Files");
        await page.waitForText(NAMES.beta);
        await page.idle();
      }

      // Beta -> Gamma: a genuine loaded-empty state, not stale Beta data.
      mark = page.mark();
      await page.selectProject(PROJECT.gamma);
      await page.waitForText("No intake batches exist for this project yet.");
      await page.idle();
      since = page.requestsSince(mark);
      logIntake(`${label} Beta -> Gamma (no batches)`, since);
      const gammaList = since.filter(isBatchList);
      assert.ok(gammaList.length >= 1 && gammaList.every((r) => r.status === 200), `${label}: Gamma batch list read (200)`);
      assert.equal(since.filter(isAnyBatchFiles).length, 0, `${label}: no batch-files request for a Project with no batch`);
      body = await page.text();
      for (const stale of [NAMES.beta, NAMES.betaBatch, NAMES.alphaOne]) assert.ok(!body.includes(stale), `${label}: stale ${stale} under Gamma`);

      // Intake requests never failed, and the page threw nothing.
      for (const r of page.requests().filter((r) => isBatchList(r) || isAnyBatchFiles(r))) {
        assert.equal(r.status, 200, `${label}: ${shape(r)}`);
      }
      assert.deepEqual(page.exceptions, [], `${label}: page exceptions`);
    } finally {
      await page.close();
    }
    assert.deepEqual(await batchCounts(), before, `${label}: browsing wrote no batch, file, or sensitivity decision`);
  }

  try {
    await test("browser (gk_operator, internal Knowledge Studio): Files rehydration cases 1-4, file-derived sensitivity profile cleared on Project switch, loaded-empty Project", async () => {
      await runLifecycle({ label: "gk_operator", legacyUserId: USERS.gk, otherTab: "Evidence", sensitivity: true });
    });
    await test("browser (client_admin, client Knowledge Studio): Files rehydration cases 1-4 and loaded-empty Project", async () => {
      await runLifecycle({ label: "client_admin", legacyUserId: USERS.clientAdmin, otherTab: "Evidence", sensitivity: false });
    });
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await seedPool.end();
    const { default: ambientPool } = await import("../Backend/db/pg.js");
    await ambientPool.end().catch(() => {});
  }
}
