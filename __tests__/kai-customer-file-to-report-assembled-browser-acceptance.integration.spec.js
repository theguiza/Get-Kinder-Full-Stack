import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";

/**
 * Plan A Prompt 9: the assembled customer journey from actual CSV upload
 * bytes to the released internal Evidence Summary Markdown, in a real
 * headless Chrome. Run only by
 *   node scripts/kai-sprint2-plan-a-assembled-file-to-report-local-postgres.js
 * against that runner's ephemeral loopback PostgreSQL (production-shaped
 * intake tables, then the Plan A normal migration chain). Skipped otherwise.
 *
 * Real (the subject of this test): every mounted KAI route, service,
 * repository, validator, transaction, trigger, and production metadata-only
 * audit; resolveKaiActorContext with the real GK organization binding; the
 * built frontend bundle; the organization administrator's batch creation,
 * reservation, signed-URL request, browser PUT of the selected bytes,
 * confirmation, byte re-verification, bounded security assessment and policy
 * decision, and "Check security again"; the immediate P1 dispatch and the P1
 * worker (P1-03 parser on the stored bytes, P1-04, P1-05, the P1-06 handoff);
 * the administrator's sensitivity / allowed-use / AI decision, P1-07
 * candidate, P1-08 promotion, measurement, and claim; GK's evidence, claim,
 * coverage, content review, export review, snapshot, candidate, final
 * release, and manifest; the administrator's generation and report receipt.
 * Simulated at external boundaries only (reported as such):
 * - session: the Get Kinder login (req.user from a harness cookie);
 * - object storage: an in-process stand-in for the GCS signed-PUT and
 *   exact-generation read contract (the browser PUTs to a loopback URL);
 * - malware scanner: a deterministic adapter (clean / detected / unavailable)
 *   called by the real bounded assessor; no ClamAV service is contacted;
 * - model provider: the Anthropic SDK Messages prototype is patched in this
 *   process to a deterministic response (no network or model call);
 * - KAI_PUBLIC_EXPORT_ENABLED=true in this test process only.
 * Injected state, labeled where used: only the stale-source refusal flips
 * source_versions.is_current, because no application operation supersedes
 * a source version.
 */

const RUNNER_DATABASE_URL = process.env.KAI_PLAN_A_ASSEMBLED_DATABASE_URL;
const RUNNER_DATABASE_NAME = process.env.KAI_PLAN_A_ASSEMBLED_DATABASE_NAME;
const CHROME = process.env.KAI_PLAN_A_ASSEMBLED_CHROME;
const WORKDIR = process.env.KAI_PLAN_A_ASSEMBLED_WORKDIR;

function assertLoopbackDatabaseUrl(urlString) {
  const host = new URL(urlString).hostname.toLowerCase();
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error(`assembled acceptance refused a non-loopback database URL host: ${host}`);
  }
}

test("assembled file-to-report acceptance isolation: a non-loopback runner URL is refused", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
});

if (!RUNNER_DATABASE_URL || !CHROME || !WORKDIR) {
  test("assembled customer file-to-report browser acceptance requires its runner", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_DATABASE_URL);
  await runAssembledAcceptance();
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

async function runAssembledAcceptance() {
  process.env.KAI_PUBLIC_EXPORT_ENABLED = "true";
  // Model provider substitution: a dummy key for the SDK constructor (never a
  // real credential) and a deterministic Messages.create on the shared
  // prototype. The response also claims an approval, which must change nothing.
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-unused-dummy-key";
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const messagesPrototype = Object.getPrototypeOf(new Anthropic({ apiKey: "sk-ant-test-unused-dummy-key" }).messages);
  const modelCalls = [];
  const COMPLIANT_TEXT = "The promoted source records 5 programme sessions for the reporting period 2026-09-01 to 2026-09-30. "
    + "This is a count of source records, each counted as one programme session under the human-confirmed definition; "
    + "the period is attested in that definition and not verified against record dates. "
    + "1 blank record was excluded and 2 exact-duplicate records were included. "
    + "Internal limitations: small-cell risk, conflicting source indicators, and requirement alignment were accepted for internal use only.";
  messagesPrototype.create = async function deterministicCreate(payload) {
    const requestBody = JSON.parse(payload.messages[0].content);
    modelCalls.push({ system: payload.system, claims: requestBody.claims });
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          approved: true,
          draftStatus: "released",
          blocks: requestBody.claims.map((claim) => ({ text: COMPLIANT_TEXT, citations: [{ claimId: claim.claimId, evidenceItemId: claim.evidenceItemId }] })),
        }),
      }],
    };
  };

  const { Pool } = await import("pg");
  const express = (await import("express")).default;
  const ambientPool = (await import("../Backend/db/pg.js")).default;
  const seedPool = new Pool({ connectionString: RUNNER_DATABASE_URL, ssl: false, max: 4 });
  const { findOrCreateKaiUserByLegacyPublicUserdataId } = await import("../Backend/kai/db/kaiQueries.js");
  const sprint2IntakeApiRouter = (await import("../Backend/kai/routes/sprint2IntakeApi.js")).default;
  const { requireKaiSprint2Enabled } = await import("../Backend/kai/config/kaiSprint2Config.js");
  const { requireKaiSprint2Authenticated } = await import("../Backend/kai/middleware/kaiSprint2Authentication.js");
  const { setKaiIntakeRuntimeDependenciesForTest } = await import("../Backend/kai/services/kaiIntakeRuntimeService.js");
  const { createPostgresUploadLifecycleRepository } = await import("../Backend/kai/upload/postgresUploadLifecycleRepository.js");
  const { createInternalSecurityAssessmentExecutor } = await import("../Backend/kai/security/internalSecurityAssessmentExecutor.js");
  const { assessBoundedFileSecurity } = await import("../Backend/kai/security/boundedFileSecurityAssessor.js");
  const { getKaiP1FileDispatcher } = await import("../Backend/kai/parsing/p1FileDispatch.js");
  const { processKaiP1IntakeFile } = await import("../Backend/kai/parsing/p1WorkerRuntime.js");
  const { confirmUploadPath, fileDetailPath, fileReservationsPath } = await import("../frontend/kaiWebIntakeLogic.js");
  const { securityCheckRetryPath } = await import("../frontend/knowledgeStudio/clientEvidencePipelineLogic.js");
  const {
    BASE_PATH,
    claimReviewCompletePath,
    claimReviewDecisionBody,
    claimTraceabilityPath,
    clientReleasedReportMarkdownPath,
    coverageInternalAcceptancePath,
    evidenceReviewCompletePath,
    evidenceReviewDecisionBody,
    generatedContentReviewCompletePath,
    generatedContentReviewStartPath,
  } = await import("../frontend/impactEvidenceLibraryLogic.js");
  const { sourceRecordCountMeasurementPath } = await import("../frontend/knowledgeStudio/clientSourceMeasurementLogic.js");
  const query = async (sql, params = []) => (await seedPool.query(sql, params)).rows;

  // Every unmodified service default must use the runner-owned loopback cluster.
  const ambientTarget = (await ambientPool.query("SELECT current_database() AS database_name, inet_server_addr()::text AS server_addr")).rows[0];
  assert.equal(ambientTarget.database_name, RUNNER_DATABASE_NAME);
  assert.ok(["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(ambientTarget.server_addr));

  const ORG_X = "0e000000-0000-4000-8000-0000000000a1";
  const ORG_Y = "0e000000-0000-4000-8000-0000000000b1";
  const PROJECT_X = "7e000000-0000-4000-8000-0000000000e1";
  const PROJECT_X2 = "7e000000-0000-4000-8000-0000000000e3";
  const PROJECT_Y = "7e000000-0000-4000-8000-0000000000e2";
  const USERS = Object.freeze({ gkReviewer: 981, gkAdmin: 982, clientAdmin: 983, contributor: 984, clientReviewer: 985, inactiveAdmin: 986, adminY: 987 });
  // The established synthetic programme-session log: one data record per
  // session, one empty line (not a record), and two identical records (both
  // counted).
  const CSV = [
    "session_date,programme,attendees",
    "2026-09-02,literacy,12",
    "2026-09-09,literacy,",
    "",
    "2026-09-16,mentoring,8",
    "2026-09-16,mentoring,8",
    "2026-09-23,mentoring,11",
    "",
  ].join("\n");
  const CSV_BYTES = Buffer.from(CSV, "utf8");
  // Independent verifier over the same bytes: non-empty lines after the header.
  const independentRecordCount = (text) => text.split(/\r?\n/).slice(1).filter((line) => line.split(",").some((cell) => cell.trim() !== "")).length;
  const independent = {
    checksum: sha256(CSV_BYTES),
    sizeBytes: CSV_BYTES.byteLength,
    dataRecords: CSV.split(/\r?\n/).slice(1).filter((line, index, all) => !(index === all.length - 1 && line === "")).length,
    blankRecords: CSV.split(/\r?\n/).slice(1, -1).filter((line) => line.trim() === "").length,
    duplicateRecords: (() => {
      const rows = CSV.split(/\r?\n/).slice(1).filter((line) => line.trim() !== "");
      return rows.filter((line) => rows.indexOf(line) !== rows.lastIndexOf(line)).length;
    })(),
    counted: independentRecordCount(CSV),
  };
  assert.deepEqual([independent.dataRecords, independent.blankRecords, independent.duplicateRecords, independent.counted], [6, 1, 2, 5]);
  const MEASURED_LIMITATION_CODES = [
    "coverage.conflicting_source_indicators.accepted_internal_limitation",
    "coverage.duplicates.resolved_risk_flagged",
    "coverage.missingness.resolved_risk_flagged",
    "coverage.requirement_alignment.accepted_internal_limitation",
    "coverage.small_cell_risk.accepted_internal_limitation",
    "coverage.time_period_clarity.resolved_risk_flagged",
    "measurement.blank_records_excluded",
    "measurement.duplicate_records_included",
    "measurement.period_human_attested_not_row_verified",
    "measurement.record_meaning_human_defined",
  ];
  // The customer's selections, written to disk for the browser's file input.
  const filesDir = join(WORKDIR, "customer-files");
  mkdirSync(filesDir, { recursive: true });
  const customerFile = (name, bytes) => {
    const path = join(filesDir, name);
    writeFileSync(path, bytes);
    return { name, path, bytes, checksum: sha256(bytes) };
  };
  const SESSIONS = customerFile("programme-sessions-september.csv", CSV_BYTES);
  const FLAGGED = customerFile("flagged-attachment.csv", Buffer.from("session_date,programme\n2026-09-30,flagged\n", "utf8"));
  const PARTNER = customerFile("partner-shared-sessions.csv", Buffer.from("session_date,programme\n2026-09-05,partner\n2026-09-12,partner\n", "utf8"));

  // --- organizations, Projects, GK bindings, users (authorized setup) -------
  for (const [organizationId, name, code] of [[ORG_X, "Harbourline Session Society", "harbourline-assembled"], [ORG_Y, "Larchmont Other Society", "larchmont-assembled"]]) {
    await query("INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES ($1::uuid, $2, $3)", [organizationId, name, code]);
  }
  for (const [engagementId, organizationId, code] of [[PROJECT_X, ORG_X, "Session Programme 2026"], [PROJECT_X2, ORG_X, "Second Project"], [PROJECT_Y, ORG_Y, "Larchmont Project"]]) {
    await query("INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code, project_metadata) VALUES ($1::uuid, $2::uuid, $3, '{}'::jsonb)", [engagementId, organizationId, code]);
  }
  for (const legacyId of Object.values(USERS)) await query("INSERT INTO public.userdata (id) VALUES ($1) ON CONFLICT DO NOTHING", [legacyId]);
  // Each organization's administrator: an active Get Kinder organization-admin
  // membership in a GK organization bound to that KAI organization (no stored
  // KAI membership, no global role). A second, inactive administrator of X.
  const gkOrganizations = {};
  for (const [organizationId, name, admins] of [
    [ORG_X, "Harbourline Session Society", [[USERS.clientAdmin, true], [USERS.inactiveAdmin, false]]],
    [ORG_Y, "Larchmont Other Society", [[USERS.adminY, true]]],
  ]) {
    const [gkOrganization] = await query("INSERT INTO public.organizations (name, status) VALUES ($1, 'approved') RETURNING id", [name]);
    await query("INSERT INTO kai.gk_organization_bindings (gk_organization_id, kai_organization_id, status) VALUES ($1, $2::uuid, 'active')", [gkOrganization.id, organizationId]);
    for (const [userId, active] of admins) {
      await query("INSERT INTO public.user_org_memberships (org_id, user_id, role, is_active) VALUES ($1, $2, 'admin', $3)", [gkOrganization.id, userId, active]);
    }
    gkOrganizations[organizationId] = gkOrganization.id;
  }
  const membership = async (legacyId, roleName, organizations = [ORG_X], globalRole = null) => {
    const user = await findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: legacyId, email: `user${legacyId}@harbourline.test` });
    for (const organizationId of organizations) {
      await query("INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status) VALUES ($1::uuid, $2::uuid, $3, 'active')", [organizationId, user.user_id, roleName]);
    }
    if (globalRole) await query("INSERT INTO kai.user_roles (user_id, role_id) SELECT $1::uuid, role_id FROM kai.roles WHERE role_name = $2", [user.user_id, globalRole]);
    return user;
  };
  await membership(USERS.gkReviewer, "gk_reviewer", [ORG_X, ORG_Y], "gk_reviewer");
  await membership(USERS.gkAdmin, "gk_admin", [ORG_X], "gk_admin");
  await membership(USERS.contributor, "client_contributor");
  await membership(USERS.clientReviewer, "client_reviewer");

  // --- external boundaries: object storage and the malware scanner -----------
  const objects = new Map();
  const signedTargets = new Map();
  let generation = 1760000000000001n;
  let baseUrl = "";
  const storageReads = [];
  const scannerCalls = [];
  const scanner = { unavailable: new Set(), detected: new Set() };
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
      storageReads.push(sha256(stored.bytes));
      return { ok: true, data: { size_bytes: stored.bytes.byteLength, byte_source: Readable.from([Buffer.from(stored.bytes)]) } };
    },
  });
  const malwareScanAdapter = Object.freeze({
    async scan({ sha256: digest }) {
      scannerCalls.push(digest);
      if (scanner.detected.has(digest)) return { status: "malware_detected", provenance: { ...syntheticProvenance } };
      if (scanner.unavailable.has(digest)) return { status: "failed", category: "malware_scan_unavailable" };
      return { status: "clean", provenance: { ...syntheticProvenance } };
    },
  });
  const runtime = Object.freeze({
    env: process.env,
    gcsProvider: storage,
    gcsUploadSignerProvider: storage,
    gcsParserReaderProvider: storage,
    uploadLifecycleRepository: createPostgresUploadLifecycleRepository(),
    internalSecurityAssessmentExecutor: createInternalSecurityAssessmentExecutor({
      assessor: (input) => assessBoundedFileSecurity(input, { malwareScanAdapter }),
    }),
  });
  const restoreRuntime = setKaiIntakeRuntimeDependenciesForTest(runtime);
  const dispatcher = getKaiP1FileDispatcher();

  // --- harness app -------------------------------------------------------------
  const publicDir = new URL("../public/", import.meta.url).pathname;
  const app = express();
  app.put("/synthetic-storage/:token", express.raw({ type: () => true, limit: "10mb" }), (req, res) => {
    const target = signedTargets.get(req.params.token);
    // Like a V4 signed PUT: only the signed object key, with the signed type.
    if (!target || req.get("content-type") !== target.contentType) return res.status(403).end();
    generation += 1n;
    objects.set(target.objectKey, { bytes: Buffer.from(req.body), generation: generation.toString() });
    return res.status(200).end();
  });
  app.use(express.json());
  app.use((req, _res, next) => {
    const match = /(?:^|;\s*)kai_harness_user=(\d+)/.exec(req.headers.cookie || "");
    if (match) req.user = { id: Number(match[1]), email: `user${match[1]}@harbourline.test` };
    req.isAuthenticated = () => Boolean(req.user);
    next();
  });
  app.use("/api/kai/sprint2/intake", requireKaiSprint2Enabled, requireKaiSprint2Authenticated, sprint2IntakeApiRouter);
  app.get("/impact-library", (_req, res) => res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><title>Impact Library</title>
    <link rel="stylesheet" href="/css/style.css" /><link rel="stylesheet" href="/css/gk-design-tokens.css" /></head>
    <body><div id="impact-evidence-library-root"></div><script src="/js/bundles/entry.js"></script>
    <script>window.renderImpactEvidenceLibrary();</script></body></html>`));
  app.use(express.static(publicDir));
  const server = await new Promise((resolve) => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchChrome();

  const COCKPIT = `${BASE_PATH}/admin/review-cockpit`;
  const orgPath = (organizationId = ORG_X) => `${BASE_PATH}/admin/organizations/${organizationId}`;
  const pipelinePath = (organizationId, engagementId) => `${orgPath(organizationId)}/engagements/${engagementId}/client-evidence-pipeline`;
  const sensitivityDecisionPath = (organizationId, profileId) => `${COCKPIT}/sensitivity-profiles/${profileId}/decision?organization_id=${organizationId}`;

  const gkReviewerPage = await openPage(browser, { baseUrl, legacyUserId: USERS.gkReviewer });
  const gkAdminPage = await openPage(browser, { baseUrl, legacyUserId: USERS.gkAdmin });
  const adminPage = await openPage(browser, { baseUrl, legacyUserId: USERS.clientAdmin });
  const contributorPage = await openPage(browser, { baseUrl, legacyUserId: USERS.contributor });
  const reviewerPage = await openPage(browser, { baseUrl, legacyUserId: USERS.clientReviewer });
  const inactiveAdminPage = await openPage(browser, { baseUrl, legacyUserId: USERS.inactiveAdmin });
  const adminYPage = await openPage(browser, { baseUrl, legacyUserId: USERS.adminY });
  const allPages = [gkReviewerPage, gkAdminPage, adminPage, contributorPage, reviewerPage, inactiveAdminPage, adminYPage];
  const fetchText = (page, path) => page.evaluate(`(async () => {
    const response = await fetch(${JSON.stringify(path)}, { credentials: "same-origin" });
    return { status: response.status, disposition: response.headers.get("content-disposition"), body: await response.text() };
  })()`);
  const setInput = (page, selector, value) => page.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  const textOf = (page, selector) => page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? el.textContent : null; })()`);
  const pathOf = (request) => { const url = new URL(request.url); return url.pathname; };
  const queueOf = async (queueType, targetId) => (await query(
    "SELECT review_queue_item_id::text, queue_status, updated_at FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = $2 AND target_object_id = $3::uuid",
    [ORG_X, queueType, targetId]))[0];
  const fileRow = async (intakeFileId) => (await query(
    `SELECT intake_file_id::text, organization_id::text, engagement_id::text, intake_batch_id::text, original_filename, checksum, verified_checksum,
            verified_size_bytes, upload_state, file_policy_status, processing_status::text AS processing_status, storage_object_key,
            gcs_generation::text AS gcs_generation, object_version_id
       FROM kai.intake_files WHERE intake_file_id = $1::uuid`, [intakeFileId]))[0];
  const fileByName = async (name) => (await query("SELECT intake_file_id::text FROM kai.intake_files WHERE organization_id = $1::uuid AND original_filename = $2 ORDER BY created_at", [ORG_X, name]));
  const securityAudits = async (intakeFileId) => (await query(
    `SELECT action, reason_code, metadata->>'assessment_category' AS category FROM kai.audit_events
      WHERE metadata->>'object_id' = $1 AND action IN ('record_security_assessment_diagnostic', 'apply_security_assessment_policy_decision')
      ORDER BY created_at, audit_event_id`, [intakeFileId])).map((row) => [row.action, row.reason_code, row.category]);
  const p1Rows = async (intakeFileId) => (await query(`SELECT
      (SELECT count(*) FROM kai.intake_parser_runs WHERE intake_file_id = $1::uuid)::int AS parser_runs,
      (SELECT count(*) FROM kai.intake_file_profiles WHERE intake_file_id = $1::uuid)::int AS profiles,
      (SELECT count(*) FROM kai.data_dictionaries WHERE intake_file_id = $1::uuid)::int AS dictionaries,
      (SELECT count(*) FROM kai.intake_sensitivity_profiles WHERE intake_file_id = $1::uuid)::int AS sensitivity_profiles,
      (SELECT count(*) FROM kai.review_queue_items q JOIN kai.intake_sensitivity_profiles s ON s.intake_sensitivity_profile_id = q.target_object_id
        WHERE s.intake_file_id = $1::uuid AND q.queue_type = 'sensitivity_review')::int AS sensitivity_items`, [intakeFileId]))[0];
  const NO_P1 = Object.freeze({ parser_runs: 0, profiles: 0, dictionaries: 0, sensitivity_profiles: 0, sensitivity_items: 0 });
  const ONE_P1 = Object.freeze({ parser_runs: 1, profiles: 1, dictionaries: 1, sensitivity_profiles: 1, sensitivity_items: 1 });
  const businessCounts = async () => (await query(`SELECT
      (SELECT count(*) FROM kai.intake_batches WHERE organization_id = $1::uuid)::int AS batches,
      (SELECT count(*) FROM kai.intake_files WHERE organization_id = $1::uuid)::int AS files,
      (SELECT count(*) FROM kai.intake_parser_runs WHERE organization_id = $1::uuid)::int AS parser_runs,
      (SELECT count(*) FROM kai.intake_file_profiles WHERE organization_id = $1::uuid)::int AS profiles,
      (SELECT count(*) FROM kai.intake_sensitivity_profiles WHERE organization_id = $1::uuid)::int AS sensitivity_profiles,
      (SELECT count(*) FROM kai.intake_sensitivity_review_decisions WHERE organization_id = $1::uuid)::int AS sensitivity_decisions,
      (SELECT count(*) FROM kai.intake_source_candidates WHERE organization_id = $1::uuid)::int AS candidates,
      (SELECT count(*) FROM kai.sources WHERE organization_id = $1::uuid)::int AS sources,
      (SELECT count(*) FROM kai.source_versions WHERE organization_id = $1::uuid)::int AS source_versions,
      (SELECT count(*) FROM kai.source_measurement_definitions WHERE organization_id = $1::uuid)::int AS definitions,
      (SELECT count(*) FROM kai.evidence_measurements WHERE organization_id = $1::uuid)::int AS measurements,
      (SELECT count(*) FROM kai.claims WHERE organization_id = $1::uuid)::int AS claims,
      (SELECT count(*) FROM kai.generated_content_drafts WHERE organization_id = $1::uuid)::int AS drafts,
      (SELECT count(*) FROM kai.export_manifests WHERE organization_id = $1::uuid)::int AS manifests,
      (SELECT count(*) FROM kai.audit_events WHERE organization_id = $1::uuid)::int AS audit_events`, [ORG_X]))[0];

  // Knowledge Studio for the organization administrator, on a tab of Project X.
  const openStudioTab = async (tabLabel, projectId = PROJECT_X) => {
    await adminPage.goto("/impact-library");
    await adminPage.waitForText("Knowledge Studio");
    await adminPage.clickNav("Knowledge Studio");
    await adminPage.waitFor(async () => adminPage.evaluate(`Boolean(document.getElementById("gk-shell-project-select"))`), "project selector");
    await adminPage.idle();
    await adminPage.clickTab(tabLabel);
    await adminPage.idle();
    await adminPage.selectProject(projectId);
    await adminPage.idle();
  };
  const uploadThroughFiles = async (file) => {
    const mark = adminPage.mark();
    await adminPage.chooseFile(file.path);
    await adminPage.clickButton("Upload the selected file");
    await adminPage.waitFor(async () => /File reserved, uploaded, and confirmed\.|This file has already been added|could not|failed/i.test(await adminPage.text()), `upload result for ${file.name}`);
    await adminPage.idle();
    await dispatcher.whenIdle();
    return adminPage.requestsSince(mark).map((request) => [request.method, pathOf(request).replace(/synthetic-storage\/[0-9a-f-]{36}$/, "synthetic-storage/:token"), request.status]);
  };
  const refreshPipeline = async () => {
    await adminPage.clickButton("Refresh status");
    await adminPage.idle();
  };
  const created = (response, label) => assert.ok([200, 201].includes(response.status), `${label}: ${response.status} ${JSON.stringify(response.body)}`);

  const results = { simulatedBoundaries: ["session (harness cookie)", "object storage (in-process signed-PUT/exact-generation stand-in)", "malware scanner (deterministic adapter behind the real assessor)", "model provider (patched SDK Messages.create)"] };
  const ids = {};
  try {
    // Every page starts on the app's origin, so its same-origin requests resolve.
    for (const page of allPages) await page.goto("/impact-library");

    // -----------------------------------------------------------------------
    // Step A + recovery: the actual bytes enter through the upload boundary
    // while the scanner is unavailable.
    // -----------------------------------------------------------------------
    await test("A: the organization administrator creates a batch and uploads the CSV in Files; with the scanner unavailable the confirmed bytes stay quarantined and nothing is processed", async () => {
      await openStudioTab("Files");
      await adminPage.waitForText("Upload the selected file");
      await adminPage.waitForText("No intake batches exist for this project yet.");
      const batchCodeSet = await adminPage.evaluate(`(() => {
        const label = [...document.querySelectorAll("label")].find((el) => el.innerText.trim() === "Batch code");
        const input = label && label.parentElement.querySelector("input");
        if (!input) return false;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "september-sessions");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })()`);
      assert.ok(batchCodeSet, "batch code input");
      let mark = adminPage.mark();
      await adminPage.clickButton("Create batch");
      await adminPage.waitForText("Batch created:");
      await adminPage.idle();
      assert.deepEqual(adminPage.requestsSince(mark).filter((r) => r.method === "POST").map((r) => [pathOf(r), r.status]), [[`${BASE_PATH}/admin/batches`, 201]]);
      const [batch] = await query("SELECT intake_batch_id::text, engagement_id::text, created_by::text, created_by_type::text FROM kai.intake_batches WHERE organization_id = $1::uuid", [ORG_X]);
      const [admin] = await query("SELECT user_id::text FROM kai.users WHERE legacy_public_userdata_id = $1", [USERS.clientAdmin]);
      assert.deepEqual([batch.engagement_id, batch.created_by, batch.created_by_type], [PROJECT_X, admin.user_id, "human"]);
      ids.adminUserId = admin.user_id;
      ids.batchId = batch.intake_batch_id;

      // External boundary: the scanner is unavailable for these bytes.
      scanner.unavailable.add(SESSIONS.checksum);
      const sequence = await uploadThroughFiles(SESSIONS);
      assert.match(await adminPage.text(), /File reserved, uploaded, and confirmed\./);
      assert.deepEqual(sequence.filter(([method]) => method !== "GET"), [
        ["POST", `${BASE_PATH}/admin/batches/${ids.batchId}/file-reservations`, 201],
        ["POST", `${BASE_PATH}/admin/batches/${ids.batchId}/files/upload-url`, 200],
        ["PUT", "/synthetic-storage/:token", 200],
        ["POST", `${BASE_PATH}/admin/files/${(await fileByName(SESSIONS.name))[0].intake_file_id}/confirm-upload`, 200],
      ], JSON.stringify(sequence));
      const [{ intake_file_id: fileId }] = await fileByName(SESSIONS.name);
      ids.fileId = fileId;
      const row = await fileRow(fileId);
      // Checksum, scope, and stored bytes against the independent calculation.
      assert.equal(row.checksum, independent.checksum, "declared checksum is the browser's sha256 of the selected bytes");
      assert.equal(row.verified_checksum, independent.checksum, "the server re-verified the stored bytes");
      assert.equal(Number(row.verified_size_bytes), independent.sizeBytes);
      assert.deepEqual([row.organization_id, row.engagement_id, row.intake_batch_id], [ORG_X, PROJECT_X, ids.batchId]);
      assert.ok(row.storage_object_key && row.gcs_generation && row.object_version_id, "exact stored object version bound");
      assert.ok(Buffer.from(objects.get(row.storage_object_key).bytes).equals(CSV_BYTES), "the stored object is exactly the selected bytes");
      // Security gate: confirmed, but pending and quarantined; nothing processed.
      assert.deepEqual([row.upload_state, row.file_policy_status, row.processing_status], ["confirmed", "pending", "quarantined"]);
      assert.deepEqual(await securityAudits(fileId), [["record_security_assessment_diagnostic", "no_policy_decision", "malware_scan_unavailable"]]);
      assert.deepEqual(await p1Rows(fileId), NO_P1, "no parser run, profile, or review work before a security result");
      assert.equal(dispatcher.stats().scheduled, 0, "no P1 dispatch for a file without a passed decision");
      mark = adminPage.mark();
      await refreshPipeline();
      await adminPage.waitFor(async () => Boolean(await adminPage.pipelineFileText(fileId)), "pipeline entry");
      const entry = await adminPage.pipelineFileText(fileId);
      assert.match(entry, /Security check: The security scanner was not available, so this file has not been checked yet\. It stays quarantined and is not processed until a check succeeds\./);
      assert.match(entry, /Next action: Check security again when the scanner is available\./);
      assert.match(entry, /Check security again/);
      assert.doesNotMatch(entry, /KAI is processing this file|malware_scan/);
      results.a = { requests: sequence.filter(([method]) => method !== "GET"), stored: row.file_policy_status, checksumMatchesIndependent: true };
    });

    await test("Recovery: the administrator's 'Check security again' during the outage changes nothing; after the scanner returns it passes the existing stored bytes and the real worker parses them", async () => {
      const before = await businessCounts();
      const readsBefore = storageReads.length;
      // Still unavailable: the retry adds a diagnostic only.
      let mark = adminPage.mark();
      await adminPage.clickIn(`[data-security-check-retry="${ids.fileId}"]`, "Check security again (outage)");
      await adminPage.waitFor(async () => /Security check requested/.test(await adminPage.pipelineFileText(ids.fileId) || ""), "retry result");
      await adminPage.idle();
      assert.deepEqual(adminPage.requestsSince(mark).filter((r) => r.method !== "GET").map((r) => [r.method, pathOf(r), r.status]),
        [["POST", `${BASE_PATH}/admin/files/${ids.fileId}/confirm-upload`, 200]]);
      assert.equal((await fileRow(ids.fileId)).file_policy_status, "pending");
      assert.equal((await securityAudits(ids.fileId)).length, 2);
      assert.deepEqual(await p1Rows(ids.fileId), NO_P1);

      // External boundary restored: the scanner returns a clean result.
      scanner.unavailable.delete(SESSIONS.checksum);
      await refreshPipeline();
      await adminPage.waitFor(async () => Boolean(await adminPage.evaluate(`Boolean(document.querySelector('[data-security-check-retry="${ids.fileId}"]'))`)), "retry action still offered");
      mark = adminPage.mark();
      await adminPage.clickIn(`[data-security-check-retry="${ids.fileId}"]`, "Check security again (scanner back)");
      await adminPage.waitFor(async () => /Security check requested/.test(await adminPage.pipelineFileText(ids.fileId) || ""), "retry result");
      await adminPage.idle();
      await dispatcher.whenIdle();
      assert.deepEqual(adminPage.requestsSince(mark).filter((r) => r.method !== "GET").map((r) => [r.method, pathOf(r), r.status]),
        [["POST", `${BASE_PATH}/admin/files/${ids.fileId}/confirm-upload`, 200]], "no new transfer: the existing stored bytes are re-checked");
      const row = await fileRow(ids.fileId);
      assert.equal(row.file_policy_status, "passed");
      assert.deepEqual((await securityAudits(ids.fileId)).at(-1), ["apply_security_assessment_policy_decision", "passed", null]);
      assert.equal(dispatcher.stats().scheduled, 1, "exactly one P1 dispatch, from the committed pass");

      // The worker read the stored bytes and committed P1-03..P1-05 and the P1-06 work item.
      assert.deepEqual(await p1Rows(ids.fileId), ONE_P1);
      assert.ok(storageReads.slice(readsBefore).filter((digest) => digest === independent.checksum).length >= 2, "assessment and parser each read the stored object");
      const [run] = await query(
        "SELECT parser_run_id::text, parser_status, parser_name, checksum, output_profile_id::text FROM kai.intake_parser_runs WHERE intake_file_id = $1::uuid", [ids.fileId]);
      assert.deepEqual([run.parser_status, run.checksum], ["completed", independent.checksum]);
      const [profile] = await query("SELECT file_profile_id::text, profile FROM kai.intake_file_profiles WHERE intake_file_id = $1::uuid", [ids.fileId]);
      assert.equal(profile.file_profile_id, run.output_profile_id);
      const counts = profile.profile.counts;
      assert.deepEqual([counts.row_count, counts.blank_record_count, counts.duplicate_row_count], [independent.dataRecords, independent.blankRecords, independent.duplicateRecords]);
      ids.fileProfileId = profile.file_profile_id;
      ids.profileCounts = { row_count: counts.row_count, blank_record_count: counts.blank_record_count, duplicate_row_count: counts.duplicate_row_count };
      const [item] = await query(
        `SELECT q.queue_status, q.created_by_type::text AS created_by_type, s.intake_sensitivity_profile_id::text FROM kai.review_queue_items q
           JOIN kai.intake_sensitivity_profiles s ON s.intake_sensitivity_profile_id = q.target_object_id
          WHERE s.intake_file_id = $1::uuid AND q.queue_type = 'sensitivity_review'`, [ids.fileId]);
      assert.equal(item.queue_status, "open");
      ids.sensitivityProfileId = item.intake_sensitivity_profile_id;
      const after = await businessCounts();
      assert.deepEqual([after.files - before.files, after.parser_runs - before.parser_runs, after.profiles - before.profiles, after.sources - before.sources],
        [0, 1, 1, 0], "the retry created no file, and the worker one run and one profile");

      await refreshPipeline();
      const entry = await adminPage.pipelineFileText(ids.fileId);
      assert.match(entry, /Next action: .*sensitivity/i, entry);
      assert.ok(!(await adminPage.evaluate(`Boolean(document.querySelector('[data-security-check-retry="${ids.fileId}"]'))`)), "no retry action once checked");
      results.recovery = {
        outage: ["confirmed", "pending", "malware_scan_unavailable"],
        customerAction: "Check security again (2 clicks: outage, then scanner back)",
        recovered: row.file_policy_status,
        parserRun: run.parser_status,
        profileCounts: ids.profileCounts,
      };
    });

    await test("Idempotency: a replayed confirmation, a re-run of the worker, and the same bytes selected again create no duplicate file, profile, source, or decision", async () => {
      const before = await businessCounts();
      const beforeAudits = await securityAudits(ids.fileId);
      const replay = await adminPage.api("POST", confirmUploadPath(ORG_X, ids.fileId), { organization_id: ORG_X });
      assert.equal(replay.status, 200, JSON.stringify(replay.body));
      await dispatcher.whenIdle();
      assert.equal(dispatcher.stats().scheduled, 1, "a replayed confirmation of a passed file dispatches nothing");
      const worker = await processKaiP1IntakeFile({ organizationId: ORG_X, intakeFileId: ids.fileId }, runtime);
      assert.equal(worker.ok, true, JSON.stringify(worker));
      assert.equal(worker.data.stoppedAt, undefined, JSON.stringify(worker.data));
      assert.equal(worker.data.sensitivityReviewWork.replayed, true);
      assert.deepEqual(await p1Rows(ids.fileId), ONE_P1);
      // The same file selected again: the duplicate resolution, not a new record.
      const mark = adminPage.mark();
      await adminPage.chooseFile(SESSIONS.path);
      await adminPage.clickButton("Upload the selected file");
      await adminPage.waitForText("This file has already been added.");
      await adminPage.idle();
      assert.deepEqual(adminPage.requestsSince(mark).filter((r) => r.method === "POST").map((r) => r.status), [422]);
      await adminPage.clickButton("Cancel");
      const after = await businessCounts();
      assert.deepEqual({ ...after, audit_events: 0 }, { ...before, audit_events: 0 }, "no business record created");
      assert.deepEqual((await securityAudits(ids.fileId)).slice(0, beforeAudits.length), beforeAudits);
      assert.equal((await securityAudits(ids.fileId)).filter(([action]) => action === "apply_security_assessment_policy_decision").length, 1, "one policy decision");
      results.idempotency = "PASS: confirm replay 200 (no dispatch), worker re-run replayed, re-selection 422 duplicate resolution; counts unchanged";
    });

    await test("Intake boundaries: detected malware is blocked and never processed; other organizations, inactive or non-contributing users cannot read, re-check, or upload; the Sprint 2 flag is effective", async () => {
      scanner.detected.add(FLAGGED.checksum);
      const sequence = await uploadThroughFiles(FLAGGED);
      assert.ok(sequence.some(([method, path, status]) => method === "POST" && path.endsWith("/confirm-upload") && status === 200), JSON.stringify(sequence));
      const [{ intake_file_id: flaggedId }] = await fileByName(FLAGGED.name);
      ids.flaggedId = flaggedId;
      const flagged = await fileRow(flaggedId);
      assert.deepEqual([flagged.upload_state, flagged.file_policy_status], ["confirmed", "blocked"]);
      assert.deepEqual(await p1Rows(flaggedId), NO_P1, "a blocked file is never parsed");
      assert.equal(dispatcher.stats().scheduled, 1, "no dispatch for a blocked file");
      const recheck = await adminPage.api("POST", securityCheckRetryPath(ORG_X, flaggedId), { organization_id: ORG_X });
      assert.equal(recheck.status, 200);
      assert.equal((await fileRow(flaggedId)).file_policy_status, "blocked", "a re-check never reverses a block");
      await refreshPipeline();
      assert.doesNotMatch(await adminPage.pipelineFileText(flaggedId), /Check security again/);

      const before = await businessCounts();
      const outcomes = {};
      for (const [label, page, method, path, body, allowed] of [
        ["other organization's administrator reads the file", adminYPage, "GET", fileDetailPath(ORG_X, ids.fileId), undefined, [403, 404]],
        ["other organization's administrator re-checks", adminYPage, "POST", securityCheckRetryPath(ORG_X, ids.fileId), { organization_id: ORG_X }, [403, 404]],
        ["other organization's administrator reads the pipeline", adminYPage, "GET", pipelinePath(ORG_X, PROJECT_X), undefined, [403, 404]],
        ["other organization's administrator reserves into X's batch", adminYPage, "POST", fileReservationsPath(ids.batchId), {
          organization_id: ORG_X, engagement_id: PROJECT_X, original_filename: "x.csv", file_extension: ".csv", mime_type: "text/csv",
          file_size_bytes: 10, checksum: "d".repeat(64), hash_algorithm: "sha256", idempotency_key: `y-${randomUUID()}` }, [403, 404]],
        ["inactive administrator reserves", inactiveAdminPage, "POST", fileReservationsPath(ids.batchId), {
          organization_id: ORG_X, engagement_id: PROJECT_X, original_filename: "x.csv", file_extension: ".csv", mime_type: "text/csv",
          file_size_bytes: 10, checksum: "e".repeat(64), hash_algorithm: "sha256", idempotency_key: `i-${randomUUID()}` }, [403]],
        ["inactive administrator re-checks", inactiveAdminPage, "POST", securityCheckRetryPath(ORG_X, ids.fileId), { organization_id: ORG_X }, [403]],
        ["client_reviewer re-checks", reviewerPage, "POST", securityCheckRetryPath(ORG_X, ids.fileId), { organization_id: ORG_X }, [403, 404]],
      ]) {
        const response = await page.api(method, path, body);
        assert.ok(allowed.includes(response.status), `${label}: ${response.status} ${JSON.stringify(response.body)}`);
        assert.doesNotMatch(JSON.stringify(response.body), new RegExp(`${independent.checksum}|programme-sessions|storage_object_key`), label);
        outcomes[label] = response.status;
      }
      // KAI_SPRINT2_ENABLED stays effective for this journey's routes.
      process.env.KAI_SPRINT2_ENABLED = "false";
      try {
        const disabled = await adminPage.api("GET", fileDetailPath(ORG_X, ids.fileId));
        assert.equal(disabled.status, 403);
        assert.equal(disabled.body.error.code, "feature_disabled");
        outcomes["KAI_SPRINT2_ENABLED=false"] = disabled.status;
      } finally {
        process.env.KAI_SPRINT2_ENABLED = "true";
      }
      assert.deepEqual({ ...(await businessCounts()), audit_events: 0 }, { ...before, audit_events: 0 }, "refusals wrote nothing");
      results.intakeBoundaries = { flagged: "blocked, never parsed, re-check refused to reverse", ...outcomes };
    });

    // -----------------------------------------------------------------------
    // Step C: the administrator establishes the permitted source.
    // -----------------------------------------------------------------------
    await test("C: in Data Sources the administrator records sensitivity, allowed use 'allowed', and AI processing 'permitted', then promotes the uploaded file; the source version is current and bound to the worker's profile", async () => {
      await openStudioTab("Data Sources");
      await adminPage.waitFor(async () => adminPage.evaluate(`Boolean(document.querySelector('[data-client-open-sensitivity-review="${ids.fileId}"]'))`), "sensitivity review action");
      assert.ok(!(await adminPage.evaluate(`Boolean(document.querySelector('[data-client-open-sensitivity-review="${ids.flaggedId}"]'))`)), "no review for the blocked file");
      await adminPage.clickIn(`[data-client-open-sensitivity-review="${ids.fileId}"]`, "Review sensitivity & allowed use");
      await adminPage.waitForText("Submit review");
      await adminPage.idle();
      const panel = `[data-client-sensitivity-review-panel="${ids.fileId}"]`;
      const REVIEWED = ["absent", "absent", "absent", "unknown", "absent", "absent", "unknown", "absent", "unknown", "allowed"];
      for (const [index, value] of REVIEWED.entries()) {
        const ok = await adminPage.evaluate(`(() => {
          const selects = [...document.querySelectorAll(${JSON.stringify(`${panel} select`)})];
          if (selects.length !== 10) return false;
          const el = selects[${index}];
          Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, ${JSON.stringify(value)});
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        })()`);
        assert.ok(ok, `sensitivity select ${index}`);
        await adminPage.waitFor(async () => adminPage.evaluate(`[...document.querySelectorAll(${JSON.stringify(`${panel} select`)})][${index}].value === ${JSON.stringify(value)}`), `select ${index} = ${value}`);
      }
      await adminPage.waitFor(async () => adminPage.evaluate(`!document.getElementById("sensitivity-ai-processing-permitted").disabled`), "AI permission enabled once allowed use is allowed");
      await adminPage.evaluate(`document.getElementById("sensitivity-ai-processing-permitted").click()`);
      let mark = adminPage.mark();
      await adminPage.clickButton("Submit review");
      await adminPage.waitForText("Sensitivity decision recorded.");
      await adminPage.waitForText("Source-candidate handoff completed");
      await adminPage.idle();
      assert.deepEqual(adminPage.requestsSince(mark).filter((r) => r.method === "POST").map((r) => [pathOf(r), r.status]),
        [[`${COCKPIT}/sensitivity-profiles/${ids.sensitivityProfileId}/decision`, 200]]);
      const [decision] = await query(
        `SELECT decision_outcome, decided_by::text, decided_by_role, created_by_type::text, reviewed_allowed_use_status, reviewed_llm_processing_allowed
           FROM kai.intake_sensitivity_review_decisions WHERE intake_sensitivity_profile_id = $1::uuid`, [ids.sensitivityProfileId]);
      assert.deepEqual(decision, { decision_outcome: "reviewed", decided_by: ids.adminUserId, decided_by_role: "client_admin", created_by_type: "human",
        reviewed_allowed_use_status: "allowed", reviewed_llm_processing_allowed: true });
      const [candidate] = await query("SELECT intake_source_candidate_id::text, created_by::text FROM kai.intake_source_candidates WHERE intake_sensitivity_profile_id = $1::uuid", [ids.sensitivityProfileId]);
      assert.equal(candidate.created_by, ids.adminUserId);

      await adminPage.waitFor(async () => adminPage.evaluate(`Boolean(document.querySelector('[data-client-open-source-review="${ids.fileId}"]'))`), "promotion action");
      await adminPage.clickIn(`[data-client-open-source-review="${ids.fileId}"]`, "Review & promote source");
      await adminPage.waitForText("Decision outcome");
      await adminPage.idle();
      const setPanelSelect = (labelText, value) => adminPage.evaluate(`(() => {
        const panelEl = document.querySelector("[data-client-source-promotion-panel]");
        const label = panelEl && [...panelEl.querySelectorAll("label")].find((el) => el.innerText.trim().startsWith(${JSON.stringify(labelText)}));
        const el = label && label.querySelector("select");
        if (!el) return false;
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return el.value === ${JSON.stringify(value)};
      })()`);
      assert.ok(await setPanelSelect("Decision outcome", "promoted"));
      await adminPage.waitForText("Reviewed source type");
      assert.ok(await setPanelSelect("Reviewed source type", "organization_primary_record"));
      const authorization = await adminPage.evaluate(`document.querySelector("[data-client-source-authorization]").innerText`);
      assert.ok(authorization.includes("Allowed use: allowed"), authorization);
      await adminPage.clickIn("[data-client-source-authorization-confirm]", "source authorization confirmation");
      mark = adminPage.mark();
      await adminPage.clickButton("Promote");
      await adminPage.waitForText("Source promoted.");
      await adminPage.idle();
      assert.deepEqual(adminPage.requestsSince(mark).filter((r) => r.method === "POST").map((r) => [pathOf(r), r.status]),
        [[`${COCKPIT}/source-candidates/${candidate.intake_source_candidate_id}/decision`, 200]]);
      const [version] = await query(
        `SELECT v.source_version_id::text, v.is_current, v.created_by::text, s.reviewed_source_type, sp.intake_file_id::text, sp.file_profile_id::text
           FROM kai.source_versions v JOIN kai.sources s ON s.source_id = v.source_id
           JOIN kai.intake_sensitivity_profiles sp ON sp.intake_sensitivity_profile_id = v.intake_sensitivity_profile_id
          WHERE v.organization_id = $1::uuid`, [ORG_X]);
      assert.deepEqual([version.is_current, version.created_by, version.reviewed_source_type, version.intake_file_id, version.file_profile_id],
        [true, ids.adminUserId, "organization_primary_record", ids.fileId, ids.fileProfileId], "lineage: version -> uploaded file -> worker profile");
      ids.sourceVersionId = version.source_version_id;
      const humans = await query("SELECT DISTINCT actor_user_id::text FROM kai.audit_events WHERE organization_id = $1::uuid AND actor_type::text = 'human'", [ORG_X]);
      assert.deepEqual(humans, [{ actor_user_id: ids.adminUserId }], "so far the administrator is the only human actor in X");
      results.c = { decision: "reviewed by client_admin: allowed use allowed, AI permitted", sourceVersion: "current", lineage: "file -> P1 profile -> source version" };
    });

    await test("C boundary: a second uploaded file whose administrator decision is 'not_allowed' records the decision but never becomes a source", async () => {
      await openStudioTab("Files");
      await adminPage.waitForText("Upload the selected file");
      await adminPage.waitFor(async () => /Batch id: /.test(await adminPage.text()), "batch reselected");
      const scheduledBefore = dispatcher.stats().scheduled;
      await uploadThroughFiles(PARTNER);
      const [{ intake_file_id: partnerId }] = await fileByName(PARTNER.name);
      assert.equal((await fileRow(partnerId)).file_policy_status, "passed");
      assert.equal(dispatcher.stats().scheduled, scheduledBefore + 1);
      assert.deepEqual(await p1Rows(partnerId), ONE_P1);
      const [item] = await query(
        `SELECT q.review_queue_item_id::text, q.updated_at, s.intake_sensitivity_profile_id::text FROM kai.review_queue_items q
           JOIN kai.intake_sensitivity_profiles s ON s.intake_sensitivity_profile_id = q.target_object_id WHERE s.intake_file_id = $1::uuid`, [partnerId]);
      const snapshot = {
        reviewed_personal_data_status: "absent", reviewed_minor_data_status: "absent", reviewed_health_housing_justice_immigration_status: "absent",
        reviewed_indigenous_governance_status: "unknown", reviewed_staff_notes_status: "absent", reviewed_story_testimonial_status: "absent",
        reviewed_small_cell_risk_status: "unknown", reviewed_financial_records_status: "absent", reviewed_consent_basis_status: "unknown",
        reviewed_allowed_use_status: "not_allowed", reviewed_llm_processing_allowed: false, reviewed_product_learning_allowed: false,
        reviewed_public_use_allowed: false, reviewed_funder_use_allowed: false,
      };
      const base = { expected_updated_at: new Date(item.updated_at).toISOString(), review_queue_item_id: item.review_queue_item_id, decision: "reviewed" };
      const prohibited = await adminPage.api("POST", sensitivityDecisionPath(ORG_X, item.intake_sensitivity_profile_id), { ...base, reviewed_snapshot: { ...snapshot, reviewed_llm_processing_allowed: true } });
      assert.equal(prohibited.status, 422, "AI processing cannot be permitted without allowed use");
      const before = await businessCounts();
      const decided = await adminPage.api("POST", sensitivityDecisionPath(ORG_X, item.intake_sensitivity_profile_id), { ...base, reviewed_snapshot: snapshot });
      assert.equal(decided.status, 200, JSON.stringify(decided.body));
      assert.equal(decided.body.data.source_candidate_handoff.status, "not_created");
      const after = await businessCounts();
      assert.deepEqual([after.sensitivity_decisions - before.sensitivity_decisions, after.candidates - before.candidates, after.sources - before.sources, after.source_versions - before.source_versions], [1, 0, 0, 0]);
      results.notAllowed = "PASS: AI-permitted with not_allowed 422; reviewed not_allowed recorded, no candidate/source/version";
    });

    // -----------------------------------------------------------------------
    // Step D: the measurement and claim from the actual parser counts.
    // -----------------------------------------------------------------------
    await test("D: Count records shows the worker's counts from the uploaded bytes; the administrator records the definition and attested period; the measurement equals the independent count; the claim proposal creates no follow-up", async () => {
      await openStudioTab("Data Sources");
      await adminPage.waitFor(async () => Boolean(await textOf(adminPage, `[data-client-open-source-measurement="${ids.sourceVersionId}"]`)), "Count records");
      let mark = adminPage.mark();
      await adminPage.clickIn(`[data-client-open-source-measurement="${ids.sourceVersionId}"]`, "Count records");
      await adminPage.waitForText(`Counted records = data records minus blank records = ${independent.counted}`);
      await adminPage.idle();
      const basisReads = adminPage.requestsSince(mark).filter((r) => r.url.includes("/record-count-measurement"));
      assert.deepEqual(basisReads.map((r) => [r.method, r.status]), [["GET", 200]]);
      const basis = await adminPage.api("GET", sourceRecordCountMeasurementPath(ORG_X, ids.sourceVersionId));
      assert.equal(basis.status, 200, JSON.stringify(basis.body));
      const counts = await textOf(adminPage, "[data-client-source-measurement-counts]");
      assert.match(counts, new RegExp(`Data records after the header row: ${independent.dataRecords}`));
      assert.match(counts, new RegExp(`Blank records \\(not counted\\): ${independent.blankRecords}`));
      assert.match(counts, new RegExp(`Exact-duplicate records \\(still counted\\): ${independent.duplicateRecords}`));
      assert.equal(await textOf(adminPage, "[data-client-source-measurement-counted]"), String(independent.counted));
      for (const [field, value] of [
        ["countedUnit", "programme session"], ["unitLabel", "programme sessions"],
        ["definitionText", "Each row of the session log records one delivered programme session."],
        ["inclusionRule", "Every data row after the header row that has at least one value."],
        ["exclusionRule", "The header row and empty rows."], ["periodStart", "2026-09-01"], ["periodEnd", "2026-09-30"],
      ]) assert.ok(await setInput(adminPage, `[data-client-source-measurement-field="${field}"]`, value), field);
      await adminPage.waitForText("Confirm that the reporting period is your organization's statement.");
      await adminPage.clickIn('[data-client-source-measurement-field="periodAttested"]', "attest period");
      mark = adminPage.mark();
      await adminPage.clickIn("[data-client-source-measurement-submit]", "Record definition and count");
      await adminPage.waitForText(`Measurement: ${independent.counted} programme sessions`);
      await adminPage.idle();
      const writes = adminPage.requestsSince(mark).filter((r) => r.method === "POST");
      assert.deepEqual(writes.map((r) => [pathOf(r).endsWith("/record-count-measurement"), r.status]), [[true, 200]]);
      const [measurement] = await query(
        `SELECT m.measured_value, m.evidence_item_id::text, d.created_by_type::text AS definition_by, d.period_start::text, d.period_end::text
           FROM kai.evidence_measurements m JOIN kai.source_measurement_definitions d ON d.source_measurement_definition_id = m.source_measurement_definition_id
          WHERE m.organization_id = $1::uuid`, [ORG_X]);
      assert.equal(Number(measurement.measured_value), independent.counted);
      assert.deepEqual([measurement.definition_by, measurement.period_start, measurement.period_end], ["human", "2026-09-01", "2026-09-30"]);
      ids.evidenceItemId = measurement.evidence_item_id;
      ids.measuredValue = Number(measurement.measured_value);

      await adminPage.clickIn(`[data-client-source-measurement-propose-claim="${ids.evidenceItemId}"]`, "Propose a claim");
      await adminPage.waitForText(`Claim: The promoted source records ${independent.counted} programme sessions`);
      const [claim] = await query("SELECT claim_id::text, statement FROM kai.claims WHERE organization_id = $1::uuid AND evidence_item_id = $2::uuid", [ORG_X, ids.evidenceItemId]);
      assert.match(claim.statement, /^The promoted source records 5 programme sessions for the reporting period 2026-09-01 to 2026-09-30/);
      const [gaps] = await query(`SELECT (SELECT count(*) FROM kai.gap_log_items WHERE claim_id = $1::uuid)::int AS gaps,
        (SELECT count(*) FROM kai.client_followup_items WHERE claim_id = $1::uuid)::int AS followups`, [claim.claim_id]);
      assert.ok(gaps.gaps > 0, "measurement-specific gap state recorded at proposal (no manual P2-04 step)");
      assert.equal(gaps.followups, 0, "no unnecessary client follow-up");
      ids.claimId = claim.claim_id;
      ids.claimValue = Number(/records (\d+) programme sessions/.exec(claim.statement)[1]);
      results.d = { measurement: ids.measuredValue, claim: ids.claimValue, followups: 0 };
    });

    await test("D boundaries: a conflicting definition keeps the recorded identity with a structured 409; other roles, the inactive administrator, and another organization cannot read the basis", async () => {
      const before = await businessCounts();
      const conflict = await adminPage.api("POST", sourceRecordCountMeasurementPath(ORG_X, ids.sourceVersionId), {
        counted_unit: "attendance record", unit_label: "attendance records", definition_text: "Each row is one attendance record.",
        inclusion_rule: "Rows with a value.", exclusion_rule: "Empty rows.",
      });
      assert.equal(conflict.status, 409, JSON.stringify(conflict.body));
      assert.equal(conflict.body.blockers[0].blocking_reason, "measurement_definition_already_recorded");
      const invalid = await adminPage.api("POST", sourceRecordCountMeasurementPath(ORG_X, ids.sourceVersionId), { counted_unit: "" });
      assert.ok([409, 422].includes(invalid.status), `invalid definition: ${invalid.status}`);
      const basisPath = sourceRecordCountMeasurementPath(ORG_X, ids.sourceVersionId);
      const outcomes = { conflict: 409, invalid: invalid.status };
      for (const [label, page, path, status] of [
        ["client_contributor", contributorPage, basisPath, 403],
        ["client_reviewer", reviewerPage, basisPath, 403],
        ["inactive organization administrator", inactiveAdminPage, basisPath, 403],
        ["another organization's administrator", adminYPage, basisPath, 403],
      ]) {
        const response = await page.api("GET", path);
        assert.equal(response.status, status, `${label}: ${JSON.stringify(response.body)}`);
        outcomes[label] = response.status;
      }
      assert.deepEqual({ ...(await businessCounts()), audit_events: 0 }, { ...before, audit_events: 0 });
      results.dBoundaries = outcomes;
    });

    // -----------------------------------------------------------------------
    // Step E: GK review, generation, release.
    // -----------------------------------------------------------------------
    await test("E1: GK reviews the evidence and claim and accepts the source-level limitations; the administrator cannot", async () => {
      const evidenceQueue = await queueOf("evidence_review", ids.evidenceItemId);
      const evidenceBody = evidenceReviewDecisionBody({ expectedUpdatedAt: new Date(evidenceQueue.updated_at).toISOString(), decision: "supported" });
      const evidencePath = evidenceReviewCompletePath(ORG_X, ids.evidenceItemId, evidenceQueue.review_queue_item_id);
      assert.equal((await adminPage.api("POST", evidencePath, evidenceBody)).status, 403, "the administrator cannot record GK's evidence review");
      created(await gkReviewerPage.api("POST", evidencePath, evidenceBody), "evidence review");
      const claimQueue = await queueOf("claim_review", ids.claimId);
      const claimBody = claimReviewDecisionBody({ expectedUpdatedAt: new Date(claimQueue.updated_at).toISOString(), decision: "approved", approvedAudiences: ["internal"] });
      const claimPath = claimReviewCompletePath(ORG_X, ids.claimId, claimQueue.review_queue_item_id);
      assert.equal((await adminPage.api("POST", claimPath, claimBody)).status, 403, "the administrator cannot record GK's claim review");
      created(await gkReviewerPage.api("POST", claimPath, claimBody), "claim review");
      const traced = await gkReviewerPage.api("GET", claimTraceabilityPath(ORG_X, ids.claimId, "internal"));
      assert.equal(traced.status, 200, JSON.stringify(traced.body));
      const unresolved = Object.entries(traced.body.data.dimensions).filter(([, value]) => value.assessment_status === "unresolved").map(([key]) => key).sort();
      for (const dimensionKey of unresolved) {
        assert.equal((await adminPage.api("POST", coverageInternalAcceptancePath(ORG_X, ids.claimId, dimensionKey), {})).status, 403);
        created(await gkReviewerPage.api("POST", coverageInternalAcceptancePath(ORG_X, ids.claimId, dimensionKey), {}), dimensionKey);
      }
      const eligible = await gkReviewerPage.api("GET", claimTraceabilityPath(ORG_X, ids.claimId, "internal"));
      assert.equal(eligible.body.data.eligible, true, JSON.stringify(eligible.body.data.blockerCodes));
      const [followups] = await query("SELECT count(*)::int AS n FROM kai.client_followup_items WHERE claim_id = $1::uuid", [ids.claimId]);
      assert.equal(followups.n, 0);
      results.e1 = { acceptedDimensions: unresolved, eligible: true };
    });

    await test("E2: the administrator generates the internal Evidence Summary in the UI; the generator receives the measured claim and its limitations; the model's 'approval' changes nothing", async () => {
      await openStudioTab("Data Sources");
      await adminPage.waitFor(async () => Boolean(await textOf(adminPage, `[data-client-claim="${ids.claimId}"]`)), "the measured claim");
      await adminPage.clickIn(`[data-client-claim="${ids.claimId}"] input[type=checkbox]`, "Use in an internal draft");
      await adminPage.clickButton("Generate internal evidence summary");
      await adminPage.waitForText("Internal evidence summary created");
      await adminPage.idle();
      assert.equal(modelCalls.length, 1);
      assert.equal(modelCalls[0].claims.length, 1);
      assert.equal(modelCalls[0].claims[0].claimId, ids.claimId);
      assert.equal(modelCalls[0].claims[0].evidenceItemId, ids.evidenceItemId);
      assert.deepEqual(modelCalls[0].claims[0].limitationCodes, MEASURED_LIMITATION_CODES);
      const [draft] = await query(
        `SELECT d.generated_content_draft_id::text, d.draft_status, d.review_status, b.text AS block_text
           FROM kai.generated_content_drafts d JOIN kai.generated_content_blocks b ON b.generated_content_draft_id = d.generated_content_draft_id
          WHERE d.organization_id = $1::uuid`, [ORG_X]);
      assert.deepEqual([draft.draft_status, draft.review_status], ["draft", "needs_gk_review"], "the model's approval/release fields are not authoritative");
      ids.draftId = draft.generated_content_draft_id;
      ids.generatedValue = Number(/records (\d+) programme sessions/.exec(draft.block_text)[1]);
      await adminPage.waitFor(async () => (await textOf(adminPage, "[data-client-internal-draft-release-state]")) !== null, "release state");
      assert.equal(await adminPage.evaluate(`document.querySelector("[data-client-internal-draft-release-state]").getAttribute("data-client-internal-draft-release-state")`), "awaiting_get_kinder_review");
      assert.equal(await textOf(adminPage, "[data-client-open-released-report]"), null, "nothing to open before review");
      results.e2 = { modelCalls: modelCalls.length, generatedValue: ids.generatedValue, draft: [draft.draft_status, draft.review_status] };
    });

    await test("E3: GK completes the content review, export review, snapshot, candidate, final release, and manifest; the administrator and the GK reviewer cannot release", async () => {
      const queue = await queueOf("generated_content_review", ids.draftId);
      const startBody = { expected_updated_at: new Date(queue.updated_at).toISOString() };
      assert.equal((await adminPage.api("POST", generatedContentReviewStartPath(ORG_X, ids.draftId, queue.review_queue_item_id), startBody)).status, 403);
      assert.equal((await gkReviewerPage.api("POST", generatedContentReviewStartPath(ORG_X, ids.draftId, queue.review_queue_item_id), startBody)).status, 200);
      const inProgress = await queueOf("generated_content_review", ids.draftId);
      assert.equal((await gkReviewerPage.api("POST", generatedContentReviewCompletePath(ORG_X, ids.draftId, inProgress.review_queue_item_id),
        { expected_updated_at: new Date(inProgress.updated_at).toISOString() })).status, 200);
      await adminPage.clickIn(`[data-client-internal-draft="${ids.draftId}"] button`, "Read draft");
      await adminPage.waitForText("Reviewed; awaiting Get Kinder release");
      assert.equal(await textOf(adminPage, "[data-client-open-released-report]"), null);

      const draftPath = `${orgPath()}/generated-content-drafts/${ids.draftId}`;
      assert.equal((await adminPage.api("POST", `${draftPath}/export-review-request`, { requested_export_audience: "internal" })).status, 403);
      created(await gkAdminPage.api("POST", `${draftPath}/export-review-request`, { requested_export_audience: "internal" }), "export review request");
      for (const step of ["start", "complete"]) {
        const exportQueue = await queueOf("export_review", ids.draftId);
        const moved = await gkAdminPage.api("POST", `${draftPath}/export-review-queue/${exportQueue.review_queue_item_id}/${step}`, { expected_updated_at: new Date(exportQueue.updated_at).toISOString() });
        assert.equal(moved.status, 200, `${step}: ${JSON.stringify(moved.body)}`);
      }
      ids.exportReviewQueueItemId = (await queueOf("export_review", ids.draftId)).review_queue_item_id;
      assert.equal((await adminPage.api("POST", `${draftPath}/limitation-snapshot`, {})).status, 403);
      created(await gkReviewerPage.api("POST", `${draftPath}/limitation-snapshot`, {}), "limitation snapshot");
      const [entry] = await query("SELECT limitation_codes FROM kai.limitation_snapshot_entries WHERE organization_id = $1::uuid", [ORG_X]);
      assert.deepEqual(entry.limitation_codes, MEASURED_LIMITATION_CODES);
      created(await gkAdminPage.api("POST", `${draftPath}/export-candidates`, {}), "export candidate");
      const [candidateRow] = await query("SELECT export_candidate_id::text FROM kai.export_candidates WHERE organization_id = $1::uuid", [ORG_X]);
      ids.exportCandidateId = candidateRow.export_candidate_id;
      const authorityPath = `${orgPath()}/export-candidates/${ids.exportCandidateId}/final-release-authority`;
      const manifestPath = `${orgPath()}/export-candidates/${ids.exportCandidateId}/export-manifests`;
      for (const [label, page] of [["client_admin", adminPage], ["gk_reviewer", gkReviewerPage]]) {
        assert.equal((await page.api("POST", authorityPath, { requested_audience: "internal", decision_action: "grant" })).status, 403, label);
        assert.equal((await page.api("POST", manifestPath, { export_review_queue_item_id: ids.exportReviewQueueItemId })).status, 403, label);
      }
      created(await gkAdminPage.api("POST", authorityPath, { requested_audience: "internal", decision_action: "grant" }), "final release grant");
      created(await gkAdminPage.api("POST", manifestPath, { export_review_queue_item_id: ids.exportReviewQueueItemId }), "manifest");
      const [manifestRow] = await query("SELECT export_manifest_id::text FROM kai.export_manifests WHERE organization_id = $1::uuid", [ORG_X]);
      ids.exportManifestId = manifestRow.export_manifest_id;
      const gkMarkdown = await fetchText(gkAdminPage, `${orgPath()}/export-manifests/${ids.exportManifestId}/markdown`);
      assert.equal(gkMarkdown.status, 200, gkMarkdown.body);
      ids.gkMarkdown = gkMarkdown.body;
      results.e3 = { released: true, releasedBy: "gk_admin" };
    });

    // -----------------------------------------------------------------------
    // Step F: the administrator obtains the released Markdown.
    // -----------------------------------------------------------------------
    await test("F: the administrator sees the release, opens it (HTTP 200), and receives exactly the released Markdown with the five-session measurement, citations, and limitations", async () => {
      await adminPage.clickIn(`[data-client-internal-draft="${ids.draftId}"] button`, "Read draft");
      await adminPage.waitForText("Released by Get Kinder for internal use");
      const mark = adminPage.mark();
      await adminPage.clickIn(`[data-client-open-released-report="${ids.exportManifestId}"]`, "Open released report");
      await adminPage.waitFor(async () => Boolean(await textOf(adminPage, "[data-client-released-report-markdown]")), "the released Markdown");
      await adminPage.idle();
      const receipt = adminPage.requestsSince(mark).filter((entry) => entry.url.includes("/client-released-reports/"));
      assert.deepEqual(receipt.map((entry) => [entry.method, entry.status]), [["GET", 200]]);
      const shown = await textOf(adminPage, "[data-client-released-report-markdown]");
      assert.equal(shown, ids.gkMarkdown, "the organization receives exactly the document Get Kinder released");
      const download = await adminPage.evaluate(`document.querySelector("[data-client-download-released-report]").getAttribute("href")`);
      assert.equal(download, clientReleasedReportMarkdownPath(ORG_X, PROJECT_X, ids.exportManifestId));
      const fetched = await fetchText(adminPage, download);
      assert.deepEqual([fetched.status, Buffer.from(fetched.body).equals(Buffer.from(ids.gkMarkdown))], [200, true]);
      assert.match(fetched.disposition, /attachment/);
      ids.markdownValue = Number((/records (\d+) programme sessions/.exec(shown) || [])[1]);
      assert.equal(ids.markdownValue, independent.counted);
      assert.match(shown, /Organization: Harbourline Session Society/);
      assert.match(shown, /Engagement: `Session Programme 2026`/);
      assert.match(shown, /1 blank record was excluded and 2 exact-duplicate records were included/);
      assert.match(shown, /period is attested in that definition and not verified against record dates/);
      assert.match(shown, /2026-09-01 to 2026-09-30/);
      assert.ok(shown.includes(`Claim \`${ids.claimId}\`; evidence \`${ids.evidenceItemId}\`;`), "claim and evidence citation");
      assert.ok(shown.includes(`source version \`${ids.sourceVersionId}\``), "source version citation");
      for (const code of MEASURED_LIMITATION_CODES) assert.ok(shown.includes(`\`${code}\``), code);
      assert.match(shown, /Missing values: a known limitation of this source, recorded and not removed\./);
      assert.match(shown, /not of distinct events/);
      assert.doesNotMatch(shown.split("## Citation Appendix")[0], /\b(participants?|attendees|rate|outcomes?|because|caused?|improv\w*|impact\w*)\b|%/i,
        "no rate, participant, outcome, or causal finding");
      assert.doesNotMatch(shown, /literacy|mentoring|2026-09-16|programme-sessions-september/, "no row values or file names");
      results.f = { status: 200, bytes: Buffer.byteLength(shown), identicalToGkRelease: true };
    });

    await test("F boundaries: other roles, organizations, Projects, and the GK route are refused; a revoked release and a stale source block retrieval and the UI says so", async () => {
      const clientPath = clientReleasedReportMarkdownPath(ORG_X, PROJECT_X, ids.exportManifestId);
      const outcomes = {};
      for (const [label, page, path, status] of [
        ["client_contributor", contributorPage, clientPath, 403],
        ["client_reviewer", reviewerPage, clientPath, 403],
        ["inactive organization administrator", inactiveAdminPage, clientPath, 403],
        ["GK reviewer on the customer route", gkReviewerPage, clientPath, 403],
        ["another organization's administrator", adminYPage, clientPath, 403],
        ["another organization's path", adminPage, clientReleasedReportMarkdownPath(ORG_Y, PROJECT_Y, ids.exportManifestId), 403],
        ["another Project of the organization", adminPage, clientReleasedReportMarkdownPath(ORG_X, PROJECT_X2, ids.exportManifestId), 404],
        ["the GK delivery route", adminPage, `${orgPath()}/export-manifests/${ids.exportManifestId}/markdown`, 403],
      ]) {
        const response = await fetchText(page, path);
        assert.equal(response.status, status, `${label}: ${response.body.slice(0, 300)}`);
        assert.doesNotMatch(response.body, /programme sessions/, label);
        outcomes[label] = response.status;
      }
      const authorityPath = `${orgPath()}/export-candidates/${ids.exportCandidateId}/final-release-authority`;
      created(await gkAdminPage.api("POST", authorityPath, { requested_audience: "internal", decision_action: "revoke" }), "revoke");
      const afterRevoke = await fetchText(adminPage, clientPath);
      assert.equal(afterRevoke.status, 409, afterRevoke.body);
      await adminPage.clickIn(`[data-client-internal-draft="${ids.draftId}"] button`, "Read draft");
      await adminPage.waitForText("Released earlier; no longer available");
      assert.equal(await textOf(adminPage, "[data-client-open-released-report]"), null);
      created(await gkAdminPage.api("POST", authorityPath, { requested_audience: "internal", decision_action: "grant" }), "re-grant");
      assert.equal((await fetchText(adminPage, clientPath)).status, 200);
      // INJECTED STATE (labeled): no application operation supersedes a source
      // version, so currentness is flipped directly to prove the refusal.
      await query("UPDATE kai.source_versions SET is_current = false WHERE source_version_id = $1::uuid", [ids.sourceVersionId]);
      try {
        const stale = await fetchText(adminPage, clientPath);
        assert.equal(stale.status, 409, stale.body);
        assert.doesNotMatch(stale.body, /programme sessions/);
        outcomes.stale = stale.status;
      } finally {
        await query("UPDATE kai.source_versions SET is_current = true WHERE source_version_id = $1::uuid", [ids.sourceVersionId]);
      }
      outcomes.revoked = afterRevoke.status;
      outcomes.regranted = 200;
      results.fBoundaries = outcomes;
    });

    await test("summary: one value from bytes to report, one customer identity, no hidden step", async () => {
      const [profileRow] = await query("SELECT profile FROM kai.intake_file_profiles WHERE file_profile_id = $1::uuid", [ids.fileProfileId]);
      const persistedProfileCounted = profileRow.profile.counts.row_count - profileRow.profile.counts.blank_record_count;
      const chain = {
        independentSourceCount: independent.counted,
        persistedP1ProfileCounted: persistedProfileCounted,
        governedMeasurement: ids.measuredValue,
        claimStatement: ids.claimValue,
        generatedContent: ids.generatedValue,
        releasedMarkdown: ids.markdownValue,
      };
      assert.deepEqual(new Set(Object.values(chain)), new Set([5]), JSON.stringify(chain));
      results.byteToReport = { ...chain, checksum: independent.checksum, profileCounts: ids.profileCounts };
      // The administrator acted only as itself in X, and never as GK.
      const adminRoles = await query("SELECT role_id FROM kai.user_roles WHERE user_id = $1::uuid", [ids.adminUserId]);
      assert.deepEqual(adminRoles, [], "no global role for the customer");
      const humanActors = await query(
        `SELECT DISTINCT a.actor_user_id::text, u.legacy_public_userdata_id FROM kai.audit_events a JOIN kai.users u ON u.user_id = a.actor_user_id
          WHERE a.organization_id = $1::uuid AND a.actor_type::text = 'human' ORDER BY u.legacy_public_userdata_id`, [ORG_X]);
      assert.deepEqual(humanActors.map((row) => row.legacy_public_userdata_id).sort(), [USERS.gkReviewer, USERS.gkAdmin, USERS.clientAdmin].sort());
      console.log(`[plan-a-assembled-file-to-report] ${JSON.stringify(results, null, 2)}`);
      for (const page of allPages) assert.deepEqual(page.exceptions, []);
    });
  } finally {
    restoreRuntime();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await seedPool.end();
    await ambientPool.end();
  }
}
