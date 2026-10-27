import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";

import { programmeSessionWorkbook, SYNTHETIC_XLSX_MIME } from "./support/kaiSyntheticXlsxWorkbook.js";

/**
 * The customer's Excel workbook journey to internal reports, in a real
 * headless Chrome against every mounted KAI route on the runner's ephemeral
 * loopback PostgreSQL (the Plan A normal migration chain, including the P2-01M
 * XLSX worksheet method). Run only by
 *   node scripts/kai-customer-xlsx-file-to-report-local-postgres.js
 * Skipped otherwise.
 *
 * A - a new one-worksheet workbook (one header row, six data rows, one of
 *     them blank, two exact duplicates) whose administrator records every
 *     section 7.2 category absent: actual upload bytes -> P1 worksheet basis
 *     -> promotion -> Count records -> claim -> automatic internal
 *     eligibility -> Evidence Summary and Impact Narrative -> Markdown.
 * B - a workbook already uploaded, profiled and promoted by the previous
 *     application revision (the runner's temporary `git clone --shared`
 *     checkout of the parent commit, loaded in this process and mounted as
 *     its own app on the same database), so its profile has the old shape.
 *     The customer continues it with the existing "Upload again as a new
 *     intake version" action; the old profile, source, promotion and
 *     structural evidence are unchanged.
 * C - a workbook whose administrator records story/testimonial 'present':
 *     measurement, claim, the exact P2-06 reasons, Get Kinder's real evidence,
 *     claim and coverage reviews, eligibility again, generation, and the
 *     internal report download as the current authority answers it.
 * Simulated at external boundaries only: the Get Kinder session (harness
 * cookie), object storage (in-process signed-PUT / exact-generation stand-in),
 * the malware scanner (deterministic clean adapter behind the real assessor),
 * and the model provider (patched SDK Messages.create).
 */

const RUNNER_DATABASE_URL = process.env.KAI_XLSX_ACCEPTANCE_DATABASE_URL;
const RUNNER_DATABASE_NAME = process.env.KAI_XLSX_ACCEPTANCE_DATABASE_NAME;
const CHROME = process.env.KAI_XLSX_ACCEPTANCE_CHROME;
const WORKDIR = process.env.KAI_XLSX_ACCEPTANCE_WORKDIR;
const LEGACY_CHECKOUT = process.env.KAI_XLSX_ACCEPTANCE_LEGACY_CHECKOUT;
const LEGACY_REVISION = process.env.KAI_XLSX_ACCEPTANCE_LEGACY_REVISION;

function assertLoopbackDatabaseUrl(urlString) {
  const host = new URL(urlString).hostname.toLowerCase();
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error(`XLSX acceptance refused a non-loopback database URL host: ${host}`);
  }
}

test("XLSX acceptance isolation: a non-loopback runner URL is refused", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
});

if (!RUNNER_DATABASE_URL || !CHROME || !WORKDIR || !LEGACY_CHECKOUT) {
  test("customer XLSX file-to-report browser acceptance requires its runner", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_DATABASE_URL);
  await runXlsxAcceptance();
}

// ---------------------------------------------------------------------------
// Minimal Chrome DevTools protocol client, the same shape as the other
// Knowledge Studio acceptance specs.
// ---------------------------------------------------------------------------

async function launchChrome() {
  const profileDir = join(WORKDIR, "chrome-profile-plan-a-assembled-file-to-report");
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
  const { browserContextId } = await browser.send("Target.createBrowserContext", { disposeOnDetach: true });
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const requests = [];
  const byId = new Map();
  const exceptions = [];
  const listener = (message) => {
    if (message.sessionId !== sessionId) return;
    const { method, params } = message;
    if (method === "Network.requestWillBeSent" && params.type !== "Document" && /\/api\/|\/synthetic-storage\//.test(params.request.url)) {
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
  const clickNav = (label) => clickWhere(`nav ${label}`, `() => [...document.querySelectorAll("[role=button], a, button")]
    .filter((el) => el.offsetParent !== null).find((el) => el.innerText.trim() === ${JSON.stringify(label)})`);
  const clickTab = (label) => clickWhere(`tab ${label}`, `() => [...document.querySelectorAll(".nav-tabs button")]
    .filter((el) => el.offsetParent !== null).find((el) => el.innerText.trim() === ${JSON.stringify(label)})`);
  const clickButton = (label) => clickWhere(`button ${label}`, `() => [...document.querySelectorAll("button")]
    .filter((el) => el.offsetParent !== null && !el.disabled).find((el) => el.innerText.trim() === ${JSON.stringify(label)})`);
  const clickIn = (selector, description) => clickWhere(description, `() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    return el && el.offsetParent !== null && !el.disabled ? el : null;
  }`);
  const tabLabels = () => evaluate(`[...document.querySelectorAll(".nav-tabs button")].map((el) => el.innerText.trim())`);
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
  // Same-origin JSON request from the signed-in page, as the bundle makes it.
  const api = (method, path, body) => evaluate(`(async () => {
    const response = await fetch(${JSON.stringify(path)}, {
      method: ${JSON.stringify(method)}, credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      ${body === undefined ? "" : `body: ${JSON.stringify(JSON.stringify(body))},`}
    });
    return { status: response.status, body: await response.json() };
  })()`);
  // A user's file selection: set the file on the input, which dispatches its
  // change event exactly as choosing it in the dialog does.
  const chooseFile = async (path) => {
    await evaluate("(() => { const input = document.querySelector('input[type=file]'); input.value = ''; return true; })()");
    const { root } = await browser.send("DOM.getDocument", { depth: -1 }, sessionId);
    const { nodeId } = await browser.send("DOM.querySelector", { nodeId: root.nodeId, selector: "input[type=file]" }, sessionId);
    await browser.send("DOM.setFileInputFiles", { nodeId, files: [path] }, sessionId);
  };
  // Text of the Files tab's per-file processing entry.
  const pipelineFileText = (intakeFileId) => evaluate(`(() => {
    const el = document.querySelector('[data-pipeline-file="${intakeFileId}"]');
    return el ? el.innerText : null;
  })()`);
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
    clickButton,
    clickIn,
    tabLabels,
    selectProject,
    api,
    chooseFile,
    pipelineFileText,
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

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function runXlsxAcceptance() {
  const J = JSON.stringify;
  const XLSX_METHOD = "p1_xlsx_single_worksheet_data_rows_excluding_blank_v1";
  process.env.KAI_PUBLIC_EXPORT_ENABLED = "true";
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-unused-dummy-key";
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const messagesPrototype = Object.getPrototypeOf(new Anthropic({ apiKey: "sk-ant-test-unused-dummy-key" }).messages);
  const modelCalls = [];
  const COMPLIANT_TEXT = "The promoted source records 5 programme sessions for the reporting period 2026-09-01 to 2026-09-30. "
    + "This is a count of source records, each counted as one programme session under the human-confirmed definition; "
    + "the period is attested in that definition and not verified against record dates. "
    + "1 blank record was excluded and 2 exact-duplicate records were included. "
    + "Internal limitations: small-cell risk, conflicting source indicators, and requirement alignment are carried with the count for internal use only.";
  const modelOverride = { text: null };
  messagesPrototype.create = async function deterministicCreate(payload) {
    const requestBody = JSON.parse(payload.messages[0].content);
    modelCalls.push({ claims: requestBody.claims });
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          approved: true,
          draftStatus: "released",
          blocks: requestBody.claims.map((claim) => ({ text: modelOverride.text ?? COMPLIANT_TEXT, citations: [{ claimId: claim.claimId, evidenceItemId: claim.evidenceItemId }] })),
        }),
      }],
    };
  };

  const { Pool } = await import("pg");
  const express = (await import("express")).default;
  const ambientPool = (await import("../Backend/db/pg.js")).default;
  const seedPool = new Pool({ connectionString: RUNNER_DATABASE_URL, ssl: false, max: 4 });
  const { findOrCreateKaiUserByLegacyPublicUserdataId } = await import("../Backend/kai/db/kaiQueries.js");
  const { profileLocalTrustedFile } = await import("../Backend/kai/profiling/localProfilingKernel.js");
  const {
    BASE_PATH,
    claimReviewCompletePath,
    claimReviewDecisionBody,
    claimTraceabilityPath,
    clientInternalReportMarkdownPath,
    evidenceReviewCompletePath,
    evidenceReviewDecisionBody,
    evidenceExtractionPath,
    claimProposalPath,
    clientReleasedReportMarkdownPath,
    generatedContentReviewCompletePath,
    generatedContentReviewStartPath,
    sourceCandidateDecisionPath,
  } = await import("../frontend/impactEvidenceLibraryLogic.js");
  const { batchFilesPath, confirmUploadPath, createBatchPath, fileReservationsPath, requestUploadUrlPath } = await import("../frontend/kaiWebIntakeLogic.js");
  const { sourceRecordCountMeasurementPath } = await import("../frontend/knowledgeStudio/clientSourceMeasurementLogic.js");
  const { organizationFactualReviewPath } = await import("../frontend/knowledgeStudio/clientMeasuredClaimReviewLogic.js");
  const query = async (sql, params = []) => (await seedPool.query(sql, params)).rows;

  const ambientTarget = (await ambientPool.query("SELECT current_database() AS database_name, inet_server_addr()::text AS server_addr")).rows[0];
  assert.equal(ambientTarget.database_name, RUNNER_DATABASE_NAME);
  assert.ok(["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(ambientTarget.server_addr));

  // The application revision the legacy workbook was promoted with: the
  // runner's checkout of the parent commit, a separate module graph.
  const legacy = {
    router: (await import(join(LEGACY_CHECKOUT, "Backend/kai/routes/sprint2IntakeApi.js"))).default,
    config: await import(join(LEGACY_CHECKOUT, "Backend/kai/config/kaiSprint2Config.js")),
    auth: await import(join(LEGACY_CHECKOUT, "Backend/kai/middleware/kaiSprint2Authentication.js")),
    runtimeService: await import(join(LEGACY_CHECKOUT, "Backend/kai/services/kaiIntakeRuntimeService.js")),
    upload: await import(join(LEGACY_CHECKOUT, "Backend/kai/upload/postgresUploadLifecycleRepository.js")),
    executor: await import(join(LEGACY_CHECKOUT, "Backend/kai/security/internalSecurityAssessmentExecutor.js")),
    assessor: await import(join(LEGACY_CHECKOUT, "Backend/kai/security/boundedFileSecurityAssessor.js")),
    dispatch: await import(join(LEGACY_CHECKOUT, "Backend/kai/parsing/p1FileDispatch.js")),
    kernel: await import(join(LEGACY_CHECKOUT, "Backend/kai/profiling/localProfilingKernel.js")),
    pool: (await import(join(LEGACY_CHECKOUT, "Backend/db/pg.js"))).default,
  };
  const current = {
    router: (await import("../Backend/kai/routes/sprint2IntakeApi.js")).default,
    config: await import("../Backend/kai/config/kaiSprint2Config.js"),
    auth: await import("../Backend/kai/middleware/kaiSprint2Authentication.js"),
    runtimeService: await import("../Backend/kai/services/kaiIntakeRuntimeService.js"),
    upload: await import("../Backend/kai/upload/postgresUploadLifecycleRepository.js"),
    executor: await import("../Backend/kai/security/internalSecurityAssessmentExecutor.js"),
    assessor: await import("../Backend/kai/security/boundedFileSecurityAssessor.js"),
    dispatch: await import("../Backend/kai/parsing/p1FileDispatch.js"),
  };
  assert.notEqual(legacy.router, current.router, "two distinct application revisions are loaded");

  const ORG_X = "0f000000-0000-4000-8000-0000000000a1";
  const ORG_Y = "0f000000-0000-4000-8000-0000000000b1";
  const PROJECT_X = "7f000000-0000-4000-8000-0000000000e1";
  const PROJECT_X2 = "7f000000-0000-4000-8000-0000000000e3";
  const PROJECT_Y = "7f000000-0000-4000-8000-0000000000e2";
  const USERS = Object.freeze({ gkReviewer: 991, gkAdmin: 992, clientAdmin: 993, contributor: 994, clientReviewer: 995, adminY: 997 });

  // The customer's workbooks: the same established programme-session log
  // (header + 6 data rows: 1 blank, 2 exact duplicates, so 5 counted), each
  // with its own run tag so the bytes differ.
  const filesDir = join(WORKDIR, "customer-files");
  mkdirSync(filesDir, { recursive: true });
  const customerFile = (name, bytes) => {
    const path = join(filesDir, name);
    writeFileSync(path, bytes);
    return { name, path, bytes: Buffer.from(bytes), checksum: sha256(bytes) };
  };
  const ORDINARY = customerFile("programme-sessions-a.xlsx", programmeSessionWorkbook({ tag: "a" }));
  const LEGACY = customerFile("programme-sessions-legacy.xlsx", programmeSessionWorkbook({ tag: "legacy" }));
  const STORY = customerFile("programme-sessions-stories.xlsx", programmeSessionWorkbook({ tag: "story" }));
  const TWO_SHEETS = customerFile("programme-sessions-two-sheets.xlsx", programmeSessionWorkbook({ tag: "two", extraSheet: true }));
  // Independent count of the workbook's rows, sharing no code with KAI: the
  // fixture's own row list (header, 6 data rows, row 4 blank, rows 5 and 6 identical).
  const independent = { dataRecords: 6, blankRecords: 1, duplicateRecords: 2, counted: 5 };

  // --- organizations, Projects, GK bindings, users (authorized setup) -------
  for (const [organizationId, name, code] of [[ORG_X, "Harbourline Workbook Society", "harbourline-xlsx"], [ORG_Y, "Larchmont Workbook Society", "larchmont-xlsx"]]) {
    await query("INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES ($1::uuid, $2, $3)", [organizationId, name, code]);
  }
  for (const [engagementId, organizationId, code] of [[PROJECT_X, ORG_X, "Workbook Programme 2026"], [PROJECT_X2, ORG_X, "Second Project"], [PROJECT_Y, ORG_Y, "Larchmont Project"]]) {
    await query("INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code, project_metadata) VALUES ($1::uuid, $2::uuid, $3, '{}'::jsonb)", [engagementId, organizationId, code]);
  }
  for (const legacyId of Object.values(USERS)) await query("INSERT INTO public.userdata (id) VALUES ($1) ON CONFLICT DO NOTHING", [legacyId]);
  for (const [organizationId, name, admins] of [[ORG_X, "Harbourline Workbook Society", [USERS.clientAdmin]], [ORG_Y, "Larchmont Workbook Society", [USERS.adminY]]]) {
    const [gkOrganization] = await query("INSERT INTO public.organizations (name, status) VALUES ($1, 'approved') RETURNING id", [name]);
    await query("INSERT INTO kai.gk_organization_bindings (gk_organization_id, kai_organization_id, status) VALUES ($1, $2::uuid, 'active')", [gkOrganization.id, organizationId]);
    for (const userId of admins) await query("INSERT INTO public.user_org_memberships (org_id, user_id, role, is_active) VALUES ($1, $2, 'admin', true)", [gkOrganization.id, userId]);
  }
  const membership = async (legacyId, roleName, organizations = [ORG_X], globalRole = null) => {
    const user = await findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: legacyId, email: `user${legacyId}@harbourline.test` });
    for (const organizationId of organizations) {
      await query("INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status) VALUES ($1::uuid, $2::uuid, $3, 'active')", [organizationId, user.user_id, roleName]);
    }
    if (globalRole) await query("INSERT INTO kai.user_roles (user_id, role_id) SELECT $1::uuid, role_id FROM kai.roles WHERE role_name = $2", [user.user_id, globalRole]);
    return user;
  };
  const gkReviewerUser = await membership(USERS.gkReviewer, "gk_reviewer", [ORG_X, ORG_Y], "gk_reviewer");
  await membership(USERS.gkAdmin, "gk_admin", [ORG_X], "gk_admin");
  await membership(USERS.contributor, "client_contributor");
  await membership(USERS.clientReviewer, "client_reviewer");

  // --- external boundaries, shared by both application revisions -------------
  const objects = new Map();
  const signedTargets = new Map();
  let generation = 1770000000000001n;
  let baseUrl = "";
  const syntheticProvenance = Object.freeze({ adapter_id: "kai_synthetic_fixture_adapter", signature_set: "v1" });
  const storage = Object.freeze({
    enabled: true,
    async createSignedUploadUrl({ objectKey, contentType }) {
      const token = randomUUID();
      signedTargets.set(token, { objectKey, contentType });
      return { ok: true, data: { url: `${baseUrl}/synthetic-storage/${token}`, method: "PUT", headers: { "Content-Type": contentType }, expires_in_seconds: 900 } };
    },
    async headObject({ objectKey }) {
      const stored = objects.get(objectKey);
      if (!stored) return { ok: false, error: { code: "not_found" } };
      return { ok: true, data: { candidate_generation: stored.generation, size_bytes: stored.bytes.byteLength } };
    },
    async statExactGeneration({ objectKey, gcsGeneration }) {
      const stored = objects.get(objectKey);
      if (!stored || stored.generation !== gcsGeneration) return { ok: false, error: { code: "not_found" } };
      return { ok: true, data: { size_bytes: stored.bytes.byteLength } };
    },
    async openExactGenerationReadStream({ objectKey, gcsGeneration }) {
      const stored = objects.get(objectKey);
      if (!stored || stored.generation !== gcsGeneration) return { ok: false, error: { code: "not_found" } };
      return { ok: true, data: { size_bytes: stored.bytes.byteLength, byte_source: Readable.from([Buffer.from(stored.bytes)]) } };
    },
  });
  const malwareScanAdapter = Object.freeze({ async scan() { return { status: "clean", provenance: { ...syntheticProvenance } }; } });
  const runtimeFor = (revision) => Object.freeze({
    env: process.env,
    gcsProvider: storage,
    gcsUploadSignerProvider: storage,
    gcsParserReaderProvider: storage,
    uploadLifecycleRepository: revision.upload.createPostgresUploadLifecycleRepository(),
    internalSecurityAssessmentExecutor: revision.executor.createInternalSecurityAssessmentExecutor({
      assessor: (input) => revision.assessor.assessBoundedFileSecurity(input, { malwareScanAdapter }),
    }),
  });
  const restoreLegacyRuntime = legacy.runtimeService.setKaiIntakeRuntimeDependenciesForTest(runtimeFor(legacy));
  const restoreRuntime = current.runtimeService.setKaiIntakeRuntimeDependenciesForTest(runtimeFor(current));
  const legacyDispatcher = legacy.dispatch.getKaiP1FileDispatcher();
  const dispatcher = current.dispatch.getKaiP1FileDispatcher();

  const harnessSession = (req, _res, next) => {
    const match = /(?:^|;\s*)kai_harness_user=(\d+)/.exec(req.headers.cookie || "");
    if (match) req.user = { id: Number(match[1]), email: `user${match[1]}@harbourline.test` };
    req.isAuthenticated = () => Boolean(req.user);
    next();
  };
  const publicDir = new URL("../public/", import.meta.url).pathname;
  const app = express();
  app.put("/synthetic-storage/:token", express.raw({ type: () => true, limit: "10mb" }), (req, res) => {
    const target = signedTargets.get(req.params.token);
    if (!target || req.get("content-type") !== target.contentType) return res.status(403).end();
    generation += 1n;
    objects.set(target.objectKey, { bytes: Buffer.from(req.body), generation: generation.toString() });
    return res.status(200).end();
  });
  app.use(express.json());
  app.use(harnessSession);
  app.use("/api/kai/sprint2/intake", current.config.requireKaiSprint2Enabled, current.auth.requireKaiSprint2Authenticated, current.router);
  app.get("/impact-library", (_req, res) => res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><title>Impact Library</title>
    <link rel="stylesheet" href="/css/style.css" /><link rel="stylesheet" href="/css/gk-design-tokens.css" /></head>
    <body><div id="impact-evidence-library-root"></div><script src="/js/bundles/entry.js"></script>
    <script>window.renderImpactEvidenceLibrary();</script></body></html>`));
  app.use(express.static(publicDir));
  const server = await new Promise((resolve) => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  // The previous revision's API, mounted alone on its own port.
  const legacyApp = express();
  legacyApp.use(express.json());
  legacyApp.use(harnessSession);
  legacyApp.use("/api/kai/sprint2/intake", legacy.config.requireKaiSprint2Enabled, legacy.auth.requireKaiSprint2Authenticated, legacy.router);
  const legacyServer = await new Promise((resolve) => { const listening = legacyApp.listen(0, "127.0.0.1", () => resolve(listening)); });
  const legacyBaseUrl = `http://127.0.0.1:${legacyServer.address().port}`;

  // A signed-in HTTP client of one application revision (the bundle's own
  // same-origin JSON requests, made from Node with the session cookie).
  const client = (origin, legacyUserId) => async (method, path, body) => {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Accept: "application/json", Cookie: `kai_harness_user=${legacyUserId}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: response.status, body: parsed, disposition: response.headers.get("content-disposition") };
  };
  const legacyAdmin = client(legacyBaseUrl, USERS.clientAdmin);
  const adminApi = client(baseUrl, USERS.clientAdmin);
  const gkApi = client(baseUrl, USERS.gkReviewer);
  const gkAdminApi = client(baseUrl, USERS.gkAdmin);
  const contributorApi = client(baseUrl, USERS.contributor);
  const reviewerApi = client(baseUrl, USERS.clientReviewer);
  const adminYApi = client(baseUrl, USERS.adminY);

  const browser = await launchChrome();
  const adminPage = await openPage(browser, { baseUrl, legacyUserId: USERS.clientAdmin });

  const COCKPIT = `${BASE_PATH}/admin/review-cockpit`;
  const orgPath = (organizationId = ORG_X) => `${BASE_PATH}/admin/organizations/${organizationId}`;
  const sensitivityDecisionPath = (organizationId, profileId) => `${COCKPIT}/sensitivity-profiles/${profileId}/decision?organization_id=${organizationId}`;
  const pathOf = (request) => new URL(request.url).pathname;
  const textOf = (page, selector) => page.evaluate(`(() => { const el = document.querySelector(${J(selector)}); return el ? el.textContent : null; })()`);
  const setInput = (page, selector, value) => page.evaluate(`(() => {
    const el = document.querySelector(${J(selector)});
    if (!el) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${J(value)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  const fetchText = (page, path) => page.evaluate(`(async () => {
    const response = await fetch(${J(path)}, { credentials: "same-origin" });
    return { status: response.status, disposition: response.headers.get("content-disposition"), body: await response.text() };
  })()`);
  const queueOf = async (queueType, targetId) => (await query(
    "SELECT review_queue_item_id::text, queue_status, updated_at FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = $2 AND target_object_id = $3::uuid",
    [ORG_X, queueType, targetId]))[0];
  const fileByName = async (name) => (await query(
    `SELECT intake_file_id::text, original_intake_file_id::text, supersedes_intake_file_id::text, force_new_version, file_policy_status
       FROM kai.intake_files WHERE organization_id = $1::uuid AND original_filename = $2 ORDER BY created_at`, [ORG_X, name]));
  const sensitivityOf = async (intakeFileId) => (await query(
    `SELECT s.intake_sensitivity_profile_id::text, s.file_profile_id::text, q.review_queue_item_id::text, q.updated_at
       FROM kai.intake_sensitivity_profiles s JOIN kai.review_queue_items q ON q.target_object_id = s.intake_sensitivity_profile_id AND q.queue_type = 'sensitivity_review'
      WHERE s.intake_file_id = $1::uuid`, [intakeFileId]))[0];
  const candidateOf = async (sensitivityProfileId) => (await query(
    "SELECT intake_source_candidate_id::text FROM kai.intake_source_candidates WHERE intake_sensitivity_profile_id = $1::uuid", [sensitivityProfileId]))[0];
  const versionOf = async (sensitivityProfileId) => (await query(
    `SELECT source_version_id::text, source_id::text, is_current, profile_canonical_sha256, intake_source_candidate_id::text
       FROM kai.source_versions WHERE intake_sensitivity_profile_id = $1::uuid`, [sensitivityProfileId]))[0];
  const profileRowOf = async (fileProfileId) => (await query(
    "SELECT file_profile_id::text, parser_version, profile, profile_canonical_sha256 FROM kai.intake_file_profiles WHERE file_profile_id = $1::uuid", [fileProfileId]))[0];
  // Every row that would be a human approval, review, follow-up or release, for one claim's lineage.
  const approvalState = async () => (await query(`SELECT
      (SELECT count(*) FROM kai.evidence_review_decisions WHERE organization_id = $1::uuid)::int AS evidence_decisions,
      (SELECT count(*) FROM kai.claim_review_decisions WHERE organization_id = $1::uuid)::int AS claim_decisions,
      (SELECT count(*) FROM kai.coverage_review_decisions WHERE organization_id = $1::uuid)::int AS coverage_decisions,
      (SELECT count(*) FROM kai.client_followup_items WHERE organization_id = $1::uuid)::int AS client_followups,
      (SELECT count(*) FROM kai.human_authority_decisions WHERE organization_id = $1::uuid)::int AS release_decisions,
      (SELECT count(*) FROM kai.export_manifests WHERE organization_id = $1::uuid)::int AS manifests`, [ORG_X]))[0];
  const SNAPSHOT = Object.freeze({
    reviewed_personal_data_status: "absent", reviewed_minor_data_status: "absent", reviewed_health_housing_justice_immigration_status: "absent",
    reviewed_indigenous_governance_status: "absent", reviewed_staff_notes_status: "absent", reviewed_story_testimonial_status: "absent",
    reviewed_small_cell_risk_status: "absent", reviewed_financial_records_status: "absent", reviewed_consent_basis_status: "unknown",
    reviewed_allowed_use_status: "allowed", reviewed_llm_processing_allowed: true, reviewed_product_learning_allowed: false,
    reviewed_public_use_allowed: false, reviewed_funder_use_allowed: false,
  });
  const DEFINITION = Object.freeze({
    counted_unit: "programme session", unit_label: "programme sessions",
    definition_text: "Each row of the session log records one delivered programme session.",
    inclusion_rule: "Every data row after the header row that has at least one value.",
    exclusion_rule: "The header row and empty rows.", period_start: "2026-09-01", period_end: "2026-09-30",
  });

  // Upload through an application revision's API, exactly the bundle's
  // sequence: reserve -> signed URL -> PUT -> confirm (then P1 runs).
  const apiUpload = async (api, file, batchId, { duplicateOf = null } = {}) => {
    const reserved = await api("POST", fileReservationsPath(batchId), {
      organization_id: ORG_X, engagement_id: PROJECT_X, original_filename: file.name, file_extension: ".xlsx", mime_type: SYNTHETIC_XLSX_MIME,
      file_size_bytes: file.bytes.byteLength, checksum: file.checksum, hash_algorithm: "sha256", idempotency_key: `file-${randomUUID()}`,
      ...(duplicateOf ? { force_new_version: true, duplicate_of_intake_file_id: duplicateOf } : {}),
    });
    assert.ok([200, 201].includes(reserved.status), J(reserved.body));
    const intakeFileId = reserved.body.data.intake_file_id;
    const signed = await api("POST", requestUploadUrlPath(batchId), { organization_id: ORG_X, engagement_id: PROJECT_X, intake_file_id: intakeFileId });
    assert.equal(signed.status, 200, J(signed.body));
    const put = await fetch(signed.body.data.upload_url, { method: signed.body.data.upload_method, headers: signed.body.data.upload_headers, body: file.bytes });
    assert.equal(put.status, 200);
    const confirmed = await api("POST", confirmUploadPath(ORG_X, intakeFileId), { organization_id: ORG_X });
    assert.equal(confirmed.status, 200, J(confirmed.body));
    return intakeFileId;
  };
  // The administrator's sensitivity / allowed-use / AI decision and promotion
  // through an application revision's API (the requests the Data Sources
  // panels send).
  const decideAndPromote = async (api, intakeFileId, snapshot = SNAPSHOT) => {
    const sensitivity = await sensitivityOf(intakeFileId);
    assert.ok(sensitivity, "the P1 worker created the sensitivity profile and its review item");
    const decided = await api("POST", sensitivityDecisionPath(ORG_X, sensitivity.intake_sensitivity_profile_id), {
      expected_updated_at: new Date(sensitivity.updated_at).toISOString(), review_queue_item_id: sensitivity.review_queue_item_id,
      decision: "reviewed", reviewed_snapshot: snapshot,
    });
    assert.equal(decided.status, 200, J(decided.body));
    const candidate = await candidateOf(sensitivity.intake_sensitivity_profile_id);
    const promoted = await api("POST", sourceCandidateDecisionPath(ORG_X, candidate.intake_source_candidate_id), {
      outcome: "promoted", reviewed_source_type: "organization_primary_record",
    });
    assert.equal(promoted.status, 200, J(promoted.body));
    return { ...sensitivity, ...candidate, ...(await versionOf(sensitivity.intake_sensitivity_profile_id)) };
  };
  const internalEligibility = async (claimId, audience = "internal") => {
    const traced = await gkApi("GET", claimTraceabilityPath(ORG_X, claimId, audience));
    assert.equal(traced.status, 200, J(traced.body));
    return { eligible: traced.body.data.eligible, blockerCodes: traced.body.data.blockerCodes, dimensions: traced.body.data.dimensions };
  };
  const generate = async (api, contentType, claimIds, key) => api("POST", `${orgPath()}/generated-content-drafts/${contentType}`,
    { claim_ids: claimIds, idempotency_key: key, engagement_id: PROJECT_X });

  // Knowledge Studio for the organization administrator, on a tab of Project X.
  const openStudioTab = async (tabLabel) => {
    await adminPage.goto("/impact-library");
    await adminPage.waitForText("Knowledge Studio");
    await adminPage.clickNav("Knowledge Studio");
    await adminPage.waitFor(async () => adminPage.evaluate(`Boolean(document.getElementById("gk-shell-project-select"))`), "project selector");
    await adminPage.idle();
    await adminPage.clickTab(tabLabel);
    await adminPage.idle();
    await adminPage.selectProject(PROJECT_X);
    await adminPage.idle();
  };
  // Count records in Data Sources: open the panel, read the server's basis.
  const openCountRecords = async (sourceVersionId) => {
    await openStudioTab("Data Sources");
    await adminPage.waitFor(async () => Boolean(await textOf(adminPage, `[data-client-open-source-measurement="${sourceVersionId}"]`)), `Count records for ${sourceVersionId}`);
    await adminPage.clickIn(`[data-client-open-source-measurement="${sourceVersionId}"]`, "Count records");
    await adminPage.waitFor(async () => Boolean(await textOf(adminPage, "[data-client-source-measurement-counts]"))
      || Boolean(await textOf(adminPage, "[data-client-source-measurement-unmeasurable]")), "the measurement basis");
    await adminPage.idle();
  };
  const recordCountInUi = async (sourceVersionId) => {
    for (const [field, value] of [
      ["countedUnit", DEFINITION.counted_unit], ["unitLabel", DEFINITION.unit_label], ["definitionText", DEFINITION.definition_text],
      ["inclusionRule", DEFINITION.inclusion_rule], ["exclusionRule", DEFINITION.exclusion_rule],
      ["periodStart", DEFINITION.period_start], ["periodEnd", DEFINITION.period_end],
    ]) assert.ok(await setInput(adminPage, `[data-client-source-measurement-field="${field}"]`, value), field);
    await adminPage.waitForText("Confirm that the reporting period is your organization's statement.");
    await adminPage.clickIn('[data-client-source-measurement-field="periodAttested"]', "attest period");
    const mark = adminPage.mark();
    await adminPage.clickIn("[data-client-source-measurement-submit]", "Record definition and count");
    await adminPage.waitForText(`Measurement: ${independent.counted} programme sessions`);
    await adminPage.idle();
    assert.deepEqual(adminPage.requestsSince(mark).filter((r) => r.method === "POST").map((r) => [pathOf(r), r.status]),
      [[sourceRecordCountMeasurementPath(ORG_X, sourceVersionId).split("?")[0], 200]]);
    const [measurement] = await query(
      `SELECT m.evidence_item_id::text, m.measured_value::int, m.total_record_count::int, m.blank_record_count::int, m.duplicate_record_count::int,
              m.calculation_method, l.coordinates, e.statement, e.source_locator_id::text
         FROM kai.evidence_measurements m JOIN kai.evidence_items e ON e.evidence_item_id = m.evidence_item_id
         JOIN kai.source_locators l ON l.source_locator_id = e.source_locator_id
        WHERE m.organization_id = $1::uuid AND m.source_version_id = $2::uuid`, [ORG_X, sourceVersionId]);
    await adminPage.clickIn(`[data-client-source-measurement-propose-claim="${measurement.evidence_item_id}"]`, "Propose a claim");
    await adminPage.waitForText(`Claim: The promoted source records ${independent.counted} programme sessions`);
    const [claim] = await query("SELECT claim_id::text, statement FROM kai.claims WHERE organization_id = $1::uuid AND evidence_item_id = $2::uuid",
      [ORG_X, measurement.evidence_item_id]);
    return { measurement, claim };
  };
  const assertWorkbookMeasurement = ({ measurement, claim }) => {
    assert.deepEqual([measurement.measured_value, measurement.total_record_count, measurement.blank_record_count, measurement.duplicate_record_count],
      [independent.counted, independent.dataRecords, independent.blankRecords, independent.duplicateRecords]);
    assert.equal(measurement.calculation_method, XLSX_METHOD);
    assert.deepEqual(measurement.coordinates, { scope: "data_records_after_header", sheet_key: "sheet_1" }, "the worksheet locator");
    assert.match(measurement.statement, /counting each worksheet data row after the header row as one programme session; 1 blank record excluded; 2 exact-duplicate records included\.$/);
    assert.equal(claim.statement, "The promoted source records 5 programme sessions for the reporting period 2026-09-01 to 2026-09-30 "
      + "(record count: one programme session per worksheet data row; 1 blank record excluded, 2 exact-duplicate records included).");
  };
  // A complete internal report of the workbook count, with no unsupported conclusion.
  const assertWorkbookReport = (shown, heading, { claimId, evidenceItemId, sourceVersionId }) => {
    assert.ok(shown.startsWith(`${heading}\n`), shown.slice(0, 80));
    assert.equal(Number((/records \*\*(\d+) programme sessions\*\*/.exec(shown) || [])[1]), independent.counted);
    assert.match(shown, /for the reporting period 2026-09-01 to 2026-09-30/);
    assert.match(shown, new RegExp(`\`${XLSX_METHOD}\`: every data row after the header row of the only worksheet of the exact promoted source version is one record`));
    assert.match(shown, /6 data records after the header, minus 1 blank record excluded = \*\*5\*\* counted/);
    assert.match(shown, /2 exact-duplicate records\. They are included in the count of 5, not removed or merged/);
    assert.match(shown, /## What this evidence does not establish[\s\S]*distinct people[\s\S]*outcome[\s\S]*caused any result/);
    assert.doesNotMatch(shown, /CSV data record/, "the calculation names the workbook's method, not CSV");
    for (const id of [claimId, evidenceItemId, sourceVersionId]) assert.ok(shown.includes(`\`${id}\``), id);
    assert.doesNotMatch(shown, /field_\d/, "never a field-presence claim in place of the measured result");
    assert.doesNotMatch(shown, /literacy|mentoring|facilitator|F1|F2|2026-09-02|programme-sessions-|run_tag/, "no cell values, column names or file names");
    // What the report affirms (not its explicit list of what it does not establish).
    const section = (from, to) => shown.slice(shown.indexOf(`\n## ${from}\n`), shown.indexOf(`\n## ${to}\n`));
    for (const affirmed of [section("Key findings", "Reporting period"), section("What this evidence establishes", "What this evidence does not establish"),
      section("Generated narrative", "Source and evidence traceability")]) {
      assert.ok(affirmed.length > 20, "section present");
      assert.doesNotMatch(affirmed, /participants|people|unique|improv|outcome|because of|caused|increase|impact/i, "no participant, outcome, rate or causal claim");
    }
  };

  const results = { simulatedBoundaries: ["session (harness cookie)", "object storage (in-process stand-in)", "malware scanner (clean adapter behind the real assessor)", "model provider (patched SDK)"] };
  const ids = {};
  try {
    await adminPage.goto("/impact-library");
    const [admin] = await query("SELECT user_id::text FROM kai.users WHERE legacy_public_userdata_id = $1", [USERS.clientAdmin]);
    ids.adminUserId = admin?.user_id;

    // -----------------------------------------------------------------------
    // B, part 1 (history): the previous revision uploads, profiles and
    // promotes a workbook, and extracts its structural evidence and a claim.
    // -----------------------------------------------------------------------
    await test(`B1: the previous revision (${LEGACY_REVISION}) uploads, profiles and promotes a workbook with the old profile shape, and extracts its structural evidence`, async () => {
      const batch = await legacyAdmin("POST", createBatchPath(), { organization_id: ORG_X, engagement_id: PROJECT_X, batch_code: "workbook-intake", idempotency_key: `batch-${randomUUID()}` });
      assert.ok([200, 201].includes(batch.status), J(batch.body));
      ids.batchId = batch.body.data.intake_batch_id;
      if (!ids.adminUserId) ids.adminUserId = (await query("SELECT user_id::text FROM kai.users WHERE legacy_public_userdata_id = $1", [USERS.clientAdmin]))[0].user_id;
      const fileId = await apiUpload(legacyAdmin, LEGACY, ids.batchId);
      await legacyDispatcher.whenIdle();
      assert.equal(dispatcher.stats().scheduled, 0, "the current revision processed nothing");
      const promoted = await decideAndPromote(legacyAdmin, fileId);
      const profile = await profileRowOf(promoted.file_profile_id);
      // The old profile shape: no header assertion, no blank-row count, no worksheet basis.
      assert.equal(profile.profile.format, "xlsx");
      assert.equal(profile.profile.counts.sheet_count, 1);
      assert.equal(profile.profile.counts.row_count, 7, "the workbook-wide row_count includes the header row and the stored blank row");
      assert.equal(profile.profile.structural_metadata.header_row_assumed, undefined);
      assert.equal(profile.profile.counts.blank_record_count, undefined);
      assert.equal(profile.profile.sheets[0].record_count_basis, undefined, "no worksheet record-count basis");
      // The old kernel is the profiler that made it.
      const bytes = new Uint8Array(LEGACY.bytes);
      const oldKernelProfile = await legacy.kernel.profileLocalTrustedFile({ extension: ".xlsx", declaredMime: SYNTHETIC_XLSX_MIME, byteSize: bytes.byteLength, bytes });
      assert.deepEqual(JSON.parse(J(oldKernelProfile)), profile.profile, "the persisted profile is exactly the previous revision's kernel output");
      const extracted = await legacyAdmin("POST", evidenceExtractionPath(ORG_X, promoted.source_version_id), {});
      assert.equal(extracted.status, 200, J(extracted.body));
      const [structural] = await query("SELECT evidence_item_id::text FROM kai.evidence_items WHERE source_version_id = $1::uuid ORDER BY created_at LIMIT 1", [promoted.source_version_id]);
      const claimed = await legacyAdmin("POST", claimProposalPath(ORG_X, structural.evidence_item_id), {});
      assert.ok([200, 201].includes(claimed.status), J(claimed.body));
      ids.legacy = { fileId, ...promoted, profile };
      ids.legacySnapshot = await legacySnapshot();
      results.b1 = { revision: LEGACY_REVISION, rowCount: 7, headerRowAssumed: null, blankRecordCount: null, recordCountBasis: null,
        structuralEvidence: ids.legacySnapshot.evidence.length, structuralClaims: ids.legacySnapshot.claims.length };
    });

    // The legacy lineage, for the before/after comparison.
    async function legacySnapshot() {
      const sv = ids.legacy?.source_version_id;
      return {
        file: (await query("SELECT intake_file_id::text, checksum, verified_checksum, file_policy_status, processing_status::text, parse_status::text FROM kai.intake_files WHERE intake_file_id = $1::uuid", [ids.legacy.fileId]))[0],
        profile: (await query("SELECT profile_canonical_sha256, md5(profile::text) AS profile_md5, parser_version FROM kai.intake_file_profiles WHERE file_profile_id = $1::uuid", [ids.legacy.file_profile_id]))[0],
        version: (await query("SELECT source_version_id::text, source_id::text, is_current, profile_canonical_sha256 FROM kai.source_versions WHERE source_version_id = $1::uuid", [sv]))[0],
        decision: (await query("SELECT intake_promotion_decision_id::text, decision_status, source_version_id::text FROM kai.intake_promotion_decisions WHERE source_version_id = $1::uuid", [sv]))[0],
        sensitivity: (await query("SELECT count(*)::int AS n FROM kai.intake_sensitivity_review_decisions WHERE intake_sensitivity_profile_id = $1::uuid", [ids.legacy.intake_sensitivity_profile_id]))[0],
        evidence: await query("SELECT evidence_item_id::text, evidence_type, statement_fingerprint FROM kai.evidence_items WHERE source_version_id = $1::uuid ORDER BY 1", [sv]),
        claims: await query("SELECT c.claim_id::text, c.statement, c.claim_status FROM kai.claims c JOIN kai.evidence_items e ON e.evidence_item_id = c.evidence_item_id WHERE e.source_version_id = $1::uuid ORDER BY 1", [sv]),
        measurements: (await query("SELECT count(*)::int AS n FROM kai.evidence_measurements WHERE source_version_id = $1::uuid", [sv]))[0].n,
      };
    }

    // -----------------------------------------------------------------------
    // A: a new ordinary workbook, uploaded by the customer in Files.
    // -----------------------------------------------------------------------
    await test("A1: the administrator uploads a new one-worksheet workbook in Files; the current P1 worker commits the worksheet record-count basis from its bytes", async () => {
      await openStudioTab("Files");
      await adminPage.waitForText("Upload the selected file");
      await adminPage.waitFor(async () => /Batch id: /.test(await adminPage.text()), "the Project's batch is selected");
      await adminPage.chooseFile(ORDINARY.path);
      const mark = adminPage.mark();
      await adminPage.clickButton("Upload the selected file");
      await adminPage.waitForText("File reserved, uploaded, and confirmed.");
      await adminPage.idle();
      await dispatcher.whenIdle();
      assert.deepEqual(adminPage.requestsSince(mark).filter((r) => r.method !== "GET").map((r) => r.method), ["POST", "POST", "PUT", "POST"]);
      const [file] = await fileByName(ORDINARY.name);
      const sensitivity = await sensitivityOf(file.intake_file_id);
      const profile = await profileRowOf(sensitivity.file_profile_id);
      assert.deepEqual(profile.profile.sheets[0].record_count_basis, {
        basis_version: "kai_xlsx_worksheet_record_basis_v1", header_row_position: 1, header_row_established: true,
        data_record_count: 6, blank_record_count: 1, duplicate_record_count: 2, field_missing_counts: [1, 1, 1, 1],
        formula_cell_count: 0, merged_range_count: 0, hidden_row_count: 0, hidden_column_count: 0,
        values_outside_header_columns_count: 0, unresolved_value_count: 0,
      });
      assert.doesNotMatch(J(profile.profile), /literacy|mentoring|facilitator|2026-09-0|"a"/, "no cell value is stored");
      ids.ordinary = { fileId: file.intake_file_id };
    });

    await test("A2: Count records shows the worksheet's counts; the administrator records the definition; the measurement, evidence, worksheet locator and claim match the independent count", async () => {
      const promoted = await decideAndPromote(adminApi, ids.ordinary.fileId);
      Object.assign(ids.ordinary, promoted);
      await openCountRecords(promoted.source_version_id);
      assert.match(await textOf(adminPage, "[data-client-source-measurement-worksheet]"), /Excel workbook: the rows of its only worksheet/);
      const counts = await textOf(adminPage, "[data-client-source-measurement-counts]");
      assert.match(counts, /Data records after the header row: 6/);
      assert.match(counts, /Blank records \(not counted\): 1/);
      assert.match(counts, /Exact-duplicate records \(still counted\): 2/);
      assert.equal(await textOf(adminPage, "[data-client-source-measurement-counted]"), "5");
      const recorded = await recordCountInUi(promoted.source_version_id);
      assertWorkbookMeasurement(recorded);
      Object.assign(ids.ordinary, { evidenceItemId: recorded.measurement.evidence_item_id, claimId: recorded.claim.claim_id });
      results.a2 = { measured: recorded.measurement.measured_value, method: recorded.measurement.calculation_method, locator: recorded.measurement.coordinates };
    });

    await test("A3: the ordinary workbook claim is eligible for internal use with no human approval; funder and public stay closed", async () => {
      const before = await approvalState();
      const internal = await internalEligibility(ids.ordinary.claimId);
      assert.deepEqual([internal.eligible, internal.blockerCodes], [true, []], J(internal.blockerCodes));
      for (const audience of ["funder", "public"]) assert.equal((await internalEligibility(ids.ordinary.claimId, audience)).eligible, false, audience);
      assert.deepEqual(before, { evidence_decisions: 0, claim_decisions: 0, coverage_decisions: 0, client_followups: 0, release_decisions: 0, manifests: 0 });
      ids.approvalsBeforeReports = before;
    });

    await test("A4: in the drafting interface the administrator generates an Evidence Summary and an Impact Narrative from the workbook claim and opens both internal reports", async () => {
      for (const [button, created, contentType, heading] of [
        ["Generate internal evidence summary", "Internal evidence summary created", "evidence_summary", "# Internal Evidence Summary"],
        ["Generate internal impact narrative", "Internal impact narrative created", "impact_narrative", "# Internal Impact Narrative"],
      ]) {
        await openStudioTab("Data Sources");
        await adminPage.waitFor(async () => Boolean(await textOf(adminPage, `[data-client-claim="${ids.ordinary.claimId}"]`)), "the measured claim");
        await adminPage.clickIn(`[data-client-claim="${ids.ordinary.claimId}"] input[type=checkbox]`, "Use in an internal draft");
        await adminPage.clickButton(button);
        await adminPage.waitForText(created);
        await adminPage.idle();
        const last = modelCalls.at(-1);
        assert.deepEqual(last.claims.map((claim) => claim.claimId), [ids.ordinary.claimId]);
        assert.ok(last.claims[0].limitationCodes.includes("measurement.blank_records_excluded"));
        const [draft] = await query("SELECT generated_content_draft_id::text FROM kai.generated_content_drafts WHERE organization_id = $1::uuid AND content_type = $2 ORDER BY created_at DESC LIMIT 1", [ORG_X, contentType]);
        await adminPage.waitFor(async () => Boolean(await textOf(adminPage, `[data-client-open-internal-report="${draft.generated_content_draft_id}"]`)), "the internal report action");
        await adminPage.clickIn(`[data-client-open-internal-report="${draft.generated_content_draft_id}"]`, "Open report");
        await adminPage.waitFor(async () => ((await textOf(adminPage, "[data-client-internal-report-markdown]")) || "").startsWith(heading), "the report");
        const shown = await textOf(adminPage, "[data-client-internal-report-markdown]");
        const fetched = await fetchText(adminPage, clientInternalReportMarkdownPath(ORG_X, PROJECT_X, draft.generated_content_draft_id));
        assert.deepEqual([fetched.status, fetched.body], [200, shown], "the download is the report shown");
        assertWorkbookReport(shown, heading, { claimId: ids.ordinary.claimId, evidenceItemId: ids.ordinary.evidenceItemId, sourceVersionId: ids.ordinary.source_version_id });
        writeFileSync(join(WORKDIR, `xlsx-a-${contentType}.md`), shown);
        ids.ordinary[contentType] = draft.generated_content_draft_id;
      }
      assert.deepEqual(await approvalState(), ids.approvalsBeforeReports, "zero approvals, reviews, follow-ups or releases");
      results.a4 = { reports: ["evidence_summary", "impact_narrative"], markdown: 200, newApprovals: 0 };
    });

    // -----------------------------------------------------------------------
    // B, part 2: the customer continues the legacy workbook.
    // -----------------------------------------------------------------------
    await test("B2: Count records on the legacy version is refused without misreading its old profile, and names the continuation", async () => {
      const basis = await adminApi("GET", sourceRecordCountMeasurementPath(ORG_X, ids.legacy.source_version_id));
      assert.equal(basis.status, 200, J(basis.body));
      assert.equal(basis.body.data.basis.measurable, false);
      assert.equal(basis.body.data.basis.blockers[0].blocking_reason, "measurement_xlsx_record_basis_not_committed");
      const write = await adminApi("POST", sourceRecordCountMeasurementPath(ORG_X, ids.legacy.source_version_id), DEFINITION);
      assert.deepEqual([write.status, write.body.blockers?.[0]?.blocking_reason], [422, "measurement_xlsx_record_basis_not_committed"]);
      await openCountRecords(ids.legacy.source_version_id);
      const shown = await textOf(adminPage, "[data-client-source-measurement-unmeasurable]");
      assert.match(shown, /profiled before worksheet records were counted/);
      assert.match(shown, /choose the same workbook again and select "Upload again as a new intake version"/);
      const sourceRow = await textOf(adminPage, `[data-client-source-version="${ids.legacy.source_version_id}"]`);
      const visibleLegacyFilename = LEGACY.name.replaceAll("-", "_");
      assert.ok(sourceRow.includes(visibleLegacyFilename));
      assert.match(sourceRow, new RegExp(ids.legacy.source_version_id));
      assert.match(sourceRow, /XLSX measurement basis missing/);
      assert.ok(await textOf(adminPage, `[data-client-continue-xlsx="${ids.legacy.source_version_id}"]`), "the old source offers its supported continuation");
      await adminPage.clickIn(`[data-client-continue-xlsx="${ids.legacy.source_version_id}"]`, "Prepare workbook for counting");
      await adminPage.waitFor(async () => Boolean(await textOf(adminPage, `[data-xlsx-continuation-source="${ids.legacy.source_version_id}"]`)), "the focused Files continuation");
      const continuation = await textOf(adminPage, `[data-xlsx-continuation-source="${ids.legacy.source_version_id}"]`);
      assert.ok(continuation.includes(`Historical profile for ${visibleLegacyFilename} is unchanged`));
      assert.match(continuation, /Select the same workbook below and upload it.*Upload again as a new intake version/);
      assert.deepEqual(await legacySnapshot(), ids.legacySnapshot, "nothing changed");
    });

    await test("B3: in Files the customer selects the same workbook, KAI recognizes it, and 'Upload again as a new intake version' creates a linked intake version the current worker profiles", async () => {
      await adminPage.waitForText("Upload the selected file");
      await adminPage.waitFor(async () => /Batch id: /.test(await adminPage.text()), "the Project's batch is selected");
      await adminPage.chooseFile(LEGACY.path);
      await adminPage.clickButton("Upload the selected file");
      await adminPage.waitForText("This file has already been added.");
      await adminPage.idle();
      const mark = adminPage.mark();
      await adminPage.clickButton("Upload again as a new intake version");
      await adminPage.waitForText("New intake version reserved, uploaded, and confirmed.");
      await adminPage.idle();
      await dispatcher.whenIdle();
      assert.deepEqual(adminPage.requestsSince(mark).filter((r) => r.method !== "GET").map((r) => r.method), ["POST", "POST", "PUT", "POST"]);
      const files = await fileByName(LEGACY.name);
      assert.equal(files.length, 2);
      const [original, version] = files;
      assert.equal(original.intake_file_id, ids.legacy.fileId);
      assert.deepEqual([version.force_new_version, version.original_intake_file_id, version.supersedes_intake_file_id, version.file_policy_status],
        [true, ids.legacy.fileId, ids.legacy.fileId, "passed"]);
      const sensitivity = await sensitivityOf(version.intake_file_id);
      const profile = await profileRowOf(sensitivity.file_profile_id);
      assert.equal(profile.profile.sheets[0].record_count_basis.data_record_count, 6);
      assert.notEqual(profile.profile_canonical_sha256, ids.legacy.profile.profile_canonical_sha256, "a new profile, not an overwrite");
      assert.deepEqual(await legacySnapshot(), ids.legacySnapshot, "the old file, profile, version, promotion and evidence are unchanged");
      ids.continued = { fileId: version.intake_file_id };
    });

    await test("B4: the administrator records the new version's sensitivity decision and promotes it (the existing per-version rule); Count records, the claim and an ordinary internal report follow", async () => {
      const promoted = await decideAndPromote(adminApi, ids.continued.fileId);
      Object.assign(ids.continued, promoted);
      assert.notEqual(promoted.source_version_id, ids.legacy.source_version_id);
      assert.equal(promoted.is_current, true);
      await openCountRecords(promoted.source_version_id);
      const recorded = await recordCountInUi(promoted.source_version_id);
      assertWorkbookMeasurement(recorded);
      Object.assign(ids.continued, { evidenceItemId: recorded.measurement.evidence_item_id, claimId: recorded.claim.claim_id });
      const internal = await internalEligibility(ids.continued.claimId);
      assert.deepEqual([internal.eligible, internal.blockerCodes], [true, []], J(internal.blockerCodes));
      const summary = await generate(adminApi, "evidence-summary", [ids.continued.claimId], "b4-summary");
      assert.ok([200, 201].includes(summary.status), J(summary.body));
      const draftId = summary.body.data.generatedContentDraftId;
      const report = await adminApi("GET", clientInternalReportMarkdownPath(ORG_X, PROJECT_X, draftId));
      assert.equal(report.status, 200, J(report.body).slice(0, 400));
      assertWorkbookReport(report.body, "# Internal Evidence Summary", { claimId: ids.continued.claimId, evidenceItemId: ids.continued.evidenceItemId, sourceVersionId: promoted.source_version_id });
      const replay = await generate(adminApi, "evidence-summary", [ids.continued.claimId], "b4-summary");
      assert.equal(replay.body.data.replayed, true, "a same-key retry writes nothing");
      // History is untouched; the legacy version stays current under the existing versioning rules (one version per promoted candidate).
      assert.deepEqual(await legacySnapshot(), ids.legacySnapshot);
      assert.deepEqual(await approvalState(), ids.approvalsBeforeReports, "no evidence, claim or coverage approval was needed");
      results.b = {
        continuation: "Files: same workbook -> 'Upload again as a new intake version' -> sensitivity decision -> promote -> Count records",
        legacyVersion: ids.legacy.source_version_id, newVersion: promoted.source_version_id, legacyStillCurrent: ids.legacySnapshot.version.is_current,
        measured: recorded.measurement.measured_value, report: 200,
      };
    });

    // -----------------------------------------------------------------------
    // C: a story/testimonial-present workbook.
    // -----------------------------------------------------------------------
    await test("C1: a workbook whose administrator records story/testimonial 'present' (allowed, AI permitted, the five other categories absent) is promoted, measured and claimed", async () => {
      const fileId = await apiUpload(adminApi, STORY, ids.batchId);
      await dispatcher.whenIdle();
      const promoted = await decideAndPromote(adminApi, fileId, { ...SNAPSHOT, reviewed_story_testimonial_status: "present" });
      const measured = await adminApi("POST", sourceRecordCountMeasurementPath(ORG_X, promoted.source_version_id), DEFINITION);
      assert.equal(measured.status, 200, J(measured.body));
      const evidenceItemId = measured.body.data.evidenceItem.evidence_item_id;
      const proposed = await adminApi("POST", claimProposalPath(ORG_X, evidenceItemId), {});
      assert.ok([200, 201].includes(proposed.status), J(proposed.body));
      ids.story = { fileId, ...promoted, evidenceItemId, claimId: proposed.body.data.claim.claim_id };
      const [measurement] = await query("SELECT measured_value::int, calculation_method FROM kai.evidence_measurements WHERE evidence_item_id = $1::uuid", [evidenceItemId]);
      assert.deepEqual(measurement, { measured_value: 5, calculation_method: XLSX_METHOD });
    });

    await test("C2: the story-present claim is not eligible for internal use on its own; the organization may not decide; generation is refused", async () => {
      const internal = await internalEligibility(ids.story.claimId);
      assert.equal(internal.eligible, false);
      ids.story.initialBlockers = internal.blockerCodes;
      const review = await adminApi("GET", organizationFactualReviewPath(ORG_X, ids.story.claimId));
      assert.equal(review.status, 200, J(review.body));
      ids.story.organizationReview = review.body.data;
      assert.ok(J(review.body.data).includes("story_testimonial_not_cleared"), J(review.body.data));
      const refused = await generate(adminApi, "evidence-summary", [ids.story.claimId], "c2-refused");
      assert.equal(refused.status, 422, J(refused.body));
      ids.story.generationRefusal = refused.body.blockers?.map((b) => b.blocking_reason);
      results.c2 = { eligible: false, blockerCodes: internal.blockerCodes, generationRefusal: ids.story.generationRefusal };
    });

    await test("C3: Get Kinder's authorized reviewer records the evidence review, the internal claim approval and the internal coverage acceptances; internal eligibility is re-evaluated", async () => {
      const evidenceQueue = await queueOf("evidence_review", ids.story.evidenceItemId);
      const evidence = await gkApi("POST", evidenceReviewCompletePath(ORG_X, ids.story.evidenceItemId, evidenceQueue.review_queue_item_id),
        evidenceReviewDecisionBody({ expectedUpdatedAt: new Date(evidenceQueue.updated_at).toISOString(), decision: "supported" }));
      assert.equal(evidence.status, 200, J(evidence.body));
      const claimQueue = await queueOf("claim_review", ids.story.claimId);
      const claim = await gkApi("POST", claimReviewCompletePath(ORG_X, ids.story.claimId, claimQueue.review_queue_item_id),
        claimReviewDecisionBody({ expectedUpdatedAt: new Date(claimQueue.updated_at).toISOString(), decision: "approved", approvedAudiences: ["internal"] }));
      assert.equal(claim.status, 200, J(claim.body));
      const unresolved = Object.entries((await internalEligibility(ids.story.claimId)).dimensions)
        .filter(([, value]) => value.assessment_status === "unresolved" && value.blocks_requested_audience).map(([key]) => key).sort();
      for (const dimensionKey of unresolved) {
        const accepted = await gkApi("POST", `${orgPath()}/claims/${ids.story.claimId}/coverage-dimensions/${dimensionKey}/internal-acceptance`, {});
        assert.equal(accepted.status, 201, `${dimensionKey}: ${J(accepted.body)}`);
      }
      const after = await internalEligibility(ids.story.claimId);
      ids.story.reviewed = { unresolvedAccepted: unresolved, eligible: after.eligible, blockerCodes: after.blockerCodes };
      assert.deepEqual([after.eligible, after.blockerCodes], [true, []], J(after.blockerCodes));
      for (const audience of ["funder", "public"]) assert.equal((await internalEligibility(ids.story.claimId, audience)).eligible, false, `${audience} stays closed`);
      results.c3 = { gkDecisions: ["evidence supported", "claim approved (internal)", ...unresolved.map((key) => `coverage ${key} accepted (internal)`)], eligible: after.eligible };
    });

    await test("C4: after Get Kinder's review the customer can generate from the claim, but its internal report download stays with Get Kinder: the story-containing source itself is not cleared", async () => {
      const summary = await generate(adminApi, "evidence-summary", [ids.story.claimId], "c4-summary");
      assert.ok([200, 201].includes(summary.status), J(summary.body));
      const draftId = summary.body.data.generatedContentDraftId;
      const report = await adminApi("GET", clientInternalReportMarkdownPath(ORG_X, PROJECT_X, draftId));
      ids.story.report = { status: report.status, body: typeof report.body === "string" ? report.body.slice(0, 600) : report.body };
      assert.equal(report.status, 422, J(report.body).slice(0, 400));
      assert.ok(J(report.body).includes("story_testimonial_not_cleared"), J(report.body).slice(0, 600));
      // Nothing changed the recorded source decision.
      const [decision] = await query(
        `SELECT reviewed_story_testimonial_status FROM kai.intake_sensitivity_review_decisions WHERE intake_sensitivity_profile_id = $1::uuid`,
        [ids.story.intake_sensitivity_profile_id]);
      assert.equal(decision.reviewed_story_testimonial_status, "present");
      ids.story.draftId = draftId;
      results.c4 = { generated: draftId, markdownStatus: report.status, reason: "story_testimonial_not_cleared" };
    });

    await test("C5: the existing Get Kinder route for that draft - GK content review, export review, limitation snapshot, candidate, internal release and manifest - delivers it to the administrator read-only; funder and public stay closed", async () => {
      const draftId = ids.story.draftId;
      const queue = await queueOf("generated_content_review", draftId);
      const adminStart = await adminApi("POST", generatedContentReviewStartPath(ORG_X, draftId, queue.review_queue_item_id), { expected_updated_at: new Date(queue.updated_at).toISOString() });
      assert.equal(adminStart.status, 403, "the administrator cannot review a story-present draft");
      const started = await gkApi("POST", generatedContentReviewStartPath(ORG_X, draftId, queue.review_queue_item_id), { expected_updated_at: new Date(queue.updated_at).toISOString() });
      assert.equal(started.status, 200, J(started.body));
      const inProgress = await queueOf("generated_content_review", draftId);
      const completed = await gkApi("POST", generatedContentReviewCompletePath(ORG_X, draftId, inProgress.review_queue_item_id), { expected_updated_at: new Date(inProgress.updated_at).toISOString() });
      assert.equal(completed.status, 200, J(completed.body));
      const draftPath = `${orgPath()}/generated-content-drafts/${draftId}`;
      assert.equal((await adminApi("POST", `${draftPath}/export-review-request`, { requested_export_audience: "internal" })).status, 403, "the administrator cannot release it");
      const requested = await gkAdminApi("POST", `${draftPath}/export-review-request`, { requested_export_audience: "internal" });
      assert.ok([200, 201].includes(requested.status), J(requested.body));
      for (const step of ["start", "complete"]) {
        const exportQueue = await queueOf("export_review", draftId);
        const moved = await gkAdminApi("POST", `${draftPath}/export-review-queue/${exportQueue.review_queue_item_id}/${step}`, { expected_updated_at: new Date(exportQueue.updated_at).toISOString() });
        assert.equal(moved.status, 200, `${step}: ${J(moved.body)}`);
      }
      const exportReviewQueueItemId = (await queueOf("export_review", draftId)).review_queue_item_id;
      const snapshot = await gkApi("POST", `${draftPath}/limitation-snapshot`, {});
      assert.ok([200, 201].includes(snapshot.status), J(snapshot.body));
      const candidate = await gkAdminApi("POST", `${draftPath}/export-candidates`, {});
      assert.ok([200, 201].includes(candidate.status), J(candidate.body));
      const [candidateRow] = await query("SELECT export_candidate_id::text FROM kai.export_candidates WHERE organization_id = $1::uuid AND generated_content_draft_id = $2::uuid", [ORG_X, draftId]);
      const granted = await gkAdminApi("POST", `${orgPath()}/export-candidates/${candidateRow.export_candidate_id}/final-release-authority`, { requested_audience: "internal", decision_action: "grant" });
      assert.ok([200, 201].includes(granted.status), J(granted.body));
      const manifest = await gkAdminApi("POST", `${orgPath()}/export-candidates/${candidateRow.export_candidate_id}/export-manifests`, { export_review_queue_item_id: exportReviewQueueItemId });
      assert.ok([200, 201].includes(manifest.status), J(manifest.body));
      const [manifestRow] = await query("SELECT export_manifest_id::text FROM kai.export_manifests WHERE organization_id = $1::uuid AND export_candidate_id = $2::uuid", [ORG_X, candidateRow.export_candidate_id]);
      const delivered = await adminApi("GET", clientReleasedReportMarkdownPath(ORG_X, PROJECT_X, manifestRow.export_manifest_id));
      assert.equal(delivered.status, 200, J(delivered.body).slice(0, 400));
      assert.equal(Number((/records (\d+) programme sessions/.exec(delivered.body) || [])[1]), independent.counted);
      assert.ok(delivered.body.includes(ids.story.claimId), "the released report cites the workbook claim");
      assert.doesNotMatch(delivered.body, /literacy|mentoring|facilitator|programme-sessions-/, "no cell values or file names");
      // Still internal only: the ordinary download stays refused and funder/public eligibility stays closed.
      assert.equal((await adminApi("GET", clientInternalReportMarkdownPath(ORG_X, PROJECT_X, draftId))).status, 422);
      for (const audience of ["funder", "public"]) assert.equal((await internalEligibility(ids.story.claimId, audience)).eligible, false, audience);
      writeFileSync(join(WORKDIR, "xlsx-c-released-internal-evidence-summary.md"), delivered.body);
      results.c5 = {
        route: "GK content review (gk_reviewer) -> export review request/start/complete (gk_admin) -> limitation snapshot (gk_reviewer) -> candidate, internal release grant, manifest (gk_admin) -> client read-only released-report delivery",
        manifest: manifestRow.export_manifest_id, delivered: delivered.status,
      };
    });

    // -----------------------------------------------------------------------
    // E: protected negatives on the workbook path.
    // -----------------------------------------------------------------------
    await test("E: a two-worksheet workbook is never combined; other roles, organizations and Projects are refused; a definition conflict and a replay write nothing", async () => {
      const fileId = await apiUpload(adminApi, TWO_SHEETS, ids.batchId);
      await dispatcher.whenIdle();
      const promoted = await decideAndPromote(adminApi, fileId);
      const twoSheets = await adminApi("POST", sourceRecordCountMeasurementPath(ORG_X, promoted.source_version_id), DEFINITION);
      assert.deepEqual([twoSheets.status, twoSheets.body.blockers?.[0]?.blocking_reason], [422, "measurement_xlsx_not_single_worksheet"]);
      const basisPath = sourceRecordCountMeasurementPath(ORG_X, ids.ordinary.source_version_id);
      for (const [label, api, status] of [["client_contributor", contributorApi, 403], ["client_reviewer", reviewerApi, 403], ["another organization's administrator", adminYApi, 403]]) {
        assert.equal((await api("GET", basisPath)).status, status, label);
        assert.equal((await api("POST", basisPath, DEFINITION)).status, status, label);
      }
      const otherProject = await adminApi("GET", clientInternalReportMarkdownPath(ORG_X, PROJECT_X2, ids.ordinary.evidence_summary));
      assert.equal(otherProject.status, 404, "another Project of the organization");
      const before = (await query("SELECT count(*)::int AS n FROM kai.evidence_measurements WHERE organization_id = $1::uuid", [ORG_X]))[0].n;
      const replay = await adminApi("POST", basisPath, DEFINITION);
      assert.deepEqual([replay.status, replay.body.data.replayed], [200, true]);
      const conflict = await adminApi("POST", basisPath, { ...DEFINITION, counted_unit: "attendance record" });
      assert.deepEqual([conflict.status, conflict.body.blockers?.[0]?.blocking_reason], [409, "measurement_definition_already_recorded"]);
      assert.equal((await query("SELECT count(*)::int AS n FROM kai.evidence_measurements WHERE organization_id = $1::uuid", [ORG_X]))[0].n, before);
      modelOverride.text = "The promoted source records 5 programme sessions reaching 40 participants, which improved literacy because of the sessions.";
      try {
        const unsupported = await generate(adminApi, "evidence-summary", [ids.ordinary.claimId], "e-unsupported");
        assert.equal(unsupported.status, 422, J(unsupported.body));
      } finally {
        modelOverride.text = null;
      }
      results.e = { twoSheets: "measurement_xlsx_not_single_worksheet", roles: 403, otherProject: 404, replay: "replayed", conflict: 409, unsupportedAssertion: 422 };
    });

    await test("summary", async () => {
      results.story = ids.story && {
        initialBlockers: ids.story.initialBlockers, generationRefusal: ids.story.generationRefusal, reviewed: ids.story.reviewed, report: ids.story.report,
        organizationReview: ids.story.organizationReview && {
          get_kinder_review_reasons: ids.story.organizationReview.get_kinder_review_reasons,
          evidence_review: ids.story.organizationReview.evidence_review, claim_review: ids.story.organizationReview.claim_review,
        },
      };
      console.log(`[kai-customer-xlsx-file-to-report] ${JSON.stringify(results, null, 2)}`);
      assert.deepEqual(adminPage.exceptions, []);
    });
  } finally {
    restoreRuntime();
    restoreLegacyRuntime();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => legacyServer.close(resolve));
    await seedPool.end();
    await ambientPool.end();
    await legacy.pool.end();
  }
}
