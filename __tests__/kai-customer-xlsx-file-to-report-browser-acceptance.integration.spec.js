import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";

import { programmeSessionRows, programmeSessionWorkbook, syntheticXlsxWorkbook, SYNTHETIC_XLSX_MIME } from "./support/kaiSyntheticXlsxWorkbook.js";

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
 *     measurement, claim, its count-only internal authority (no approval),
 *     Get Kinder's real evidence, claim and coverage reviews, generation, the
 *     count-only Evidence Summary download, the Impact Narrative kept with
 *     Get Kinder, and Get Kinder's existing release route.
 * H - a workbook shaped like the reported customer workbook (Service_Events
 *     sheet_3: 364 data rows with one exact-duplicate pair; Data_Dictionary
 *     sheet_5: 37 rows): ordinary versus restricted internal eligibility with
 *     the recorded condition, the administrator's "View review status", Get
 *     Kinder's "Review finding" in the built UI through the existing decision
 *     forms, refusals, and generation from the reviewed claim.
 * I - count-only internal authority for a story-present source (owner
 *     prompt 2026-10-30): a five-worksheet workbook with synthetic sensitive
 *     sentinels in cells, a header, the file name and the definition text;
 *     Service_Events (364 rows, 2 exact duplicates) counted, claimed, used in
 *     an Evidence Summary generated in the drafting UI and read as Markdown
 *     with no approval; the exact model request; adversarial model replies;
 *     the misleading Data_Dictionary 37-row "service events" reading; other
 *     categories, permissions, staleness, negative decisions, mixed drafts,
 *     other operations and other actors.
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
  const SELECTED_XLSX_METHOD = "p1_xlsx_selected_worksheet_data_rows_excluding_blank_v1";
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
    // The exact serialized model request, for the data-boundary checks.
    modelCalls.push({ claims: requestBody.claims, system: payload.system, serialized: JSON.stringify(payload) });
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          approved: true,
          draftStatus: "released",
          blocks: requestBody.claims.map((claim) => ({
            text: typeof modelOverride.text === "function" ? modelOverride.text(claim) : modelOverride.text ?? COMPLIANT_TEXT,
            citations: [{ claimId: claim.claimId, evidenceItemId: claim.evidenceItemId }],
          })),
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
    clientInternalDraftPath,
    clientInternalReportMarkdownPath,
    evidenceReviewCompletePath,
    evidenceReviewDecisionBody,
    eligibleClaimsPath,
    evidenceExtractionPath,
    claimProposalPath,
    clientReleasedReportMarkdownPath,
    generatedContentReviewCompletePath,
    generatedContentReviewStartPath,
    organizationSourcesPath,
    sourceCandidateDecisionPath,
  } = await import("../frontend/impactEvidenceLibraryLogic.js");
  const { listScopedSourceVersionsForSourceIds, xlsxWorksheetRecordCountBasisPresentSql } = await import("../Backend/kai/db/kaiIntakeQueries.js");
  const { deriveRecordCountMeasurement } = await import("../Backend/kai/validators/kaiSourceMeasurementValidators.js");
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
  // Five worksheets, as a customer's register workbook is laid out: notes, a
  // four-row register, the programme-session log as its third worksheet, a
  // worksheet with a formula and one with a merged range.
  const FIVE_SHEETS = customerFile("programme-register-five-sheets.xlsx", syntheticXlsxWorkbook({ sheets: [
    { name: "Read_Me", rows: [["note"], ["synthetic acceptance workbook"]] },
    { name: "Participant_Register", rows: [["participant_code", "enrolled_on", "cohort"], ["P01", "2026-09-01", "A"], ["P02", "2026-09-01", "A"],
      ["P03", "2026-09-08", "B"], ["P04", "2026-09-08", "B"]] },
    { name: "Service_Events", rows: programmeSessionRows({ tag: "five" }) },
    { name: "Lookups", rows: [["code", "label"], ["L1", { formula: "UPPER(\"x\")", value: "X" }]] },
    { name: "Summary", rows: [["metric", "value"], ["rows", 3]], merged: ["A2:B2"] },
  ] }));
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
      || Boolean(await textOf(adminPage, "[data-client-source-measurement-unmeasurable]"))
      || Boolean(await textOf(adminPage, "[data-client-source-measurement-selection-required]")), "the measurement basis");
    await adminPage.idle();
  };
  const recordCountInUi = async (sourceVersionId, worksheetKey = null) => {
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
    assert.deepEqual(adminPage.requestsSince(mark).filter((r) => r.method === "POST").map((r) => {
      const url = new URL(r.url);
      return [url.pathname + url.search, r.status];
    }),
      [[sourceRecordCountMeasurementPath(ORG_X, sourceVersionId, worksheetKey).replace(/\?.*$/, "") + (worksheetKey ? `?worksheet_key=${worksheetKey}` : ""), 200]]);
    const [measurement] = await query(
      `SELECT m.evidence_item_id::text, m.measured_value::int, m.total_record_count::int, m.blank_record_count::int, m.duplicate_record_count::int,
              m.calculation_method, l.coordinates, e.statement, e.source_locator_id::text
         FROM kai.evidence_measurements m JOIN kai.evidence_items e ON e.evidence_item_id = m.evidence_item_id
         JOIN kai.source_locators l ON l.source_locator_id = e.source_locator_id
        WHERE m.organization_id = $1::uuid AND m.source_version_id = $2::uuid`, [ORG_X, sourceVersionId]);
    const freshRead = await adminApi("GET", sourceRecordCountMeasurementPath(ORG_X, sourceVersionId, worksheetKey));
    assert.equal(freshRead.status, 200, J(freshRead.body));
    assert.deepEqual([
      freshRead.body.data.recorded.measurement.measured_value,
      freshRead.body.data.recorded.measurement.calculation_method,
      freshRead.body.data.recorded.measurement.total_record_count,
      freshRead.body.data.recorded.measurement.blank_record_count,
      freshRead.body.data.recorded.measurement.duplicate_record_count,
      freshRead.body.data.basis.worksheet.sheet_key,
      freshRead.body.data.recorded.definition.counted_unit,
      freshRead.body.data.recorded.definition.period_start,
      freshRead.body.data.recorded.definition.period_end,
    ], [independent.counted, worksheetKey ? SELECTED_XLSX_METHOD : XLSX_METHOD, independent.dataRecords, independent.blankRecords, independent.duplicateRecords,
      worksheetKey ?? "sheet_1", DEFINITION.counted_unit, DEFINITION.period_start, DEFINITION.period_end], "a fresh authorized service read returns the saved measurement and definition");
    await adminPage.clickIn(`[data-client-source-measurement-propose-claim="${measurement.evidence_item_id}"]`, "Propose a claim");
    await adminPage.waitForText(`Claim: The promoted source records ${independent.counted} programme sessions`);
    const [claim] = await query("SELECT claim_id::text, statement FROM kai.claims WHERE organization_id = $1::uuid AND evidence_item_id = $2::uuid",
      [ORG_X, measurement.evidence_item_id]);
    const freshClaimRead = await adminApi("GET", sourceRecordCountMeasurementPath(ORG_X, sourceVersionId, worksheetKey));
    assert.deepEqual([freshClaimRead.status, freshClaimRead.body.data.recorded.claim.statement], [200, claim.statement], "a fresh read returns the proposed measured claim");
    return { measurement, claim, freshRead: freshRead.body.data };
  };
  const assertWorkbookMeasurement = ({ measurement, claim }, { selected = false } = {}) => {
    assert.deepEqual([measurement.measured_value, measurement.total_record_count, measurement.blank_record_count, measurement.duplicate_record_count],
      [independent.counted, independent.dataRecords, independent.blankRecords, independent.duplicateRecords]);
    assert.equal(measurement.calculation_method, selected ? SELECTED_XLSX_METHOD : XLSX_METHOD);
    assert.deepEqual(measurement.coordinates, { scope: "data_records_after_header", sheet_key: "sheet_1" }, "the worksheet locator");
    if (selected) {
      assert.match(measurement.statement, /from selected worksheet sheet_1, counting each selected worksheet data row/);
      assert.match(claim.statement, /in selected worksheet sheet_1/);
    } else {
      assert.match(measurement.statement, /counting each worksheet data row after the header row as one programme session; 1 blank record excluded; 2 exact-duplicate records included\.$/);
      assert.equal(claim.statement, "The promoted source records 5 programme sessions for the reporting period 2026-09-01 to 2026-09-30 "
        + "(record count: one programme session per worksheet data row; 1 blank record excluded, 2 exact-duplicate records included).");
    }
  };
  // A complete internal report of the workbook count, with no unsupported conclusion.
  const assertWorkbookReport = (shown, heading, { claimId, evidenceItemId, sourceVersionId, selected = false, worksheet = ["Sessions", "sheet_1"] }) => {
    assert.ok(shown.startsWith(`${heading}\n`), shown.slice(0, 80));
    assert.equal(Number((/records \*\*(\d+) programme sessions\*\*/.exec(shown) || [])[1]), independent.counted);
    assert.match(shown, /for the reporting period 2026-09-01 to 2026-09-30/);
    const method = selected ? SELECTED_XLSX_METHOD : XLSX_METHOD;
    const methodDescription = selected
      ? "every data row after the header row of the explicitly selected worksheet of the exact promoted source version is one record"
      : "every data row after the header row of the only worksheet of the exact promoted source version is one record";
    assert.ok(shown.includes(`\`${method}\`: ${methodDescription}`));
    if (selected) {
      assert.ok(shown.includes(`Selected worksheet:** ${worksheet[0]} (\`${worksheet[1]}\`)`), "the selected worksheet");
      assert.ok(shown.includes(`Worksheet citation: ${worksheet[0]} (\`${worksheet[1]}\`)`), "the worksheet citation");
    }
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
      assert.match(await textOf(adminPage, "[data-client-source-measurement-worksheet]"), /Excel workbook worksheet Sessions/);
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

    // Superseded expectation (owner prompt 2026-10-30): before the count-only
    // basis this claim was ineligible and every generation was refused. The
    // count is now internally usable as a count only; the organization still
    // may not decide its reviews, and every other draft type is refused.
    await test("C2: the story-present count is internally eligible as a count only, with no decision; the organization may not decide; an Impact Narrative is refused", async () => {
      const decisionsBefore = await approvalState();
      const internal = await internalEligibility(ids.story.claimId);
      assert.deepEqual([internal.eligible, internal.blockerCodes], [true, []], J(internal.blockerCodes));
      ids.story.initialBlockers = internal.blockerCodes;
      const review = await adminApi("GET", organizationFactualReviewPath(ORG_X, ids.story.claimId));
      assert.equal(review.status, 200, J(review.body));
      ids.story.organizationReview = review.body.data;
      assert.deepEqual(review.body.data.ordinary_internal_rule, { applies: true, reasons: [], basis: "count_only_story_testimonial_present" });
      assert.equal(review.body.data.source_permissions.categories.reviewed_story_testimonial_status, "present");
      assert.ok(J(review.body.data.evidence_review).includes("story_testimonial_not_cleared"), "the organization's own review decision stays with Get Kinder");
      const refused = await generate(adminApi, "impact-narrative", [ids.story.claimId], "c2-refused");
      assert.equal(refused.status, 422, J(refused.body));
      ids.story.generationRefusal = refused.body.blockers?.map((b) => b.blocking_reason);
      assert.deepEqual(ids.story.generationRefusal, ["story_testimonial_count_only_operation_not_permitted"]);
      assert.deepEqual(await approvalState(), decisionsBefore, "no decision was recorded or needed");
      for (const audience of ["funder", "public"]) assert.equal((await internalEligibility(ids.story.claimId, audience)).eligible, false, `${audience} stays closed`);
      results.c2 = { eligible: true, basis: "count_only_story_testimonial_present", impactNarrative: ids.story.generationRefusal };
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
      // The source-level limitations no longer block (they are carried under
      // the count-only basis); Get Kinder still accepts them explicitly here.
      const unresolved = Object.entries((await internalEligibility(ids.story.claimId)).dimensions)
        .filter(([, value]) => value.assessment_status === "unresolved").map(([key]) => key).sort();
      assert.deepEqual(unresolved, ["conflicting_source_indicators", "requirement_alignment", "small_cell_risk"]);
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

    // Superseded expectation (owner prompt 2026-10-30): the Evidence Summary's
    // internal download was 422 story_testimonial_not_cleared. It is now
    // available as a count only; the Impact Narrative stays with Get Kinder.
    await test("C4: after Get Kinder's review the Evidence Summary's internal download is available as a count only; an Impact Narrative may be generated through Get Kinder's review but its download stays with Get Kinder", async () => {
      const summary = await generate(adminApi, "evidence-summary", [ids.story.claimId], "c4-summary");
      assert.ok([200, 201].includes(summary.status), J(summary.body));
      const draftId = summary.body.data.generatedContentDraftId;
      assert.ok(modelCalls.at(-1).claims[0].limitationCodes.includes("source.story_testimonial_present_count_only"), J(modelCalls.at(-1).claims[0].limitationCodes));
      const report = await adminApi("GET", clientInternalReportMarkdownPath(ORG_X, PROJECT_X, draftId));
      ids.story.report = { status: report.status, body: typeof report.body === "string" ? report.body.slice(0, 600) : report.body };
      assert.equal(report.status, 200, J(report.body).slice(0, 400));
      assert.match(report.body, /used for its record count only: no story or testimonial content is used/);
      assert.match(report.body, /recorded review decisions \(evidence: `supported`; claim: `approved`\)/);
      assert.doesNotMatch(report.body, /\*\*5 programme sessions\*\*/, "the human meaning is not the stated finding");
      // With Get Kinder's decisions recorded the eligibility no longer rests on the count-only basis, so a narrative is generated (the existing route) ...
      const narrative = await generate(adminApi, "impact-narrative", [ids.story.claimId], "c4-narrative");
      assert.ok([200, 201].includes(narrative.status), J(narrative.body));
      const narrativeReport = await adminApi("GET", clientInternalReportMarkdownPath(ORG_X, PROJECT_X, narrative.body.data.generatedContentDraftId));
      // ... but the count-only basis covers an Evidence Summary only.
      assert.equal(narrativeReport.status, 422, J(narrativeReport.body).slice(0, 400));
      assert.ok(J(narrativeReport.body).includes("story_testimonial_not_cleared"), J(narrativeReport.body).slice(0, 600));
      // Nothing changed the recorded source decision.
      const [decision] = await query(
        `SELECT reviewed_story_testimonial_status FROM kai.intake_sensitivity_review_decisions WHERE intake_sensitivity_profile_id = $1::uuid`,
        [ids.story.intake_sensitivity_profile_id]);
      assert.equal(decision.reviewed_story_testimonial_status, "present");
      ids.story.draftId = draftId;
      results.c4 = { generated: draftId, markdownStatus: report.status, impactNarrativeMarkdown: [narrativeReport.status, "story_testimonial_not_cleared"] };
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
      // Still internal only: the count-only download is unchanged by the release, and funder/public eligibility stays closed.
      assert.equal((await adminApi("GET", clientInternalReportMarkdownPath(ORG_X, PROJECT_X, draftId))).status, 200);
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
    await test("E: an explicitly selected worksheet is counted, measured, reported and retrievable; omission, invalid selection and restricted roles are refused", async () => {
      const fileId = await apiUpload(adminApi, TWO_SHEETS, ids.batchId);
      await dispatcher.whenIdle();
      const promoted = await decideAndPromote(adminApi, fileId);
      const twoSheetBasis = await adminApi("GET", sourceRecordCountMeasurementPath(ORG_X, promoted.source_version_id));
      assert.deepEqual([twoSheetBasis.status, twoSheetBasis.body.data.basis.blockers[0].blocking_reason], [200, "measurement_xlsx_worksheet_selection_required"]);
      assert.deepEqual(twoSheetBasis.body.data.basis.worksheet_options.map(({ sheet_key, sheet_name }) => [sheet_key, sheet_name]), [["sheet_1", "Sessions"], ["sheet_2", "Notes"]]);
      const omitted = await adminApi("POST", sourceRecordCountMeasurementPath(ORG_X, promoted.source_version_id), DEFINITION);
      assert.deepEqual([omitted.status, omitted.body.blockers?.[0]?.blocking_reason], [422, "measurement_xlsx_worksheet_selection_required"]);
      const invalid = await adminApi("POST", sourceRecordCountMeasurementPath(ORG_X, promoted.source_version_id, "sheet_99"), DEFINITION);
      assert.deepEqual([invalid.status, invalid.body.blockers?.[0]?.blocking_reason], [422, "measurement_xlsx_worksheet_selection_invalid"]);
      assert.deepEqual(await query("SELECT count(*)::int AS n FROM kai.evidence_measurements WHERE source_version_id = $1::uuid", [promoted.source_version_id]), [{ n: 0 }]);
      await openCountRecords(promoted.source_version_id);
      assert.ok(await textOf(adminPage, '[data-client-source-measurement-worksheet-select=""]'), "the UI requires explicit worksheet selection");
      const selectorOptions = await adminPage.evaluate(`Array.from(document.querySelectorAll('[data-client-source-measurement-worksheet-select] option')).map((option) => [option.value, option.textContent])`);
      assert.deepEqual(selectorOptions, [["", "Choose one worksheet"], ["sheet_1", "Sessions"], ["sheet_2", "Notes"]]);
      assert.match(await textOf(adminPage, '[data-client-source-measurement-worksheet-option="sheet_1"]'), /data rows 6, blank rows 1, exact duplicates 2/);
      assert.match(await textOf(adminPage, '[data-client-source-measurement-worksheet-option="sheet_2"]'), /Notes: data rows 1, blank rows 0, exact duplicates 0/);
      await adminPage.evaluate(`(() => { const node = document.querySelector('[data-client-source-measurement-worksheet-select]'); node.value = 'sheet_1'; node.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
      await adminPage.waitFor(async () => Boolean(await textOf(adminPage, '[data-client-source-measurement-counts]')), "selected worksheet counts");
      assert.match(await textOf(adminPage, '[data-client-source-measurement-worksheet]'), /Sessions/);
      assert.equal(await textOf(adminPage, '[data-client-source-measurement-counted]'), "5", "the notes worksheet does not contribute");
      const approvalBefore = await approvalState();
      const recorded = await recordCountInUi(promoted.source_version_id, "sheet_1");
      assertWorkbookMeasurement(recorded, { selected: true });
      ids.selected = { ...promoted, evidenceItemId: recorded.measurement.evidence_item_id, claimId: recorded.claim.claim_id };
      const internal = await internalEligibility(ids.selected.claimId);
      assert.deepEqual([internal.eligible, internal.blockerCodes], [true, []], J(internal.blockerCodes));
      assert.deepEqual(await approvalState(), approvalBefore, "ordinary selected-sheet eligibility requires no repeated evidence, claim, coverage or release approvals");
      for (const [button, created, contentType, heading] of [
        ["Generate internal evidence summary", "Internal evidence summary created", "evidence_summary", "# Internal Evidence Summary"],
        ["Generate internal impact narrative", "Internal impact narrative created", "impact_narrative", "# Internal Impact Narrative"],
      ]) {
        await openStudioTab("Data Sources");
        await adminPage.waitFor(async () => Boolean(await textOf(adminPage, `[data-client-claim="${ids.selected.claimId}"]`)), "selected-sheet measured claim");
        await adminPage.clickIn(`[data-client-claim="${ids.selected.claimId}"] input[type=checkbox]`, "Use in an internal draft");
        await adminPage.clickButton(button);
        await adminPage.waitForText(created);
        await adminPage.idle();
        const [draft] = await query("SELECT generated_content_draft_id::text FROM kai.generated_content_drafts WHERE organization_id = $1::uuid AND content_type = $2 ORDER BY created_at DESC LIMIT 1", [ORG_X, contentType]);
        await adminPage.waitFor(async () => Boolean(await textOf(adminPage, `[data-client-open-internal-report="${draft.generated_content_draft_id}"]`)), "selected-sheet report action");
        await adminPage.clickIn(`[data-client-open-internal-report="${draft.generated_content_draft_id}"]`, "Open selected-sheet report");
        await adminPage.waitFor(async () => ((await textOf(adminPage, "[data-client-internal-report-markdown]")) || "").startsWith(heading), "selected-sheet report");
        const shown = await textOf(adminPage, "[data-client-internal-report-markdown]");
        const fetched = await fetchText(adminPage, clientInternalReportMarkdownPath(ORG_X, PROJECT_X, draft.generated_content_draft_id));
        assert.deepEqual([fetched.status, fetched.body], [200, shown]);
        assertWorkbookReport(shown, heading, { claimId: ids.selected.claimId, evidenceItemId: ids.selected.evidenceItemId,
          sourceVersionId: ids.selected.source_version_id, selected: true });
        ids.selected[contentType] = draft.generated_content_draft_id;
      }
      assert.deepEqual(await approvalState(), approvalBefore);
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
      results.e = { selectedWorksheet: "sheet_1", method: SELECTED_XLSX_METHOD, count: 5, reports: ["evidence_summary", "impact_narrative"], noRepeatedApprovals: true,
        omission: "measurement_xlsx_worksheet_selection_required", invalid: "measurement_xlsx_worksheet_selection_invalid", roles: 403, otherProject: 404, replay: "replayed", conflict: 409, unsupportedAssertion: 422 };
    });

    // -----------------------------------------------------------------------
    // F: a five-worksheet workbook with worksheet record-count bases, from
    // the real P1 profile through the Data Sources readiness read and the
    // built UI to a recorded selected-worksheet count, a fresh reload and an
    // internal report.
    // -----------------------------------------------------------------------
    await test("F: a five-worksheet workbook's worksheet bases read as recorded from profile, readiness SQL, Data Sources API and the built UI; one selected worksheet is counted, recorded, reloaded and reported", async () => {
      const fileId = await apiUpload(adminApi, FIVE_SHEETS, ids.batchId);
      await dispatcher.whenIdle();
      const promoted = await decideAndPromote(adminApi, fileId);
      const sv = promoted.source_version_id;
      const { profile } = await profileRowOf((await sensitivityOf(fileId)).file_profile_id);
      ids.fiveSheetProfile = profile;
      const [sqlRow] = (await listScopedSourceVersionsForSourceIds({ organizationId: ORG_X, sourceIds: [promoted.source_id] }))
        .filter((row) => row.source_version_id === sv);
      const sourcesRead = await adminApi("GET", organizationSourcesPath(ORG_X));
      assert.equal(sourcesRead.status, 200, J(sourcesRead.body));
      const apiVersion = sourcesRead.body.data.sources.flatMap((source) => source.source_versions).find((version) => version.source_version_id === sv);
      const unselected = await adminApi("GET", sourceRecordCountMeasurementPath(ORG_X, sv));
      const selected = await adminApi("GET", sourceRecordCountMeasurementPath(ORG_X, sv, "sheet_3"));
      const row = `[data-client-source-version="${sv}"]`;
      await openStudioTab("Data Sources");
      await adminPage.waitFor(async () => Boolean(await textOf(adminPage, row)), "the five-worksheet source version row");
      const rowText = await textOf(adminPage, row);
      const rowReadiness = await adminPage.evaluate(`document.querySelector(${J(`${row} [data-client-xlsx-measurement-readiness]`)})?.getAttribute("data-client-xlsx-measurement-readiness") ?? null`);
      const reuploadOffered = Boolean(await textOf(adminPage, `[data-client-continue-xlsx="${sv}"]`));
      await openCountRecords(sv);
      const panelText = await textOf(adminPage, `[data-client-source-measurement="${sv}"]`);
      const observed = {
        profileSheetBases: profile.sheets.map((sheet) => [sheet.sheet_key, sheet.safe_sheet_name, sheet.record_count_basis?.basis_version ?? null]),
        profileTopLevelBasis: Object.hasOwn(profile, "record_count_basis"),
        readinessSql: sqlRow?.has_xlsx_record_count_basis,
        dataSourcesApi: apiVersion?.has_xlsx_record_count_basis,
        unselectedGet: [unselected.status, unselected.body.data?.basis.measurable, unselected.body.data?.basis.blockers?.map((blocker) => blocker.blocking_reason)],
        selectedGet: [selected.status, selected.body.data?.basis.measurable, selected.body.data?.basis.worksheet?.sheet_key, selected.body.data?.basis.worksheet?.sheet_name,
          selected.body.data?.basis.calculation_method, selected.body.data?.basis.data_record_count, selected.body.data?.basis.blank_record_count,
          selected.body.data?.basis.duplicate_record_count, selected.body.data?.basis.counted_record_count],
        uiRowReadiness: rowReadiness,
        uiRowSaysBasisMissing: /XLSX measurement basis missing/.test(rowText),
        uiOffersReupload: reuploadOffered,
        uiPanelSaysCannotBeCounted: /cannot be counted this way/.test(panelText),
        uiPanelSelectionRequired: Boolean(await textOf(adminPage, "[data-client-source-measurement-selection-required]")),
      };
      console.log(`[kai-customer-xlsx-file-to-report] F observed ${J(observed)}`);
      const basisVersion = "kai_xlsx_worksheet_record_basis_v1";
      assert.deepEqual(observed, {
        profileSheetBases: [["sheet_1", "Read_Me", basisVersion], ["sheet_2", "Participant_Register", basisVersion], ["sheet_3", "Service_Events", basisVersion],
          ["sheet_4", "Lookups", basisVersion], ["sheet_5", "Summary", basisVersion]],
        profileTopLevelBasis: false,
        readinessSql: true,
        dataSourcesApi: true,
        unselectedGet: [200, false, ["measurement_xlsx_worksheet_selection_required"]],
        selectedGet: [200, true, "sheet_3", "Service_Events", SELECTED_XLSX_METHOD, independent.dataRecords, independent.blankRecords, independent.duplicateRecords, independent.counted],
        uiRowReadiness: "basis_recorded",
        uiRowSaysBasisMissing: false,
        uiOffersReupload: false,
        uiPanelSaysCannotBeCounted: false,
        uiPanelSelectionRequired: true,
      }, "every boundary agrees that the worksheet bases are recorded and a worksheet must be chosen");

      // The selector lists every worksheet with its own counts; a worksheet
      // with its own blocker names that blocker, not a missing basis.
      const selectorOptions = await adminPage.evaluate(`Array.from(document.querySelectorAll('[data-client-source-measurement-worksheet-select] option')).map((option) => [option.value, option.textContent])`);
      assert.deepEqual(selectorOptions, [["", "Choose one worksheet"], ["sheet_1", "Read_Me"], ["sheet_2", "Participant_Register"], ["sheet_3", "Service_Events"],
        ["sheet_4", "Lookups"], ["sheet_5", "Summary"]]);
      assert.match(await textOf(adminPage, '[data-client-source-measurement-worksheet-option="sheet_2"]'), /Participant_Register: data rows 4, blank rows 0, exact duplicates 0/);
      assert.match(await textOf(adminPage, '[data-client-source-measurement-worksheet-option="sheet_3"]'), /Service_Events: data rows 6, blank rows 1, exact duplicates 2/);
      const selectWorksheet = (key) => adminPage.evaluate(`(() => { const node = document.querySelector('[data-client-source-measurement-worksheet-select]'); node.value = ${J(key)}; node.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
      for (const [key, reason] of [["sheet_4", "measurement_xlsx_formula_cells_present"], ["sheet_5", "measurement_xlsx_merged_cells_present"]]) {
        await selectWorksheet(key);
        await adminPage.waitFor(async () => (await adminPage.evaluate(`document.querySelector('[data-client-source-measurement-blocker]')?.getAttribute('data-blocking-reason') ?? null`)) === reason, `${key} blocker`);
        const shown = await textOf(adminPage, "[data-client-source-measurement-unmeasurable]");
        assert.match(shown, /The selected worksheet cannot be counted this way/);
        assert.doesNotMatch(shown, /profiled before worksheet records were counted|Upload again as a new intake version/, "a worksheet blocker is not a missing basis");
      }
      const mark = adminPage.mark();
      await selectWorksheet("sheet_3");
      await adminPage.waitFor(async () => Boolean(await textOf(adminPage, "[data-client-source-measurement-counts]")), "Service_Events counts");
      await adminPage.idle();
      assert.deepEqual(adminPage.requestsSince(mark).map((request) => {
        const url = new URL(request.url);
        return [request.method, url.pathname + url.search, request.status];
      }), [["GET", sourceRecordCountMeasurementPath(ORG_X, sv, "sheet_3"), 200]], "the selection reads the existing P2-01M route with the worksheet key");
      assert.match(await textOf(adminPage, "[data-client-source-measurement-worksheet]"), /Excel workbook worksheet Service_Events/);
      assert.equal(await textOf(adminPage, "[data-client-source-measurement-counted]"), String(independent.counted), "two exact duplicates included, the blank row excluded");

      // The organization administrator records the definition through the
      // existing write; a fresh service read returns it.
      const recorded = await recordCountInUi(sv, "sheet_3");
      const [measurementRow] = await query(
        `SELECT m.organization_id::text, m.source_version_id::text, m.measured_value::int, m.total_record_count::int, m.blank_record_count::int,
                m.duplicate_record_count::int, m.calculation_method, l.coordinates, d.counted_unit, d.unit_label, d.period_start::text, d.period_end::text
           FROM kai.evidence_measurements m JOIN kai.evidence_items e ON e.evidence_item_id = m.evidence_item_id
           JOIN kai.source_locators l ON l.source_locator_id = e.source_locator_id
           JOIN kai.source_measurement_definitions d ON d.source_measurement_definition_id = m.source_measurement_definition_id
          WHERE m.source_version_id = $1::uuid`, [sv]);
      assert.deepEqual(measurementRow, {
        organization_id: ORG_X, source_version_id: sv, measured_value: independent.counted, total_record_count: independent.dataRecords,
        blank_record_count: independent.blankRecords, duplicate_record_count: independent.duplicateRecords, calculation_method: SELECTED_XLSX_METHOD,
        coordinates: { scope: "data_records_after_header", sheet_key: "sheet_3" }, counted_unit: DEFINITION.counted_unit, unit_label: DEFINITION.unit_label,
        period_start: DEFINITION.period_start, period_end: DEFINITION.period_end,
      });
      assert.match(recorded.measurement.statement, /from selected worksheet sheet_3, counting each selected worksheet data row/);
      assert.match(recorded.claim.statement, /in selected worksheet sheet_3/);
      assert.doesNotMatch(recorded.claim.statement, /participant|people|unique|outcome/i, "worksheet rows are not people or outcomes");

      // A fresh application load shows the same recorded measurement.
      await openCountRecords(sv);
      assert.equal(await adminPage.evaluate(`document.querySelector('[data-client-source-measurement-value]')?.getAttribute('data-client-source-measurement-value') ?? null`),
        String(independent.counted), "the recorded measurement after reload");
      assert.ok(await textOf(adminPage, "[data-client-source-measurement-selection-required]"), "the reloaded panel asks for a worksheet");
      assert.doesNotMatch(await textOf(adminPage, `[data-client-source-measurement="${sv}"]`), /cannot be counted this way/);
      assert.equal(await textOf(adminPage, "[data-client-source-measurement-form]"), null, "the recorded definition is immutable; no second form");
      const reread = await adminApi("GET", sourceRecordCountMeasurementPath(ORG_X, sv, "sheet_3"));
      assert.deepEqual([reread.status, reread.body.data.basis.worksheet.sheet_key, reread.body.data.recorded.measurement.measured_value,
        reread.body.data.recorded.measurement.calculation_method, reread.body.data.recorded.definition.counted_unit],
      [200, "sheet_3", independent.counted, SELECTED_XLSX_METHOD, DEFINITION.counted_unit]);

      // Refusals: selection, immutability, roles, tenants; nothing written.
      const measurementCount = async () => (await query("SELECT count(*)::int AS n FROM kai.evidence_measurements WHERE source_version_id = $1::uuid", [sv]))[0].n;
      const invalid = await adminApi("GET", sourceRecordCountMeasurementPath(ORG_X, sv, "sheet_99"));
      assert.deepEqual([invalid.status, invalid.body.data.basis.blockers[0].blocking_reason], [200, "measurement_xlsx_worksheet_selection_invalid"]);
      const omitted = await adminApi("POST", sourceRecordCountMeasurementPath(ORG_X, sv), DEFINITION);
      assert.deepEqual([omitted.status, omitted.body.blockers?.[0]?.blocking_reason], [422, "measurement_xlsx_worksheet_selection_required"]);
      const replay = await adminApi("POST", sourceRecordCountMeasurementPath(ORG_X, sv, "sheet_3"), DEFINITION);
      assert.deepEqual([replay.status, replay.body.data.replayed], [200, true]);
      const conflict = await adminApi("POST", sourceRecordCountMeasurementPath(ORG_X, sv, "sheet_3"), { ...DEFINITION, counted_unit: "attendance record" });
      assert.deepEqual([conflict.status, conflict.body.blockers?.[0]?.blocking_reason], [409, "measurement_definition_already_recorded"]);
      const otherSheet = await adminApi("POST", sourceRecordCountMeasurementPath(ORG_X, sv, "sheet_2"), DEFINITION);
      assert.ok(![200, 201].includes(otherSheet.status), `a second worksheet is not recorded under the same definition: ${J(otherSheet.body)}`);
      const basisPath = sourceRecordCountMeasurementPath(ORG_X, sv, "sheet_3");
      for (const [label, api] of [["client_contributor", contributorApi], ["client_reviewer", reviewerApi], ["another organization's administrator", adminYApi]]) {
        assert.equal((await api("GET", basisPath)).status, 403, label);
        assert.equal((await api("POST", basisPath, DEFINITION)).status, 403, label);
      }
      assert.equal(await measurementCount(), 1, "one measurement; worksheets are never combined or added");

      // Downstream: the ordinary measured claim is internally eligible, and
      // an internal Evidence Summary cites the selected worksheet.
      const claimId = recorded.claim.claim_id;
      const internal = await internalEligibility(claimId);
      assert.deepEqual([internal.eligible, internal.blockerCodes], [true, []], J(internal.blockerCodes));
      const generated = await generate(adminApi, "evidence-summary", [claimId], "f-evidence-summary");
      assert.ok([200, 201].includes(generated.status), J(generated.body));
      const [draft] = await query("SELECT generated_content_draft_id::text FROM kai.generated_content_drafts WHERE organization_id = $1::uuid AND content_type = 'evidence_summary' ORDER BY created_at DESC LIMIT 1", [ORG_X]);
      const report = await fetchText(adminPage, clientInternalReportMarkdownPath(ORG_X, PROJECT_X, draft.generated_content_draft_id));
      assert.equal(report.status, 200);
      assertWorkbookReport(report.body, "# Internal Evidence Summary", { claimId, evidenceItemId: recorded.measurement.evidence_item_id, sourceVersionId: sv,
        selected: true, worksheet: ["Service_Events", "sheet_3"] });
      results.f = { observed, measurement: measurementRow, reloaded: true, otherWorksheetAttempt: otherSheet.status, conflict: 409, roles: 403,
        internalEligible: internal.eligible, evidenceSummary: draft.generated_content_draft_id };
    });

    await test("G: the readiness predicate, evaluated by PostgreSQL, admits only a committed worksheet basis - not a legacy, malformed, incomplete or CSV profile - and agrees with the P2-01M validator", async () => {
      const real = ids.fiveSheetProfile;
      assert.ok(real, "F committed the real five-worksheet profile");
      const withSheets = (map) => ({ ...real, sheets: real.sheets.map(map) });
      const withoutBasis = ({ record_count_basis: _omitted, ...sheet }) => sheet;
      const cases = [
        ["real five-worksheet profile", real, true],
        ["legacy: no worksheet basis", withSheets(withoutBasis), false],
        ["only the third worksheet has a basis", withSheets((sheet) => (sheet.sheet_key === "sheet_3" ? sheet : withoutBasis(sheet))), true],
        ["basis only at the top level", { ...withSheets(withoutBasis), record_count_basis: real.sheets[2].record_count_basis }, false],
        ["unknown basis version", withSheets((sheet) => ({ ...sheet, record_count_basis: { ...sheet.record_count_basis, basis_version: "kai_xlsx_worksheet_record_basis_v2" } })), false],
        ["basis is not an object", withSheets((sheet) => ({ ...sheet, record_count_basis: "kai_xlsx_worksheet_record_basis_v1" })), false],
        ["worksheet keyed by name", withSheets((sheet) => ({ ...sheet, sheet_key: sheet.safe_sheet_name })), false],
        ["worksheet list incomplete", { ...real, counts: { ...real.counts, sheet_count: real.sheets.length + 1 } }, false],
        ["worksheet count is text", { ...real, counts: { ...real.counts, sheet_count: String(real.sheets.length) } }, false],
        ["worksheets not a list", { ...real, sheets: Object.fromEntries(real.sheets.map((sheet) => [sheet.sheet_key, sheet])) }, false],
        ["no worksheets", { ...real, sheets: [], counts: { ...real.counts, sheet_count: 0 } }, false],
        ["CSV profile", { ...real, format: "csv" }, false],
      ];
      const basisAbsentReasons = new Set(["measurement_xlsx_record_basis_not_committed", "measurement_xlsx_worksheet_profile_invalid",
        "measurement_xlsx_worksheet_selection_required", "measurement_xlsx_worksheet_selection_invalid", "measurement_source_not_single_table"]);
      const observed = [];
      for (const [label, profile, expected] of cases) {
        const [{ present }] = await query(`SELECT ${xlsxWorksheetRecordCountBasisPresentSql("p.profile")} AS present FROM (VALUES ($1::jsonb)) AS p(profile)`, [J(profile)]);
        const keys = Array.isArray(profile.sheets) ? profile.sheets.map((sheet) => sheet.sheet_key) : [];
        const validatorFindsBasis = profile.format === "xlsx" && keys.some((key) => {
          const derived = deriveRecordCountMeasurement(profile, key);
          return derived.ok || !basisAbsentReasons.has(derived.blockers[0].blocking_reason);
        });
        observed.push([label, present, validatorFindsBasis]);
        assert.deepEqual([label, present, validatorFindsBasis], [label, expected, expected], label);
      }
      results.g = observed;
    });

    // -----------------------------------------------------------------------
    // H: measured-finding eligibility and Get Kinder's review of a finding,
    // on a workbook shaped like the reported customer workbook (synthetic
    // values only): Service_Events is sheet_3 with 364 data rows including
    // one exact-duplicate pair, Data_Dictionary is sheet_5 with 37 data rows.
    // -----------------------------------------------------------------------
    const serviceEventRows = (tag) => {
      const rows = [["event_ref", "event_date", "service_type", "run_tag"]];
      for (let index = 1; index <= 362; index += 1) {
        rows.push([`E${String(index).padStart(3, "0")}`, `2026-09-${String((index % 28) + 1).padStart(2, "0")}`, index % 2 ? "visit" : "call", tag]);
      }
      rows.push(["E900", "2026-09-30", "visit", tag], ["E900", "2026-09-30", "visit", tag]);
      return rows;
    };
    const productionShapedWorkbook = (tag) => customerFile(`service-workbook-${tag}.xlsx`, syntheticXlsxWorkbook({ sheets: [
      { name: "Read_Me", rows: [["note"], [`synthetic service workbook ${tag}`]] },
      { name: "Participant_Register", rows: [["participant_code", "cohort"], ...Array.from({ length: 84 }, (_, index) => [`P${String(index + 1).padStart(3, "0")}`, index % 2 ? "A" : "B"])] },
      { name: "Service_Events", rows: serviceEventRows(tag) },
      { name: "Funder_Notes", rows: [["note"], ["synthetic notes"]] },
      { name: "Data_Dictionary", rows: [["field_name", "description"], ...Array.from({ length: 37 }, (_, index) => [`field_${index + 1}`, `synthetic description ${index + 1}`])] },
    ] }));
    // The human definition the reported request supplied: service events.
    const SERVICE_DEFINITION = Object.freeze({
      counted_unit: "service event", unit_label: "service events",
      definition_text: "Each row records one service event delivered to a participant.",
      inclusion_rule: "Every data row after the header row that has at least one value.",
      exclusion_rule: "The header row and empty rows.",
    });
    const H_INDEPENDENT = Object.freeze({ sheet_3: { name: "Service_Events", dataRecords: 364, blank: 0, duplicates: 2, counted: 364 }, sheet_5: { name: "Data_Dictionary", dataRecords: 37, blank: 0, duplicates: 0, counted: 37 } });
    const gkPage = await openPage(browser, { baseUrl, legacyUserId: USERS.gkReviewer });
    const decisionCounts = async (claimId, evidenceItemId) => (await query(`SELECT
        (SELECT count(*) FROM kai.evidence_review_decisions WHERE evidence_item_id = $2::uuid)::int AS evidence,
        (SELECT count(*) FROM kai.claim_review_decisions WHERE claim_id = $1::uuid)::int AS claim,
        (SELECT count(*) FROM kai.coverage_review_decisions WHERE claim_id = $1::uuid)::int AS coverage`, [claimId, evidenceItemId]))[0];
    const measurementRowsDigest = async () => (await query(
      "SELECT md5(string_agg(row_to_json(m)::text, '|' ORDER BY m.evidence_item_id)) AS digest FROM kai.evidence_measurements m WHERE m.organization_id = $1::uuid", [ORG_X]))[0].digest;
    const findingReview = async (api, claimId) => api("GET", organizationFactualReviewPath(ORG_X, claimId));
    const measureAndClaim = async (file, worksheetKey, snapshot) => {
      const fileId = await apiUpload(adminApi, file, ids.batchId);
      await dispatcher.whenIdle();
      const promoted = await decideAndPromote(adminApi, fileId, snapshot);
      const measured = await adminApi("POST", sourceRecordCountMeasurementPath(ORG_X, promoted.source_version_id, worksheetKey), SERVICE_DEFINITION);
      assert.equal(measured.status, 200, J(measured.body));
      const evidenceItemId = measured.body.data.evidenceItem.evidence_item_id;
      const proposed = await adminApi("POST", claimProposalPath(ORG_X, evidenceItemId), {});
      assert.ok([200, 201].includes(proposed.status), J(proposed.body));
      return { fileId, ...promoted, evidenceItemId, claimId: proposed.body.data.claim.claim_id, worksheetKey };
    };

    await test("H1 (A, B): worksheet counts keep their identity; an ordinary count is eligible with no approval; a count from a source with an undetermined category is restricted, and the exact recorded condition is explained", async () => {
      // A historical structural-only draft, read before anything below runs.
      const [structuralClaim] = await query(
        `SELECT c.claim_id::text, c.statement FROM kai.claims c JOIN kai.evidence_items e ON e.evidence_item_id = c.evidence_item_id
          WHERE c.organization_id = $1::uuid AND e.evidence_type = 'dictionary_field_presence_fact' ORDER BY c.created_at LIMIT 1`, [ORG_X]);
      modelOverride.text = structuralClaim.statement;
      const structuralDraft = await generate(adminApi, "evidence-summary", [structuralClaim.claim_id], "h-structural-only");
      modelOverride.text = null;
      assert.ok([200, 201].includes(structuralDraft.status), J(structuralDraft.body));
      ids.h = { structuralDraftId: structuralDraft.body.data.generatedContentDraftId };
      const draftDigest = async (draftId) => (await query(
        `SELECT md5(row_to_json(d)::text || coalesce((SELECT string_agg(row_to_json(b)::text, '|' ORDER BY b.generated_content_block_id) FROM kai.generated_content_blocks b WHERE b.generated_content_draft_id = d.generated_content_draft_id), '')) AS digest
           FROM kai.generated_content_drafts d WHERE d.generated_content_draft_id = $1::uuid`, [draftId]))[0].digest;
      ids.h.draftDigest = draftDigest;
      ids.h.structuralDigest = await draftDigest(ids.h.structuralDraftId);

      // The restricted source: story/testimonial not determined ('unknown'), everything else ordinary.
      const restrictedSnapshot = { ...SNAPSHOT, reviewed_story_testimonial_status: "unknown" };
      const first = productionShapedWorkbook("h-restricted-a");
      const bases = {};
      {
        const fileId = await apiUpload(adminApi, first, ids.batchId);
        await dispatcher.whenIdle();
        const promoted = await decideAndPromote(adminApi, fileId, restrictedSnapshot);
        for (const key of ["sheet_3", "sheet_5"]) {
          const basis = await adminApi("GET", sourceRecordCountMeasurementPath(ORG_X, promoted.source_version_id, key));
          assert.equal(basis.status, 200, J(basis.body));
          const b = basis.body.data.basis;
          bases[key] = [b.measurable, b.worksheet?.sheet_key, b.worksheet?.sheet_name, b.data_record_count, b.blank_record_count, b.duplicate_record_count, b.counted_record_count];
        }
        assert.deepEqual(bases, {
          sheet_3: [true, "sheet_3", "Service_Events", 364, 0, 2, 364],
          sheet_5: [true, "sheet_5", "Data_Dictionary", 37, 0, 0, 37],
        }, "each worksheet keeps its own identity and counts; exact duplicates are included");
        // The reported request: sheet_5 selected under a service-event definition.
        const measured = await adminApi("POST", sourceRecordCountMeasurementPath(ORG_X, promoted.source_version_id, "sheet_5"), SERVICE_DEFINITION);
        assert.equal(measured.status, 200, J(measured.body));
        const evidenceItemId = measured.body.data.evidenceItem.evidence_item_id;
        const proposed = await adminApi("POST", claimProposalPath(ORG_X, evidenceItemId), {});
        assert.ok([200, 201].includes(proposed.status), J(proposed.body));
        ids.h.s5 = { fileId, ...promoted, evidenceItemId, claimId: proposed.body.data.claim.claim_id };
      }
      ids.h.s3Restricted = await measureAndClaim(productionShapedWorkbook("h-restricted-b"), "sheet_3", restrictedSnapshot);
      ids.h.s3Ordinary = await measureAndClaim(productionShapedWorkbook("h-ordinary"), "sheet_3", SNAPSHOT);

      const measurementOf = async (evidenceItemId) => (await query(
        `SELECT m.measured_value::int, m.total_record_count::int, m.blank_record_count::int, m.duplicate_record_count::int, m.calculation_method, l.coordinates, c.statement AS claim_statement
           FROM kai.evidence_measurements m JOIN kai.evidence_items e ON e.evidence_item_id = m.evidence_item_id
           JOIN kai.source_locators l ON l.source_locator_id = e.source_locator_id JOIN kai.claims c ON c.evidence_item_id = e.evidence_item_id
          WHERE m.evidence_item_id = $1::uuid`, [evidenceItemId]))[0];
      for (const [label, entry, key] of [["sheet_5", ids.h.s5, "sheet_5"], ["sheet_3 restricted", ids.h.s3Restricted, "sheet_3"], ["sheet_3 ordinary", ids.h.s3Ordinary, "sheet_3"]]) {
        const row = await measurementOf(entry.evidenceItemId);
        const expected = H_INDEPENDENT[key];
        assert.deepEqual([row.measured_value, row.total_record_count, row.blank_record_count, row.duplicate_record_count, row.calculation_method, row.coordinates],
          [expected.counted, expected.dataRecords, expected.blank, expected.duplicates, SELECTED_XLSX_METHOD, { scope: "data_records_after_header", sheet_key: key }], label);
        assert.match(row.claim_statement, new RegExp(`^The promoted source records ${expected.counted} service events .* in selected worksheet ${key} \\(record count: one service event per selected worksheet data row;`), label);
        assert.doesNotMatch(row.claim_statement, /participant|people|unique|outcome|verified/i, `${label}: a record count, not participants or outcomes`);
      }
      ids.h.measurementDigest = await measurementRowsDigest();

      // A: the ordinary count is eligible with no human decision.
      const ordinary = await internalEligibility(ids.h.s3Ordinary.claimId);
      assert.deepEqual([ordinary.eligible, ordinary.blockerCodes], [true, []]);
      assert.deepEqual(await decisionCounts(ids.h.s3Ordinary.claimId, ids.h.s3Ordinary.evidenceItemId), { evidence: 0, claim: 0, coverage: 0 });
      const ordinaryView = await findingReview(adminApi, ids.h.s3Ordinary.claimId);
      assert.deepEqual([ordinaryView.status, ordinaryView.body.data.ordinary_internal_rule, ordinaryView.body.data.review_requirement],
        [200, { applies: true, reasons: [], basis: "all_sensitive_categories_absent" }, null]);
      // A: the restricted counts are not eligible, for the recorded reason, which says 'unknown', not 'present'.
      for (const entry of [ids.h.s5, ids.h.s3Restricted]) {
        const restricted = await internalEligibility(entry.claimId);
        assert.equal(restricted.eligible, false);
        assert.ok(restricted.blockerCodes.includes("evidence_review_unresolved") && restricted.blockerCodes.includes("claim_review_unresolved"), J(restricted.blockerCodes));
        const view = await findingReview(adminApi, entry.claimId);
        assert.equal(view.status, 200, J(view.body));
        assert.deepEqual(view.body.data.ordinary_internal_rule, { applies: false, reasons: ["story_testimonial_not_cleared"], basis: null });
        assert.deepEqual([view.body.data.source_permissions.categories.reviewed_story_testimonial_status, view.body.data.source_permissions.allowed_use_status,
          view.body.data.source_permissions.ai_processing_allowed, view.body.data.source_permissions.is_current], ["unknown", "allowed", true, true]);
        assert.equal(view.body.data.review_requirement.responsible_role, "gk_reviewer");
        assert.equal(view.body.data.viewer, "organization_administrator");
      }
      // B: the human meaning stays a disclosed, unverified limitation beside the machine count.
      const s5View = (await findingReview(adminApi, ids.h.s5.claimId)).body.data;
      assert.deepEqual([s5View.measurement.worksheet_key, s5View.measurement.worksheet_name, s5View.measurement.measured_value, s5View.measurement.counted_unit],
        ["sheet_5", "Data_Dictionary", 37, "service event"]);
      assert.ok(s5View.limitations.some((row) => row.code === "measurement.record_meaning_human_defined"
        && /KAI counted the records but did not verify what they represent/.test(row.description)), J(s5View.limitations));
      // The read-only pgAdmin query for the production facts, on this schema.
      const productionSql = readFileSync(new URL("../scripts/kai-measured-finding-eligibility-read-only.sql", import.meta.url), "utf8");
      assert.ok(productionSql.includes("'485b90cd-cdf3-470e-a308-fe75d5d4b5fe'::uuid, ''::text"), "the shipped parameters");
      const runReadOnly = async (email) => {
        const sql = productionSql.replace("'485b90cd-cdf3-470e-a308-fe75d5d4b5fe'::uuid, ''::text", `'${ids.h.s5.source_version_id}'::uuid, '${email}'::text`);
        const client = await seedPool.connect();
        try {
          await client.query("BEGIN READ ONLY");
          const { rows } = await client.query(sql);
          await client.query("ROLLBACK");
          return Object.fromEntries(rows.map((row) => [row.item.replace(/ [0-9a-f-]{36}$/, ""), row.value]));
        } finally {
          client.release();
        }
      };
      const asAdmin = await runReadOnly(`user${USERS.clientAdmin}@harbourline.test`);
      assert.deepEqual([asAdmin["R4 source_version.is_current"], asAdmin["sensitivity_decision.current_heads"], asAdmin["R5 sensitivity_decision.decision_outcome"],
        asAdmin["R6 reviewed_allowed_use_status"], asAdmin["R6 reviewed_llm_processing_allowed"], asAdmin["R7 reviewed_story_testimonial_status"],
        asAdmin["R7 reviewed_minor_data_status"], asAdmin["measurement.count"], asAdmin["A0 actor.found (params.actor_email)"],
        asAdmin["A3 actor.may_record_gk_evidence_review (excluding platform superuser)"]],
      ["true", "1", "reviewed", "allowed", "true", "unknown", "absent", "1", "1", "false"], J(asAdmin));
      assert.match(asAdmin.measurement, /R1 evidence_type=source_record_count_measurement; R2 definition_status=human_confirmed, same_version=true; method=p1_xlsx_selected_worksheet_data_rows_excluding_blank_v1; sheet_key=sheet_5; measured=37 \(data 37, blank 0, duplicates 0\)/);
      assert.match(asAdmin.claim, /R3 claim_type=finding; claim_review_status=needs_gk_review/);
      assert.equal(asAdmin["evidence_review_decision.heads"], "none");
      const asReviewer = await runReadOnly(`user${USERS.gkReviewer}@harbourline.test`);
      assert.equal(asReviewer["A3 actor.may_record_gk_evidence_review (excluding platform superuser)"], "true", J(asReviewer));
      results.h1 = { bases, ordinary: "eligible with 0 decisions", restricted: "story_testimonial_not_cleared (recorded unknown)", s5: [s5View.measurement.worksheet_name, s5View.measurement.measured_value],
        readOnlySql: { story: asAdmin["R7 reviewed_story_testimonial_status"], adminMayRecordGkReview: false, gkReviewerMayRecordGkReview: true } };
    });

    await test("H2 (C): the organization administrator sees 'View review status' with the responsible Get Kinder role and the review items, and no approval", async () => {
      await openStudioTab("Data Sources");
      const action = `[data-client-open-measured-claim-review="${ids.h.s5.claimId}"]`;
      await adminPage.waitFor(async () => /View review status/.test((await textOf(adminPage, action)) || ""), "View review status on the restricted claim");
      const mark = adminPage.mark();
      await adminPage.clickIn(action, "View review status");
      const status = `[data-client-measured-claim-review="${ids.h.s5.claimId}"] [data-client-measured-claim-review-status]`;
      await adminPage.waitFor(async () => Boolean(await textOf(adminPage, status)), "the review status");
      await adminPage.idle();
      const shown = await textOf(adminPage, `[data-client-measured-claim-review="${ids.h.s5.claimId}"]`);
      assert.match(shown, /Worksheet counted: Data_Dictionary \(sheet_5\)/);
      assert.match(shown, /Stories or testimonials: not determined \(recorded as unknown\)/);
      assert.doesNotMatch(shown, /recorded as present/);
      assert.match(shown, /Get Kinder review required\. Responsible: a Get Kinder reviewer \(gk_reviewer\)\. Outstanding: [^.]*claim review[^.]*evidence review/);
      assert.match(shown, /Evidence review item: open \/ needs gk review\. Claim review item: open \/ needs gk review\./);
      assert.match(shown, /listed in Get Kinder's Review Queue; no separate request is needed/);
      assert.match(shown, /KAI counted the records but did not verify what they represent/);
      assert.doesNotMatch(shown, /Confirm: the count is supported|Report a problem/, "no organization decision is offered");
      assert.deepEqual(adminPage.requestsSince(mark).filter((request) => request.method !== "GET"), [], "viewing writes nothing");
      // The handoff is real: the claim is in Get Kinder's Review Queue.
      const queue = await gkApi("GET", `${orgPath()}/review-queue`);
      assert.equal(queue.status, 200, J(queue.body));
      assert.ok(J(queue.body).includes(ids.h.s5.claimId), "the restricted claim is listed for Get Kinder");
      // The organization administrator cannot decide it.
      const evidenceQueue = await queueOf("evidence_review", ids.h.s5.evidenceItemId);
      const refused = await adminApi("POST", evidenceReviewCompletePath(ORG_X, ids.h.s5.evidenceItemId, evidenceQueue.review_queue_item_id),
        evidenceReviewDecisionBody({ expectedUpdatedAt: new Date(evidenceQueue.updated_at).toISOString(), decision: "supported" }));
      assert.equal(refused.status, 422, J(refused.body));
      assert.ok(J(refused.body).includes("story_testimonial_not_cleared"), J(refused.body));
      results.h2 = { clientAction: "View review status", responsible: "gk_reviewer", organizationDecision: refused.status };
    });

    await test("H3 (C): Get Kinder's reviewer opens 'Review finding' in the Claims list, sees the finding, and records the evidence, claim and coverage decisions through the existing forms; they persist, are audited and re-read", async () => {
      const entry = ids.h.s3Restricted;
      await gkPage.goto("/impact-library");
      await gkPage.waitForText("Knowledge Studio");
      await gkPage.clickNav("Knowledge Studio");
      await gkPage.idle();
      const currentOrganization = await gkPage.evaluate(`document.querySelector(".gk-shell-org-switcher-btn")?.innerText || ""`);
      if (!currentOrganization.includes("Harbourline Workbook Society")) {
        assert.ok(await gkPage.evaluate(`(() => { const b = document.querySelector(".gk-shell-org-switcher-btn"); if (!b) return false; b.click(); return true; })()`), "organization switcher");
        await gkPage.waitFor(async () => gkPage.evaluate(`[...document.querySelectorAll(".gk-shell-org-switcher-option")].some((el) => el.innerText.trim() === "Harbourline Workbook Society")`), "the organization option");
        assert.ok(await gkPage.evaluate(`(() => { const o = [...document.querySelectorAll(".gk-shell-org-switcher-option")].find((el) => el.innerText.trim() === "Harbourline Workbook Society"); if (!o) return false; o.click(); return true; })()`));
        await gkPage.idle();
      }
      const action = `[data-gk-review-finding="${entry.claimId}"]`;
      await gkPage.waitFor(async () => Boolean(await textOf(gkPage, action)), "Review finding on the restricted Service_Events claim");
      assert.equal(await textOf(gkPage, action), "Review finding");
      assert.ok(await textOf(gkPage, `[data-gk-review-finding="${ids.h.s3Ordinary.claimId}"]`), "every measured finding offers it");
      await gkPage.clickIn(action, "Review finding");
      const panel = `[data-gk-finding-review="${entry.claimId}"]`;
      await gkPage.waitFor(async () => /Service_Events \(sheet_3\)/.test((await textOf(gkPage, panel)) || ""), "the finding for the selected claim");
      await gkPage.idle();
      assert.equal(await gkPage.evaluate("document.activeElement?.innerText.includes('Traceability') ?? false"), true, "focus moves to the finding's Traceability panel");
      const shown = await textOf(gkPage, panel);
      assert.match(shown, /Counted: 364 service events/);
      assert.match(shown, /364 data records; 0 blank excluded; 2 exact duplicates included/);
      assert.match(shown, /Meaning, as defined by the organization \(not verified by KAI\): one record is one service event\./);
      assert.match(shown, /Ordinary internal rule: does not apply[\s\S]*Stories or testimonials: not determined \(recorded as unknown\)/);
      assert.match(shown, /Not eligible for internal use/);

      // Evidence review, through the existing Traceability form.
      const evidenceBefore = await queueOf("evidence_review", entry.evidenceItemId);
      let mark = gkPage.mark();
      await gkPage.clickIn("#evidence-review-decision-supported", "evidence decision: supported");
      await gkPage.clickButton("Record Evidence Review Decision");
      await gkPage.waitFor(async () => /Evidence review: supported \(recorded by Get Kinder\)/.test((await textOf(gkPage, panel)) || ""), "the re-read evidence decision");
      await gkPage.idle();
      const posts = () => gkPage.requestsSince(mark).filter((request) => request.method === "POST").map((request) => [new URL(request.url).pathname, request.status]);
      assert.deepEqual(posts(), [[evidenceReviewCompletePath(ORG_X, entry.evidenceItemId, evidenceBefore.review_queue_item_id), 200]]);
      // Stale: replaying the pre-decision version is refused and writes nothing.
      const stale = await gkApi("POST", evidenceReviewCompletePath(ORG_X, entry.evidenceItemId, evidenceBefore.review_queue_item_id),
        evidenceReviewDecisionBody({ expectedUpdatedAt: new Date(evidenceBefore.updated_at).toISOString(), decision: "not_supported" }));
      assert.equal(stale.status, 409, J(stale.body));

      // Claim review (internal only).
      const claimBefore = await queueOf("claim_review", entry.claimId);
      mark = gkPage.mark();
      await gkPage.clickIn("#claim-review-decision-approved", "claim decision: approved");
      await gkPage.clickIn("#claim-approved-audience-internal", "internal audience");
      await gkPage.clickButton("Record Claim Review Decision");
      await gkPage.waitFor(async () => /Claim review: approved \(recorded by Get Kinder\)/.test((await textOf(gkPage, panel)) || ""), "the re-read claim decision");
      await gkPage.idle();
      assert.deepEqual(posts(), [[claimReviewCompletePath(ORG_X, entry.claimId, claimBefore.review_queue_item_id), 200]]);
      const afterReviews = await internalEligibility(entry.claimId);
      assert.equal(afterReviews.eligible, false, "approving the evidence and claim does not clear coverage");
      assert.deepEqual(afterReviews.blockerCodes, ["coverage_dimension_unresolved"], J(afterReviews.blockerCodes));

      // Coverage: accept each unresolved limitation from the finding.
      const unresolved = await gkPage.evaluate(`[...document.querySelectorAll(${J(`${panel} [data-gk-finding-accept-limitation]`)})].map((el) => el.getAttribute("data-gk-finding-accept-limitation"))`);
      assert.deepEqual([...unresolved].sort(), ["conflicting_source_indicators", "requirement_alignment", "small_cell_risk"]);
      for (const dimensionKey of unresolved) {
        mark = gkPage.mark();
        await gkPage.clickIn(`${panel} [data-gk-finding-accept-limitation="${dimensionKey}"]`, `accept ${dimensionKey}`);
        await gkPage.waitFor(async () => !(await textOf(gkPage, `${panel} [data-gk-finding-accept-limitation="${dimensionKey}"]`)), `${dimensionKey} accepted`);
        await gkPage.idle();
        assert.deepEqual(posts(), [[`${orgPath()}/claims/${entry.claimId}/coverage-dimensions/${dimensionKey}/internal-acceptance`, 201]]);
      }
      await gkPage.waitFor(async () => (await gkPage.evaluate(`document.querySelector(${J(`${panel} [data-gk-finding-eligibility]`)})?.getAttribute("data-gk-finding-eligibility")`)) === "eligible", "eligible after the re-read");

      // Persisted, attributed and audited; a fresh read agrees.
      const [evidenceDecision] = await query("SELECT decision_id::text, decision_outcome, decided_by_role FROM kai.evidence_review_decisions WHERE evidence_item_id = $1::uuid", [entry.evidenceItemId]);
      const [claimDecision] = await query("SELECT decision_id::text, decision_outcome, decided_by_role, approved_audiences FROM kai.claim_review_decisions WHERE claim_id = $1::uuid", [entry.claimId]);
      assert.deepEqual([evidenceDecision.decision_outcome, evidenceDecision.decided_by_role], ["supported", "gk_reviewer"]);
      assert.deepEqual([claimDecision.decision_outcome, claimDecision.decided_by_role, claimDecision.approved_audiences], ["approved", "gk_reviewer", ["internal"]]);
      const audits = await query("SELECT metadata->>'decision_id' AS decision_id FROM kai.upload_lifecycle_audit WHERE organization_id = $1::uuid AND metadata->>'decision_id' = ANY($2::text[])",
        [ORG_X, [evidenceDecision.decision_id, claimDecision.decision_id]]);
      assert.deepEqual(audits.map((row) => row.decision_id).sort(), [evidenceDecision.decision_id, claimDecision.decision_id].sort(), "one audit row per decision");
      assert.deepEqual(await decisionCounts(entry.claimId, entry.evidenceItemId), { evidence: 1, claim: 1, coverage: 3 });
      const fresh = await internalEligibility(entry.claimId);
      assert.deepEqual([fresh.eligible, fresh.blockerCodes], [true, []]);
      const freshView = (await findingReview(gkApi, entry.claimId)).body.data;
      assert.equal(freshView.viewer, "get_kinder_reviewer");
      // Independent restrictions stay: the source's recorded category, the
      // unverified meaning, unresolved coverage (accepted only as limitations),
      // and funder/public eligibility.
      assert.deepEqual(freshView.ordinary_internal_rule, { applies: false, reasons: ["story_testimonial_not_cleared"], basis: null });
      assert.equal(freshView.source_permissions.categories.reviewed_story_testimonial_status, "unknown");
      assert.ok(freshView.limitations.some((row) => row.code === "measurement.record_meaning_human_defined"));
      assert.deepEqual(freshView.coverage_limitations.filter((row) => row.assessment_status === "unresolved").map((row) => [row.dimension_key, row.internal_limitation_accepted]).sort(),
        [["conflicting_source_indicators", true], ["requirement_alignment", true], ["small_cell_risk", true]]);
      for (const audience of ["funder", "public"]) assert.equal((await internalEligibility(entry.claimId, audience)).eligible, false, `${audience} stays closed`);
      const queue = await gkApi("GET", `${orgPath()}/review-queue`);
      assert.ok(!J(queue.body).includes(entry.claimId), "the reviewed claim leaves the Review Queue");
      assert.ok(J(queue.body).includes(ids.h.s5.claimId), "the unreviewed claim stays");
      results.h3 = { gkAction: "Review finding", evidence: evidenceDecision.decision_outcome, claim: claimDecision.decision_outcome, coverage: unresolved.length, eligible: true, stale: stale.status };
    });

    await test("H4 (C): Get Kinder's reviewer asks for more information on the Data_Dictionary count; no claim decision is offered and it stays restricted", async () => {
      const entry = ids.h.s5;
      const action = `[data-gk-review-finding="${entry.claimId}"]`;
      await gkPage.clickIn(action, "Review finding");
      const panel = `[data-gk-finding-review="${entry.claimId}"]`;
      await gkPage.waitFor(async () => /Data_Dictionary \(sheet_5\)/.test((await textOf(gkPage, panel)) || ""), "the Data_Dictionary finding");
      await gkPage.idle();
      assert.match(await textOf(gkPage, panel), /Counted: 37 service events/);
      await gkPage.clickIn("#evidence-review-decision-needs_more_information", "evidence decision: needs more information");
      await gkPage.clickButton("Record Evidence Review Decision");
      await gkPage.waitFor(async () => /Evidence review: needs more information \(recorded by Get Kinder\)/.test((await textOf(gkPage, panel)) || ""), "the re-read decision");
      await gkPage.idle();
      assert.equal(await gkPage.evaluate(`[...document.querySelectorAll("button")].some((el) => el.offsetParent !== null && el.innerText.trim() === "Record Claim Review Decision")`), false,
        "a claim decision needs a terminal evidence decision");
      const after = await internalEligibility(entry.claimId);
      assert.equal(after.eligible, false);
      assert.ok(after.blockerCodes.includes("evidence_review_unresolved"), J(after.blockerCodes));
      assert.deepEqual(await decisionCounts(entry.claimId, entry.evidenceItemId), { evidence: 1, claim: 0, coverage: 0 });
      results.h4 = { evidence: "needs_more_information", claimFormOffered: false, eligible: false };
    });

    await test("H5 (C): other roles, another organization and Get Kinder roles without decision authority are refused; nothing is written", async () => {
      const entry = ids.h.s5;
      const before = await decisionCounts(entry.claimId, entry.evidenceItemId);
      const evidenceQueue = await queueOf("evidence_review", entry.evidenceItemId);
      const claimQueue = await queueOf("claim_review", entry.claimId);
      const evidenceBody = evidenceReviewDecisionBody({ expectedUpdatedAt: new Date(evidenceQueue.updated_at).toISOString(), decision: "supported" });
      const claimBody = claimReviewDecisionBody({ expectedUpdatedAt: new Date(claimQueue.updated_at).toISOString(), decision: "approved", approvedAudiences: ["internal"] });
      for (const [label, api] of [["client_contributor", contributorApi], ["client_reviewer", reviewerApi], ["another organization's administrator", adminYApi]]) {
        assert.equal((await findingReview(api, entry.claimId)).status, 403, `${label}: finding read`);
        assert.equal((await api("POST", evidenceReviewCompletePath(ORG_X, entry.evidenceItemId, evidenceQueue.review_queue_item_id), evidenceBody)).status, 403, `${label}: evidence`);
        assert.equal((await api("POST", claimReviewCompletePath(ORG_X, entry.claimId, claimQueue.review_queue_item_id), claimBody)).status, 403, `${label}: claim`);
      }
      // Cross-tenant: Get Kinder's reviewer reading this claim through another organization's path.
      const crossTenant = await gkApi("GET", organizationFactualReviewPath(ORG_Y, entry.claimId));
      assert.ok([403, 404].includes(crossTenant.status), J(crossTenant.body));
      assert.deepEqual(await decisionCounts(entry.claimId, entry.evidenceItemId), before);
      results.h5 = { refused: ["client_contributor", "client_reviewer", "other organization admin", "cross-tenant path"] };
    });

    await test("H6 (D): the reviewed measured claim reaches internal Evidence Summary generation with its citation and limitations; an unreviewed claim is refused; historical records are unchanged", async () => {
      const entry = ids.h.s3Restricted;
      const [{ statement }] = await query("SELECT statement FROM kai.claims WHERE claim_id = $1::uuid", [entry.claimId]);
      modelOverride.text = `${statement} This is a count of source records under the human-defined definition; no reporting period was defined. `
        + "The exact-duplicate records are counted, not removed. Internal limitations: small-cell risk, conflicting source indicators and "
        + "requirement alignment are accepted as limitations for internal use only.";
      const callsBefore = modelCalls.length;
      const generated = await generate(adminApi, "evidence-summary", [entry.claimId], "h-reviewed-summary");
      assert.ok([200, 201].includes(generated.status), J(generated.body));
      const draftId = generated.body.data.generatedContentDraftId;
      const [input] = modelCalls.slice(callsBefore).map((call) => call.claims);
      const cited = input.find((claim) => claim.claimId === entry.claimId);
      assert.ok(cited, "the reviewed claim is in the generation input");
      assert.ok(cited.limitationCodes.includes("measurement.record_meaning_human_defined"), J(cited.limitationCodes));
      assert.ok(cited.limitationCodes.includes("measurement.duplicate_records_included"), J(cited.limitationCodes));
      assert.ok(cited.limitationCodes.some((code) => code.startsWith("coverage.") && code.endsWith(".accepted_internal_limitation")), J(cited.limitationCodes));
      const citations = await query(
        `SELECT c.claim_id::text, c.evidence_item_id::text FROM kai.generated_content_citations c
           JOIN kai.generated_content_blocks b ON b.generated_content_block_id = c.generated_content_block_id
          WHERE b.generated_content_draft_id = $1::uuid`, [draftId]);
      assert.deepEqual(citations, [{ claim_id: entry.claimId, evidence_item_id: entry.evidenceItemId }]);
      const read = await adminApi("GET", clientInternalDraftPath(ORG_X, PROJECT_X, draftId));
      assert.equal(read.status, 200, J(read.body));
      assert.ok(J(read.body).includes(entry.claimId), "the persisted draft is read back with its citation");
      // An unreviewed (ineligible) measured claim is excluded: the request is refused and nothing is persisted.
      const draftsBefore = (await query("SELECT count(*)::int AS n FROM kai.generated_content_drafts WHERE organization_id = $1::uuid", [ORG_X]))[0].n;
      const callsBeforeRefusal = modelCalls.length;
      const refused = await generate(adminApi, "evidence-summary", [entry.claimId, ids.h.s5.claimId], "h-with-unreviewed");
      modelOverride.text = null;
      assert.equal(refused.status, 422, J(refused.body));
      const refusalReasons = (refused.body.blockers || []).map((blocker) => blocker.blocking_reason);
      console.log(`[kai-customer-xlsx-file-to-report] H6 unreviewed refusal ${J({ refusalReasons, modelCalled: modelCalls.length > callsBeforeRefusal })}`);
      assert.ok(!refusalReasons.includes("unsupported_numeric_or_causal_assertion") && !refusalReasons.includes("material_limitation_not_disclosed"),
        `refused for the claim's eligibility, not the stub's text: ${J(refusalReasons)}`);
      assert.equal((await query("SELECT count(*)::int AS n FROM kai.generated_content_drafts WHERE organization_id = $1::uuid", [ORG_X]))[0].n, draftsBefore);
      // Historical records unchanged: every measurement row, and the structural-only draft.
      assert.equal(await measurementRowsDigest(), ids.h.measurementDigest, "no measurement row was rewritten by review or generation");
      assert.equal(await ids.h.draftDigest(ids.h.structuralDraftId), ids.h.structuralDigest, "the structural-only draft is unchanged");
      results.h6 = { draft: draftId, citations: citations.length, limitationCodes: cited.limitationCodes, unreviewedRefused: [refused.status, refusalReasons] };
      assert.deepEqual(gkPage.exceptions, []);
      await gkPage.close();
    });

    // -----------------------------------------------------------------------
    // I: count-only internal authority for a story-present source (owner
    // prompt 2026-10-30). Synthetic sensitive sentinels sit in worksheet
    // cells, a header, the file name and every free-text definition field;
    // none may reach the model request, the stored draft or the Markdown.
    // -----------------------------------------------------------------------
    const SENTINEL = Object.freeze({
      cell: "SENTINEL-CELL-TESTIMONIAL", note: "SENTINEL-NOTE-STORY", header: "SENTINEL_HEADER_STORY", file: "sentinelfile",
      definition: "SENTINEL-DEFINITION-TEXT", inclusion: "SENTINEL-INCLUSION-TEXT", exclusion: "SENTINEL-EXCLUSION-TEXT",
    });
    const SENTINEL_RE = /SENTINEL[-_]|sentinelfile|changed my life|gave us hope/;
    // Cell values, column names and worksheet names other than the counted one's identity.
    const SOURCE_TEXT_RE = /staff_comment|event_ref|service_type|participant_code|field_name|E001|E900|"visit"|synthetic description|Read_Me|Funder_Notes|Participant_Register/;
    const testimonialServiceRows = (tag) => serviceEventRows(tag).map((row, index) => (index === 0
      ? [...row, "staff_comment"]
      : [...row, index % 50 === 1 ? `${SENTINEL.cell}: "It changed my life," said one participant.` : "none"]));
    const countOnlyWorkbook = (tag) => customerFile(`count-only-${SENTINEL.file}-${tag}.xlsx`, syntheticXlsxWorkbook({ sheets: [
      { name: "Read_Me", rows: [["note"], [`${SENTINEL.note}: a parent told staff "the programme gave us hope".`]] },
      { name: "Participant_Register", rows: [["participant_code", "cohort"], ...Array.from({ length: 84 }, (_, index) => [`P${String(index + 1).padStart(3, "0")}`, index % 2 ? "A" : "B"])] },
      { name: "Service_Events", rows: testimonialServiceRows(tag) },
      { name: "Funder_Notes", rows: [[SENTINEL.header], [`${SENTINEL.note} testimonial`]] },
      { name: "Data_Dictionary", rows: [["field_name", "description"], ...Array.from({ length: 37 }, (_, index) => [`field_${index + 1}`, `synthetic description ${index + 1}`])] },
    ] }));
    const STORY_PRESENT = Object.freeze({ ...SNAPSHOT, reviewed_story_testimonial_status: "present" });
    // A correct human definition of a worksheet row of Service_Events, with sentinels in its free text.
    const ROW_DEFINITION = Object.freeze({
      counted_unit: "service event record", unit_label: "service event records",
      definition_text: `${SENTINEL.definition} each row of the selected worksheet is one service event record.`,
      inclusion_rule: `${SENTINEL.inclusion} every data row after the header row.`,
      exclusion_rule: `${SENTINEL.exclusion} the header row and empty rows.`,
      period_start: "2026-09-01", period_end: "2026-09-30",
    });
    const ROW_STATEMENT = "The promoted source records 364 service event records for the reporting period 2026-09-01 to 2026-09-30 in selected worksheet sheet_3 "
      + "(record count: one service event record per selected worksheet data row; 0 blank records excluded, 2 exact-duplicate records included).";
    const ROW_TEXT = "In selected worksheet sheet_3 the promoted source records 364 service event records for the reporting period 2026-09-01 to 2026-09-30. "
      + "This is a count of worksheet records, one per row, under the human-defined definition; KAI did not check what each row represents. "
      + "The period is attested in that definition and not verified against record dates. 2 exact-duplicate rows are included in the count, not removed. "
      + "Internal limitations: small-cell risk, conflicting source indicators and requirement alignment remain unresolved and are carried with the count.";
    const DICTIONARY_TEXT = "In selected worksheet sheet_5 the promoted source records 37 service events. This is a count of worksheet records under the human-defined "
      + "definition; KAI did not check what each row represents. No reporting period is defined. Internal limitations: small-cell risk, conflicting source "
      + "indicators and requirement alignment remain unresolved and are carried with the count.";
    const countOnlyMeasure = async (tag, worksheetKey, definition, snapshot = STORY_PRESENT) => {
      const file = countOnlyWorkbook(tag);
      const fileId = await apiUpload(adminApi, file, ids.batchId);
      await dispatcher.whenIdle();
      const promoted = await decideAndPromote(adminApi, fileId, snapshot);
      const measured = await adminApi("POST", sourceRecordCountMeasurementPath(ORG_X, promoted.source_version_id, worksheetKey), definition);
      assert.equal(measured.status, 200, J(measured.body));
      const evidenceItemId = measured.body.data.evidenceItem.evidence_item_id;
      const proposed = await adminApi("POST", claimProposalPath(ORG_X, evidenceItemId), {});
      assert.ok([200, 201].includes(proposed.status), J(proposed.body));
      return { fileId, file, ...promoted, evidenceItemId, claimId: proposed.body.data.claim.claim_id };
    };
    const draftCount = async () => (await query("SELECT count(*)::int AS n FROM kai.generated_content_drafts WHERE organization_id = $1::uuid", [ORG_X]))[0].n;
    const storyCategoryOf = async (sensitivityProfileId) => (await query(
      "SELECT reviewed_story_testimonial_status FROM kai.intake_sensitivity_review_decisions WHERE intake_sensitivity_profile_id = $1::uuid", [sensitivityProfileId]))[0].reviewed_story_testimonial_status;
    const queueStates = async (entry) => [
      (await queueOf("evidence_review", entry.evidenceItemId)).queue_status,
      (await query("SELECT review_status FROM kai.review_queue_items WHERE target_object_id = $1::uuid AND queue_type = 'claim_review'", [entry.claimId]))[0].review_status,
    ];

    await test("I1: a story-present five-worksheet workbook's Service_Events count (364 rows, 2 exact duplicates) persists with its worksheet identity, the claim restates it exactly, and it is internally usable as a count only with no decision", async () => {
      const approvalsBefore = await approvalState();
      const entry = await countOnlyMeasure("i-positive", "sheet_3", ROW_DEFINITION);
      ids.i = { row: entry, approvalsBefore };
      const [row] = await query(
        `SELECT m.measured_value::int, m.total_record_count::int, m.blank_record_count::int, m.duplicate_record_count::int, m.calculation_method,
                l.coordinates, c.statement, c.claim_type
           FROM kai.evidence_measurements m JOIN kai.evidence_items e ON e.evidence_item_id = m.evidence_item_id
           JOIN kai.source_locators l ON l.source_locator_id = e.source_locator_id JOIN kai.claims c ON c.evidence_item_id = e.evidence_item_id
          WHERE m.evidence_item_id = $1::uuid`, [entry.evidenceItemId]);
      // The worksheet's identity: its locator key, and its name from the version's committed profile (the authorized read).
      const persisted = (await findingReview(adminApi, entry.claimId)).body.data.measurement;
      Object.assign(row, { worksheet_key: persisted.worksheet_key, worksheet_name: persisted.worksheet_name });
      assert.deepEqual([row.measured_value, row.total_record_count, row.blank_record_count, row.duplicate_record_count, row.calculation_method, row.worksheet_key, row.worksheet_name, row.coordinates],
        [364, 364, 0, 2, SELECTED_XLSX_METHOD, "sheet_3", "Service_Events", { scope: "data_records_after_header", sheet_key: "sheet_3" }]);
      assert.deepEqual([row.claim_type, row.statement], ["finding", ROW_STATEMENT], "the claim is exactly the governed restatement");
      // The shared authority: eligible for internal use, as a count only, with no evidence, claim or coverage decision.
      const internal = await internalEligibility(entry.claimId);
      assert.deepEqual([internal.eligible, internal.blockerCodes], [true, []], J(internal.blockerCodes));
      assert.deepEqual(await decisionCounts(entry.claimId, entry.evidenceItemId), { evidence: 0, claim: 0, coverage: 0 });
      for (const audience of ["funder", "public"]) assert.equal((await internalEligibility(entry.claimId, audience)).eligible, false, `${audience} needs its own authority`);
      const view = (await findingReview(adminApi, entry.claimId)).body.data;
      assert.deepEqual([view.ordinary_internal_rule, view.review_requirement, view.internal_eligibility],
        [{ applies: true, reasons: [], basis: "count_only_story_testimonial_present" }, null, { eligible: true, blocker_codes: [] }]);
      assert.deepEqual([view.source_permissions.categories.reviewed_story_testimonial_status, view.source_permissions.allowed_use_status, view.source_permissions.ai_processing_allowed],
        ["present", "allowed", true]);
      // P2-08: the eligible-claims projection lists it for internal use, and not for funder use.
      const listedFor = async (audience) => {
        let after = null;
        for (let page = 0; page < 40; page += 1) {
          const listed = await gkApi("GET", `${eligibleClaimsPath(ORG_X, audience)}${after ? `&after_claim_id=${after}` : ""}`);
          assert.equal(listed.status, 200, J(listed.body));
          if (J(listed.body.data).includes(entry.claimId)) return true;
          after = listed.body.data.nextAfterClaimId;
          if (!after) return false;
        }
        return false;
      };
      const eligibleClaims = { internal: await listedFor("internal"), funder: await listedFor("funder") };
      assert.deepEqual(eligibleClaims, { internal: true, funder: false });
      // Nothing was recorded: no decision, no queue resolution, the category unchanged.
      assert.deepEqual(await queueStates(entry), ["open", "needs_gk_review"]);
      assert.equal(await storyCategoryOf(entry.intake_sensitivity_profile_id), "present");
      assert.deepEqual(await approvalState(), approvalsBefore);
      results.i1 = { measured: [row.measured_value, row.duplicate_record_count, row.worksheet_name, row.worksheet_key], statement: row.statement, eligible: true,
        basis: view.ordinary_internal_rule.basis, decisions: 0, eligibleClaimsProjection: eligibleClaims };
    });

    await test("I2: the administrator sees the count-only basis, generates the Evidence Summary in the drafting UI and opens its internal Markdown; the model request, stored draft and report carry the governed count only", async () => {
      const entry = ids.i.row;
      await openStudioTab("Data Sources");
      await adminPage.waitFor(async () => Boolean(await textOf(adminPage, `[data-client-claim="${entry.claimId}"]`)), "the count-only claim");
      await adminPage.clickIn(`[data-client-open-measured-claim-review="${entry.claimId}"]`, "View measurement");
      const panel = `[data-client-measured-claim-review="${entry.claimId}"]`;
      await adminPage.waitFor(async () => Boolean(await textOf(adminPage, `${panel} [data-client-measured-claim-count-only]`)), "the count-only explanation");
      const shownReview = await textOf(adminPage, panel);
      assert.match(shownReview, /Worksheet counted: Service_Events \(sheet_3\)/);
      assert.match(shownReview, /internal Evidence Summary as a record count, with no story or testimonial content/);
      assert.doesNotMatch(shownReview, /Get Kinder review required|Confirm: the count is supported/);
      // Generate in the drafting interface.
      await openStudioTab("Data Sources");
      await adminPage.waitFor(async () => Boolean(await textOf(adminPage, `[data-client-claim="${entry.claimId}"]`)), "the count-only claim");
      modelOverride.text = ROW_TEXT;
      const callsBefore = modelCalls.length;
      await adminPage.clickIn(`[data-client-claim="${entry.claimId}"] input[type=checkbox]`, "Use in an internal draft");
      await adminPage.clickButton("Generate internal evidence summary");
      await adminPage.waitForText("Internal evidence summary created");
      await adminPage.idle();
      modelOverride.text = null;
      // The exact serialized model request: the governed projection only.
      const calls = modelCalls.slice(callsBefore);
      assert.equal(calls.length, 1);
      const [call] = calls;
      assert.deepEqual(call.claims.map((claim) => Object.keys(claim)), [["claimId", "claimStatement", "claimType", "evidenceItemId", "sourceId", "sourceVersionId", "limitationCodes"]]);
      assert.deepEqual([call.claims[0].claimId, call.claims[0].evidenceItemId, call.claims[0].sourceVersionId, call.claims[0].claimStatement, call.claims[0].claimType],
        [entry.claimId, entry.evidenceItemId, entry.source_version_id, ROW_STATEMENT, "finding"]);
      for (const code of ["measurement.duplicate_records_included", "measurement.period_human_attested_not_row_verified", "measurement.record_meaning_human_defined",
        "source.story_testimonial_present_count_only", "coverage.small_cell_risk.unresolved"]) {
        assert.ok(call.claims[0].limitationCodes.includes(code), `${code}: ${J(call.claims[0].limitationCodes)}`);
      }
      assert.ok(call.claims[0].limitationCodes.every((code) => /^(measurement|coverage|source)\.[a-z_.]+$/.test(code)), J(call.claims[0].limitationCodes));
      assert.match(call.system, /source\.story_testimonial_present_count_only/);
      assert.doesNotMatch(call.serialized, SENTINEL_RE, "no sentinel (cells, header, file name, definition text) in the model request");
      assert.doesNotMatch(call.serialized, SOURCE_TEXT_RE, "no cell value, column name or other worksheet in the model request");
      assert.doesNotMatch(call.serialized, /Service_Events|Data_Dictionary/, "the worksheet is identified only by its key");
      // The persisted draft, its citation and its validator results.
      const [draft] = await query(
        "SELECT generated_content_draft_id::text, content_type, requested_audience, validator_results FROM kai.generated_content_drafts WHERE organization_id = $1::uuid ORDER BY created_at DESC LIMIT 1", [ORG_X]);
      assert.deepEqual([draft.content_type, draft.requested_audience], ["evidence_summary", "internal"]);
      assert.deepEqual(draft.validator_results.map((result) => [result.validator_key, result.severity]),
        [["VAL-GEN-001", "pass"], ["VAL-GEN-002", "pass"], ["VAL-GEN-003", "pass"], ["VAL-GEN-004", "pass"], ["VAL-GEN-008", "pass"], ["VAL-GEN-010", "pass"], ["VAL-GEN-005", "pass"]]);
      const stored = await query(
        `SELECT b.text, c.claim_id::text, c.evidence_item_id::text FROM kai.generated_content_blocks b
           JOIN kai.generated_content_citations c ON c.generated_content_block_id = b.generated_content_block_id WHERE b.generated_content_draft_id = $1::uuid`,
        [draft.generated_content_draft_id]);
      assert.deepEqual(stored, [{ text: ROW_TEXT, claim_id: entry.claimId, evidence_item_id: entry.evidenceItemId }]);
      // Open the internal report in the UI; the download through the normal client route is the report shown.
      await adminPage.waitFor(async () => Boolean(await textOf(adminPage, `[data-client-open-internal-report="${draft.generated_content_draft_id}"]`)), "the internal report action");
      await adminPage.clickIn(`[data-client-open-internal-report="${draft.generated_content_draft_id}"]`, "Open report");
      await adminPage.waitFor(async () => ((await textOf(adminPage, "[data-client-internal-report-markdown]")) || "").startsWith("# Internal Evidence Summary"), "the report");
      const shown = await textOf(adminPage, "[data-client-internal-report-markdown]");
      const fetched = await fetchText(adminPage, clientInternalReportMarkdownPath(ORG_X, PROJECT_X, draft.generated_content_draft_id));
      assert.deepEqual([fetched.status, fetched.body], [200, shown], "the download is the report shown");
      const section = (from, to) => shown.slice(shown.indexOf(`\n## ${from}\n`), shown.indexOf(`\n## ${to}\n`));
      assert.match(section("Key findings", "Reporting period"), /contains \*\*364 non-blank data rows in worksheet Service_Events \(`sheet_3`\)\*\* for the stated reporting period 2026-09-01 to 2026-09-30\. A person at the organization defined each row as one service event record; KAI did not verify that meaning, so this is a count of rows, not an established count of service event records\./);
      assert.match(shown, /364 data records after the header, minus 0 blank records excluded = \*\*364\*\* counted/);
      assert.match(shown, /2 exact-duplicate records\. They are included in the count of 364, not removed or merged/);
      assert.match(shown, /Definition, inclusion and exclusion text:\*\* not reproduced/);
      assert.match(shown, /used for its record count only: no story or testimonial content is used, and its recorded category is unchanged/);
      assert.match(shown, /a count-only use of a source recorded as containing stories or testimonials/);
      assert.match(shown, /`source\.story_testimonial_present_count_only`/);
      assert.match(shown, /`measurement\.record_meaning_human_defined`/);
      assert.match(shown, /`VAL-GEN-010`/);
      for (const id of [entry.claimId, entry.evidenceItemId, entry.source_version_id]) assert.ok(shown.includes(`\`${id}\``), id);
      assert.ok(shown.includes(`${ROW_TEXT} [CIT-001]`), "the validated generated text, cited");
      assert.doesNotMatch(shown, SENTINEL_RE, "no sentinel in the delivered report");
      assert.doesNotMatch(shown, SOURCE_TEXT_RE, "no cell value, column name or other worksheet in the delivered report");
      for (const affirmed of [section("Key findings", "Reporting period"), section("What this evidence establishes", "What this evidence does not establish"),
        section("Generated narrative", "Source and evidence traceability"), section("Conclusion", "References")]) {
        assert.doesNotMatch(affirmed.replace(/not evidence of the number of people reached, of distinct sessions, of outcomes, or of impact/, ""),
          /participant|people|unique|distinct|outcome|completion|(?<!not )verified|because of|caused|increase|impact/i, "no person, completion, outcome or causal claim");
      }
      writeFileSync(join(WORKDIR, "xlsx-i-count-only-evidence-summary.md"), shown);
      // Nothing was approved, accepted, released or reclassified.
      assert.deepEqual(await approvalState(), ids.i.approvalsBefore, "no GK approval, coverage acceptance, release decision or manifest");
      assert.deepEqual(await queueStates(entry), ["open", "needs_gk_review"]);
      assert.equal(await storyCategoryOf(entry.intake_sensitivity_profile_id), "present");
      ids.i.rowDraftId = draft.generated_content_draft_id;
      results.i2 = { draft: draft.generated_content_draft_id, markdown: fetched.status, modelRequestClaimKeys: Object.keys(call.claims[0]), limitationCodes: call.claims[0].limitationCodes,
        validators: draft.validator_results.map((result) => result.validator_key), newDecisions: 0, manifests: 0 };
    });

    await test("I3: the count-only claim is refused for every other operation, and adversarial model replies are rejected before anything is stored", async () => {
      const entry = ids.i.row;
      const draftsBefore = await draftCount();
      // Other draft types and audiences.
      const narrative = await generate(adminApi, "impact-narrative", [entry.claimId], "i3-narrative");
      assert.deepEqual([narrative.status, narrative.body.blockers?.map((b) => b.blocking_reason)], [422, ["story_testimonial_count_only_operation_not_permitted"]]);
      // Funder use needs its own authority, which the count-only basis never gives.
      const funder = await gkAdminApi("POST", `${orgPath()}/generated-content-drafts/evidence-summary/funder`, { claim_ids: [entry.claimId], idempotency_key: "i3-funder", engagement_id: PROJECT_X });
      assert.ok([403, 422].includes(funder.status), J(funder.body));
      assert.ok(!J(funder.body).includes("invalid_funder_evidence_summary_generation_request"), "refused for authority, not request shape");
      // Adversarial replies: testimonial quotation, story-derived assertion, unsupported people/outcome/completion claims, an unnamed worksheet.
      const adversarial = {
        "testimonial quotation": `${ROW_TEXT} One attendee said “this changed my life.”`,
        "story-derived assertion": `${ROW_TEXT} Stories shared by families describe a welcoming service.`,
        "unsupported outcome": `${ROW_TEXT} The records show participants achieved better outcomes.`,
        "unique people": `${ROW_TEXT} They represent 364 unique people.`,
        "verified completions": `${ROW_TEXT} These are 364 verified service completions.`,
        "worksheet not named": ROW_TEXT.replace("In selected worksheet sheet_3 the", "The"),
      };
      const rejected = {};
      for (const [label, text] of Object.entries(adversarial)) {
        modelOverride.text = text;
        const reply = await generate(adminApi, "evidence-summary", [entry.claimId], `i3-${label.replace(/\W+/g, "-")}`);
        modelOverride.text = null;
        assert.equal(reply.status, 422, `${label}: ${J(reply.body)}`);
        rejected[label] = (reply.body.blockers || []).map((b) => b.validator_key).sort();
        assert.ok(rejected[label].includes("VAL-GEN-010"), `${label}: ${J(reply.body.blockers)}`);
      }
      assert.equal(await draftCount(), draftsBefore, "nothing was persisted");
      // Other actors and organizations cannot read the count-only report.
      const path = clientInternalReportMarkdownPath(ORG_X, PROJECT_X, ids.i.rowDraftId);
      const refusals = {
        contributor: (await contributorApi("GET", path)).status, reviewer: (await reviewerApi("GET", path)).status,
        otherOrganizationAdmin: (await adminYApi("GET", path)).status, gkReviewerOnCustomerRoute: (await gkApi("GET", path)).status,
        crossTenantPath: (await adminYApi("GET", clientInternalReportMarkdownPath(ORG_Y, PROJECT_Y, ids.i.rowDraftId))).status,
        otherProject: (await adminApi("GET", clientInternalReportMarkdownPath(ORG_X, PROJECT_X2, ids.i.rowDraftId))).status,
      };
      for (const [label, status] of Object.entries(refusals)) assert.ok([403, 404].includes(status), `${label}: ${status}`);
      results.i3 = { impactNarrative: 422, funder: funder.status, adversarialRejected: rejected, refusals };
    });

    await test("I4 (semantic integrity): the misleading Data_Dictionary 37-row 'service events' reading stays a 37-row count of Data_Dictionary whose meaning is unverified; the count-only basis does not make it an established count of service events", async () => {
      const entry = await countOnlyMeasure("i-dictionary", "sheet_5", SERVICE_DEFINITION);
      ids.i.dictionary = entry;
      const [row] = await query(
        "SELECT m.measured_value::int, c.statement FROM kai.evidence_measurements m JOIN kai.claims c ON c.evidence_item_id = m.evidence_item_id WHERE m.evidence_item_id = $1::uuid",
        [entry.evidenceItemId]);
      const persisted = (await findingReview(adminApi, entry.claimId)).body.data.measurement;
      Object.assign(row, { worksheet_key: persisted.worksheet_key, worksheet_name: persisted.worksheet_name });
      assert.deepEqual([row.measured_value, row.worksheet_key, row.worksheet_name], [37, "sheet_5", "Data_Dictionary"], "the actual row count and worksheet identity");
      assert.match(row.statement, /^The promoted source records 37 service events with no reporting period defined in selected worksheet sheet_5 \(record count: one service event per selected worksheet data row;/);
      const view = (await findingReview(adminApi, entry.claimId)).body.data;
      assert.equal(view.ordinary_internal_rule.basis, "count_only_story_testimonial_present");
      assert.ok(view.limitations.some((limitation) => limitation.code === "measurement.record_meaning_human_defined"), "the human meaning stays an unverified limitation");
      // A reply presenting 37 service events as delivered services is refused.
      for (const text of [
        "In sheet_5 the organization delivered 37 service events to participants.",
        "The promoted source records 37 service events, a count of records under the human-defined definition; 37 verified service completions.",
        DICTIONARY_TEXT.replace("In selected worksheet sheet_5 the", "The"),
      ]) {
        modelOverride.text = text;
        const reply = await generate(adminApi, "evidence-summary", [entry.claimId], `i4-${createHash("sha256").update(text).digest("hex").slice(0, 12)}`);
        modelOverride.text = null;
        assert.equal(reply.status, 422, `${text}: ${J(reply.body)}`);
      }
      // The qualified reading is generated, and its report states rows of Data_Dictionary, not service events.
      modelOverride.text = DICTIONARY_TEXT;
      const generated = await generate(adminApi, "evidence-summary", [entry.claimId], "i4-qualified");
      modelOverride.text = null;
      assert.ok([200, 201].includes(generated.status), J(generated.body));
      const report = await adminApi("GET", clientInternalReportMarkdownPath(ORG_X, PROJECT_X, generated.body.data.generatedContentDraftId));
      assert.equal(report.status, 200, J(report.body).slice(0, 400));
      assert.match(report.body, /contains \*\*37 non-blank data rows in worksheet Data_Dictionary \(`sheet_5`\)\*\*\. A person at the organization defined each row as one service event; KAI did not verify that meaning, so this is a count of rows, not an established count of service events\./);
      assert.match(report.body, /That each counted row is one service event \[CIT-001\]: a person at the organization defined that meaning, and KAI did not verify it\./);
      assert.doesNotMatch(report.body, /\*\*37 service events\*\*|records 37 service events for|organization's promoted source records 37/, "37 service events is never the stated finding");
      assert.match(report.body, /## Conclusion\n\nOn the available evidence, the promoted source contains 37 non-blank data rows in worksheet Data_Dictionary \(`sheet_5`\)\. Each figure is a count of rows\./);
      writeFileSync(join(WORKDIR, "xlsx-i-data-dictionary-37.md"), report.body);
      // Nothing was rewritten or decided.
      assert.deepEqual(await decisionCounts(entry.claimId, entry.evidenceItemId), { evidence: 0, claim: 0, coverage: 0 });
      assert.equal((await query("SELECT statement FROM kai.claims WHERE claim_id = $1::uuid", [entry.claimId]))[0].statement, row.statement);
      results.i4 = { measured: [row.measured_value, row.worksheet_name, row.worksheet_key], keyFinding: "37 non-blank data rows in worksheet Data_Dictionary (sheet_5); meaning 'service event' human-defined, not verified", unqualifiedRepliesRejected: 3 };
    });

    await test("I5: an undetermined story category, another category present or unknown, AI processing denied, and a stale source version stay restricted", async () => {
      // H's sources record story/testimonial 'unknown': still outside the rule, and its Get Kinder-reviewed Evidence Summary stays with Get Kinder.
      assert.equal((await findingReview(adminApi, ids.h.s5.claimId)).body.data.ordinary_internal_rule.basis, null);
      const [hDraft] = await query(
        `SELECT d.generated_content_draft_id::text FROM kai.generated_content_drafts d JOIN kai.generated_content_blocks b ON b.generated_content_draft_id = d.generated_content_draft_id
           JOIN kai.generated_content_citations c ON c.generated_content_block_id = b.generated_content_block_id
          WHERE c.claim_id = $1::uuid AND d.content_type = 'evidence_summary' ORDER BY d.created_at DESC LIMIT 1`, [ids.h.s3Restricted.claimId]);
      const unknownReport = await adminApi("GET", clientInternalReportMarkdownPath(ORG_X, PROJECT_X, hDraft.generated_content_draft_id));
      assert.equal(unknownReport.status, 422, J(unknownReport.body).slice(0, 300));
      assert.ok(J(unknownReport.body).includes("story_testimonial_not_cleared"));
      const variants = {
        "minors present": { ...STORY_PRESENT, reviewed_minor_data_status: "present" },
        "personal information unknown": { ...STORY_PRESENT, reviewed_personal_data_status: "unknown" },
        "AI processing denied": { ...STORY_PRESENT, reviewed_llm_processing_allowed: false },
      };
      const observed = {};
      for (const [label, snapshot] of Object.entries(variants)) {
        const entry = await countOnlyMeasure(`i-${label.replace(/\W+/g, "-")}`, "sheet_3", ROW_DEFINITION, snapshot);
        const internal = await internalEligibility(entry.claimId);
        const rule = (await findingReview(adminApi, entry.claimId)).body.data.ordinary_internal_rule;
        modelOverride.text = ROW_TEXT;
        const callsBefore = modelCalls.length;
        const generated = await generate(adminApi, "evidence-summary", [entry.claimId], `i5-${label.replace(/\W+/g, "-")}`);
        modelOverride.text = null;
        assert.equal(internal.eligible, false, label);
        assert.equal(rule.basis, null, label);
        assert.equal(generated.status, 422, `${label}: ${J(generated.body)}`);
        assert.equal(modelCalls.length, callsBefore, `${label}: the model is never called`);
        observed[label] = { blockers: internal.blockerCodes, reasons: rule.reasons, generation: (generated.body.blockers || []).map((b) => b.blocking_reason).concat(generated.body.error?.code || []) };
      }
      // A stale source version: the eligibility, the generation and the earlier report all fail closed.
      const entry = ids.i.dictionary;
      await query("UPDATE kai.source_versions SET is_current = false WHERE source_version_id = $1::uuid", [entry.source_version_id]);
      try {
        const rule = (await findingReview(adminApi, entry.claimId)).body.data?.ordinary_internal_rule;
        const generated = await generate(adminApi, "evidence-summary", [entry.claimId], "i5-stale");
        const [staleDraft] = await query(
          `SELECT d.generated_content_draft_id::text FROM kai.generated_content_drafts d JOIN kai.generated_content_blocks b ON b.generated_content_draft_id = d.generated_content_draft_id
             JOIN kai.generated_content_citations c ON c.generated_content_block_id = b.generated_content_block_id WHERE c.claim_id = $1::uuid LIMIT 1`, [entry.claimId]);
        const staleReport = await adminApi("GET", clientInternalReportMarkdownPath(ORG_X, PROJECT_X, staleDraft.generated_content_draft_id));
        assert.ok(![200, 201].includes(generated.status), J(generated.body));
        assert.ok([409, 422].includes(staleReport.status), `${staleReport.status}`);
        if (rule) assert.equal(rule.applies, false);
        observed.stale = { rule: rule ?? null, generation: generated.status, report: staleReport.status };
      } finally {
        await query("UPDATE kai.source_versions SET is_current = true WHERE source_version_id = $1::uuid", [entry.source_version_id]);
      }
      results.i5 = observed;
    });

    await test("I6: a mixed draft citing an ineligible claim is not covered by its count-only claim; a later negative evidence decision withdraws the authority from the earlier report", async () => {
      const entry = ids.i.row;
      // A structural fact from the same story-present source, in the same Evidence Summary.
      const extracted = await adminApi("POST", evidenceExtractionPath(ORG_X, entry.source_version_id), {});
      assert.equal(extracted.status, 200, J(extracted.body));
      const [structural] = await query(
        "SELECT evidence_item_id::text FROM kai.evidence_items WHERE source_version_id = $1::uuid AND evidence_type = 'dictionary_field_presence_fact' ORDER BY created_at LIMIT 1", [entry.source_version_id]);
      const claimed = await adminApi("POST", claimProposalPath(ORG_X, structural.evidence_item_id), {});
      assert.ok([200, 201].includes(claimed.status), J(claimed.body));
      const structuralClaimId = claimed.body.data.claim.claim_id;
      const [{ statement: structuralStatement }] = await query("SELECT statement FROM kai.claims WHERE claim_id = $1::uuid", [structuralClaimId]);
      modelOverride.text = (claim) => (claim.claimId === entry.claimId ? ROW_TEXT : structuralStatement);
      const mixed = await generate(adminApi, "evidence-summary", [entry.claimId, structuralClaimId].sort(), "i6-mixed");
      modelOverride.text = null;
      assert.ok([200, 201].includes(mixed.status), J(mixed.body));
      const mixedReport = await adminApi("GET", clientInternalReportMarkdownPath(ORG_X, PROJECT_X, mixed.body.data.generatedContentDraftId));
      assert.equal(mixedReport.status, 422, J(mixedReport.body).slice(0, 300));
      const mixedReasons = (mixedReport.body.blockers || []).map((b) => b.blocking_reason);
      assert.ok(mixedReasons.includes("story_testimonial_not_cleared") && mixedReasons.includes("cited_claims_not_currently_eligible"), J(mixedReasons));
      // Before: the earlier count-only report is available.
      const earlier = clientInternalReportMarkdownPath(ORG_X, PROJECT_X, ids.i.rowDraftId);
      assert.equal((await adminApi("GET", earlier)).status, 200);
      // Get Kinder's reviewer records a negative evidence decision on the count.
      const evidenceQueue = await queueOf("evidence_review", entry.evidenceItemId);
      const negative = await gkApi("POST", evidenceReviewCompletePath(ORG_X, entry.evidenceItemId, evidenceQueue.review_queue_item_id),
        evidenceReviewDecisionBody({ expectedUpdatedAt: new Date(evidenceQueue.updated_at).toISOString(), decision: "not_supported" }));
      assert.equal(negative.status, 200, J(negative.body));
      const rule = (await findingReview(adminApi, entry.claimId)).body.data.ordinary_internal_rule;
      assert.deepEqual([rule.applies, rule.basis], [false, null], "a negative decision defeats the count-only basis");
      assert.equal((await internalEligibility(entry.claimId)).eligible, false);
      const withdrawn = await adminApi("GET", earlier);
      assert.equal(withdrawn.status, 422, J(withdrawn.body).slice(0, 300));
      const withdrawnReasons = (withdrawn.body.blockers || []).map((b) => b.blocking_reason);
      assert.ok(withdrawnReasons.includes("story_testimonial_not_cleared"), J(withdrawnReasons));
      modelOverride.text = ROW_TEXT;
      const regenerated = await generate(adminApi, "evidence-summary", [entry.claimId], "i6-after-negative");
      modelOverride.text = null;
      assert.equal(regenerated.status, 422, J(regenerated.body));
      // The source category is still recorded as present.
      assert.equal(await storyCategoryOf(entry.intake_sensitivity_profile_id), "present");
      results.i6 = { mixed: [mixedReport.status, mixedReasons], afterNegativeDecision: { rule, earlierReport: withdrawn.status, reasons: withdrawnReasons, regeneration: regenerated.status } };
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
