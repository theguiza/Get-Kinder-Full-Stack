import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import vm from "node:vm";

/**
 * Plan A Prompt 9, updated for the owner decision of 2026-10-25: the
 * assembled customer journey from actual CSV upload bytes to two internal
 * reports (an Evidence Summary and an impact narrative) as Markdown, in a
 * real headless Chrome, with no evidence, claim or coverage review, no
 * factual approval and no release decision. Run only by
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
 * candidate, P1-08 promotion, measurement, and claim; the automatic internal
 * eligibility of the ordinary measured claim (P2-06); the administrator's
 * generation of both reports and their Markdown retrieval and download; the
 * refusals of other actors, unsupported content, stale, sensitive and
 * no-longer-permitted sources; and a later human or GK decision governing.
 * Simulated at external boundaries only (reported as such):
 * - session: the Get Kinder login (req.user from a harness cookie);
 * - object storage: an in-process stand-in for the GCS signed-PUT and
 *   exact-generation read contract (the browser PUTs to a loopback URL);
 * - malware scanner: a deterministic adapter (clean / detected / unavailable)
 *   called by the real bounded assessor; no ClamAV service is contacted;
 * - model provider: the Anthropic SDK Messages prototype is patched in this
 *   process to a deterministic response (no network or model call);
 * - KAI_PUBLIC_EXPORT_ENABLED=true in this test process only (and briefly
 *   false, to show the internal report does not depend on it).
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
    + "Internal limitations: small-cell risk, conflicting source indicators, and requirement alignment are unresolved and carried with the count for internal use only.";
  // A boundary test sets modelOverride.text to an unsupported reply for one call.
  const modelOverride = { text: null };
  messagesPrototype.create = async function deterministicCreate(payload) {
    const requestBody = JSON.parse(payload.messages[0].content);
    modelCalls.push({ system: payload.system, claims: requestBody.claims });
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
    clientInternalReportMarkdownPath,
    evidenceReviewCompletePath,
    evidenceReviewDecisionBody,
    buildSensitivityDecisionRequestBody,
    projectSensitivityDetail,
    sensitivityProfilePath,
    sensitivityReviewFormStateFromDecision,
  } = await import("../frontend/impactEvidenceLibraryLogic.js");
  const { sourceRecordCountMeasurementPath } = await import("../frontend/knowledgeStudio/clientSourceMeasurementLogic.js");
  const { organizationFactualReviewPath } = await import("../frontend/knowledgeStudio/clientMeasuredClaimReviewLogic.js");
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
  // The production browser-console canary is exercised against this assembled
  // app. Its fixture is the established synthetic programme-session log (one
  // data record per session, one empty line, two identical records, all
  // counted) plus a canary_run column carrying the run tag, so the customer
  // uploads exactly the bytes the canary generates.
  const CANARY_SOURCE = readFileSync(new URL("../scripts/kai-production-browser-console-canary.js", import.meta.url), "utf8");
  const CANARY_TAG = "kc202610231200c0ffee";
  const CANARY_STORE_KEY = "kai.productionConsoleCanary.v1";
  const canaryHelpers = (() => {
    const silent = { log() {}, warn() {}, error() {}, table() {} };
    const context = { console: silent, TextEncoder, URL, setTimeout, location: { origin: "vm://canary", pathname: "/" } };
    vm.runInNewContext(CANARY_SOURCE, context);
    return context.KAI_CANARY._test;
  })();
  const CSV = canaryHelpers.fixtureText(CANARY_TAG);
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
  // No reviewer accepts the source-level limitations (owner decision
  // 2026-10-25): they are carried, unresolved, into every report.
  const MEASURED_LIMITATION_CODES = [
    "coverage.conflicting_source_indicators.unresolved",
    "coverage.duplicates.resolved_risk_flagged",
    "coverage.missingness.resolved_risk_flagged",
    "coverage.requirement_alignment.unresolved",
    "coverage.small_cell_risk.unresolved",
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
  const SESSIONS = customerFile(canaryHelpers.fixtureFilename(CANARY_TAG), CSV_BYTES);
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
  // A navigation clears the page; the operator pastes the same script again.
  async function pasteCanaryIfAbsent(page) {
    if (await page.evaluate("typeof window.KAI_CANARY") === "undefined") await page.evaluate(CANARY_SOURCE);
  }
  // The canary's own file is chosen by KAI_CANARY.attachFixture(), the
  // console helper an operator uses; every other file through the dialog.
  const uploadThroughFiles = async (file) => {
    if (file === SESSIONS) {
      await pasteCanaryIfAbsent(adminPage);
      await adminPage.evaluate("KAI_CANARY.attachFixture()");
    }
    const mark = adminPage.mark();
    if (file !== SESSIONS) await adminPage.chooseFile(file.path);
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

  // A console canary call, as typed into DevTools: while it runs, only GET
  // requests to the KAI API may leave the page.
  const J = JSON.stringify;
  const canaryCall = async (page, expression) => {
    await pasteCanaryIfAbsent(page);
    await page.idle();
    const mark = page.mark();
    const value = await page.evaluate(`(async () => JSON.parse(JSON.stringify(await (${expression}))))()`);
    await page.idle();
    const sent = page.requestsSince(mark);
    assert.deepEqual(sent.filter((r) => r.method !== "GET").map((r) => `${r.method} ${pathOf(r)}`), [], "the canary sends only GET requests");
    assert.ok(sent.every((r) => pathOf(r).startsWith(`${BASE_PATH}/`)), `the canary reads only the KAI API: ${sent.map(pathOf).join(", ")}`);
    return value;
  };
  const canaryState = (page) => page.evaluate(`JSON.parse(localStorage.getItem(${J(CANARY_STORE_KEY)}) || "null")`);
  const expectCanary = async (page, summary, expected) => {
    const state = await canaryState(page);
    for (const [key, status] of Object.entries(expected)) {
      assert.equal(summary.stages[key], status, `${key}: ${J(state?.stages?.[key])}`);
    }
    return state;
  };
  // A complete internal report: context, finding, period, method, duplicates,
  // limitations, what it does and does not establish, analysis, narrative,
  // traceability, authority, conclusion and references, all for the same
  // five-record measurement.
  const assertCompleteReport = (shown, heading) => {
    assert.ok(shown.startsWith(`${heading}\n`), shown.slice(0, 80));
    for (const section of ["Context", "Key findings", "Reporting period", "Measurement definition and counting method", "Duplicate records",
      "Data quality and limitations", "What this evidence establishes", "What this evidence does not establish", "Analysis", "Generated narrative",
      "Source and evidence traceability", "Authority for internal use", "Conclusion", "References"]) {
      assert.ok(shown.includes(`\n## ${section}\n`), `section ${section}`);
    }
    assert.match(shown, /\*\*Organization:\*\* Harbourline Session Society/);
    assert.match(shown, /\*\*Project \/ engagement:\*\* `Session Programme 2026`/);
    assert.equal(Number((/records \*\*(\d+) programme sessions\*\*/.exec(shown) || [])[1]), independent.counted);
    assert.match(shown, /for the reporting period 2026-09-01 to 2026-09-30/);
    assert.match(shown, /6 data records after the header, minus 1 blank record excluded = \*\*5\*\* counted/);
    assert.match(shown, /2 exact-duplicate records\. They are included in the count of 5, not removed or merged/);
    assert.match(shown, /not checked against dates in the records/);
    assert.match(shown, /## What this evidence does not establish[\s\S]*distinct people[\s\S]*distinct real-world sessions[\s\S]*outcome[\s\S]*caused any result/);
    assert.match(shown, /## Conclusion\n\nOn the available evidence, the organization's promoted source records 5 programme sessions for 2026-09-01 to 2026-09-30\./);
    for (const code of MEASURED_LIMITATION_CODES) assert.ok(shown.includes(`\`${code}\``), code);
    for (const id of [ids.claimId, ids.evidenceItemId, ids.sourceVersionId]) assert.ok(shown.includes(`\`${id}\``), id);
    assert.ok(shown.includes(COMPLIANT_TEXT), "the validated generated text");
    assert.match(shown, /no further approval is required for internal use/);
    assert.doesNotMatch(shown, /field_\d/, "never a field-presence claim in place of the measured result");
    assert.doesNotMatch(shown, /literacy|mentoring|2026-09-16|programme-sessions-september|kc\d{12}/, "no row values, file names or run tags");
  };
  const CANARY_START = `KAI_CANARY.start({ organizationId: ${J(ORG_X)}, engagementId: ${J(PROJECT_X)}, confirm: KAI_CANARY.confirmPhrase })`;

  const results = { simulatedBoundaries: ["session (harness cookie)", "object storage (in-process signed-PUT/exact-generation stand-in)", "malware scanner (deterministic adapter behind the real assessor)", "model provider (patched SDK Messages.create)"] };
  const ids = {};
  try {
    // Every page starts on the app's origin, so its same-origin requests resolve.
    for (const page of allPages) await page.goto("/impact-library");

    // -----------------------------------------------------------------------
    // Step A + recovery: the actual bytes enter through the upload boundary
    // while the scanner is unavailable.
    // -----------------------------------------------------------------------
    await test("Console canary: the pasted script initializes, runs only a read-only preflight, generates the synthetic CSV, and starts only with the owner's phrase", async () => {
      await openStudioTab("Files");
      const mark = adminPage.mark();
      await adminPage.evaluate(CANARY_SOURCE);
      const methods = await adminPage.evaluate(`["preflight", "makeFixture", "start", "next", "status", "report", "resume"].filter((name) => typeof window.KAI_CANARY?.[name] === "function")`);
      assert.deepEqual(methods, ["preflight", "makeFixture", "start", "next", "status", "report", "resume"]);
      const preflight = await canaryCall(adminPage, `KAI_CANARY.preflight({ organizationId: ${J(ORG_X)}, engagementId: ${J(PROJECT_X)} })`);
      assert.deepEqual(adminPage.requestsSince(mark).filter((r) => r.method !== "GET").map(pathOf), [], "the paste-time and explicit preflights write nothing");
      const byCheck = Object.fromEntries(preflight.checks.map((check) => [check.Check, check.Status]));
      assert.equal(preflight.readOnly, true);
      assert.equal(byCheck["Signed-in session"], "PASS");
      assert.equal(byCheck["Customer workspace & capabilities"], "PASS", J(preflight.checks));
      assert.equal(byCheck["Synthetic CSV (in memory)"], "PASS");
      assert.equal(byCheck["Origin class"], "NOT_CONFIRMED", "a loopback origin can never yield a production pass");
      assert.equal(byCheck["Internal release flag (KAI_PUBLIC_EXPORT_ENABLED)"], undefined, "internal reports need no release, so the export flag is not checked");
      assert.equal(await adminPage.evaluate(`KAI_CANARY._test.fixtureText(${J(CANARY_TAG)})`), CSV, "the browser generates exactly the bytes the customer uploads");
      const fixture = await adminPage.evaluate(`(() => { const f = KAI_CANARY.makeFixture({ download: false }); return { name: f.name, bytes: f.bytes, counts: f.counts, type: f.file.type }; })()`);
      assert.deepEqual(fixture.counts, { dataRecords: 6, blankRecords: 1, duplicateRecords: 2, counted: 5 });
      assert.match(fixture.name, /^kai_canary_kc\d{12}[0-9a-f]{6}\.csv$/);
      assert.equal(fixture.type, "text/csv");
      // The run adopts a fixture the operator generated before start(); here
      // the one whose bytes this harness uploads.
      await adminPage.evaluate(`localStorage.setItem(${J(`${CANARY_STORE_KEY}.pendingTag`)}, ${J(CANARY_TAG)})`);
      const refused = await adminPage.evaluate(`KAI_CANARY.start({ organizationId: ${J(ORG_X)}, engagementId: ${J(PROJECT_X)} }).then(() => "started", (error) => error.message)`);
      assert.match(refused, /explicit authorization/);
      assert.equal(await canaryState(adminPage), null, "no run without the owner's phrase");
      const started = await canaryCall(adminPage, CANARY_START);
      const state = await expectCanary(adminPage, started, { workspace: "PASS", fixture: "PASS", upload_processing: "WAITING_FOR_HUMAN", internal_eligibility: "NOT_CONFIRMED" });
      assert.equal(state.tag, CANARY_TAG);
      assert.match(started.verdict, /^IN_PROGRESS at 3 Upload/);
      assert.match(state.stages.upload_processing.next, /Upload the selected file/);
      const again = await adminPage.evaluate(`${CANARY_START}.then(() => "started", (error) => error.message)`);
      assert.match(again, /already exists/, "a second start never replaces the run");
      results.canary = { preflight: "read-only PASS", start: started.verdict };
    });

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

    await test("Console canary: with the scanner unavailable it reports the real BLOCKED stage and the existing recovery action", async () => {
      const summary = await canaryCall(adminPage, "KAI_CANARY.next()");
      const state = await expectCanary(adminPage, summary, { upload_processing: "BLOCKED", sensitivity_source: "NOT_CONFIRMED" });
      assert.match(state.stages.upload_processing.observed, /scanner unavailable/i);
      assert.match(state.stages.upload_processing.next, /Check security again/);
      assert.equal(state.ids.intakeFileId, ids.fileId);
      results.canary.scannerOutage = state.stages.upload_processing.status;
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

    await test("Console canary: after recovery the deployed upload, scan and P1 results pass and it waits for the human sensitivity review", async () => {
      const summary = await canaryCall(adminPage, "KAI_CANARY.next()");
      const state = await expectCanary(adminPage, summary, { upload_processing: "PASS", sensitivity_source: "WAITING_FOR_HUMAN" });
      assert.match(state.stages.upload_processing.observed, new RegExp(`${CSV_BYTES.byteLength} bytes; policy passed`));
      assert.match(state.stages.sensitivity_source.next, /Review sensitivity & allowed use/);
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
      // The administrator's synthetic judgment of programme-session logs:
      // every Operating Model 7.2 category absent (personal, minors, health/
      // housing/justice/immigration, Indigenous/governance, story, small-cell),
      // which makes drafts from this source ordinary; staff notes and
      // financial records absent; consent basis unknown (not required for
      // internal use).
      const REVIEWED = ["absent", "absent", "absent", "absent", "absent", "absent", "absent", "absent", "unknown", "allowed"];
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

    await test("Console canary: the human decision and promotion are read back from the server with the deployed parser counts", async () => {
      const summary = await canaryCall(adminPage, "KAI_CANARY.next()");
      const state = await expectCanary(adminPage, summary, { sensitivity_source: "PASS", measurement: "WAITING_FOR_HUMAN" });
      assert.equal(state.ids.sourceVersionId, ids.sourceVersionId);
      assert.equal(state.ordinary, true);
      assert.match(state.stages.sensitivity_source.observed, /decision reviewed by client_admin \(human\); allowed use allowed; AI true/);
      assert.match(state.stages.measurement.next, /Count records/);
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
    // Step E (owner decision 2026-10-25): the measured fact is reusable for
    // internal reports with no further human approval - no evidence, claim
    // or coverage review, no factual approval, no release decision.
    // -----------------------------------------------------------------------
    // Every persisted row that would mean a human approval, review, queue
    // resolution, limitation confirmation or release, for this organization.
    const approvalState = async () => (await query(`SELECT
        (SELECT count(*) FROM kai.evidence_review_decisions WHERE organization_id = $1::uuid)::int AS evidence_decisions,
        (SELECT count(*) FROM kai.claim_review_decisions WHERE organization_id = $1::uuid)::int AS claim_decisions,
        (SELECT count(*) FROM kai.coverage_review_decisions WHERE organization_id = $1::uuid)::int AS coverage_decisions,
        (SELECT count(*) FROM kai.client_followup_items WHERE organization_id = $1::uuid)::int AS client_followups,
        (SELECT count(*) FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'export_review')::int AS export_review_queues,
        (SELECT count(*) FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_status <> 'open'
           AND queue_type IN ('evidence_review', 'claim_review', 'generated_content_review'))::int AS resolved_review_queues,
        (SELECT count(*) FROM kai.upload_lifecycle_audit WHERE organization_id = $1::uuid AND operation LIKE 'generated_content_review_%')::int AS draft_reviews,
        (SELECT count(*) FROM kai.limitation_snapshots WHERE organization_id = $1::uuid)::int AS limitation_confirmations,
        (SELECT count(*) FROM kai.export_candidates WHERE organization_id = $1::uuid)::int AS release_candidates,
        (SELECT count(*) FROM kai.human_authority_decisions WHERE organization_id = $1::uuid)::int AS release_decisions,
        (SELECT count(*) FROM kai.export_manifests WHERE organization_id = $1::uuid)::int AS manifests`, [ORG_X]))[0];
    const NO_APPROVALS = Object.freeze({
      evidence_decisions: 0, claim_decisions: 0, coverage_decisions: 0, client_followups: 0, export_review_queues: 0, resolved_review_queues: 0,
      draft_reviews: 0, limitation_confirmations: 0, release_candidates: 0, release_decisions: 0, manifests: 0,
    });

    await test("Console canary: the measurement and claim pass and the claim is eligible for internal use automatically; after a page reload the re-pasted canary reconnects without repeating anything and waits only for the customer's generation", async () => {
      let summary = await canaryCall(adminPage, "KAI_CANARY.next()");
      let state = await expectCanary(adminPage, summary, { measurement: "PASS", internal_eligibility: "PASS", generation: "WAITING_FOR_HUMAN" });
      assert.deepEqual([state.ids.evidenceItemId, state.ids.claimId], [ids.evidenceItemId, ids.claimId]);
      assert.match(state.stages.internal_eligibility.observed, /eligible for internal use with no review step/);
      assert.match(state.stages.generation.next, /Generate internal evidence summary/);
      const runId = state.runId;
      await adminPage.goto("/impact-library");
      assert.equal(await adminPage.evaluate("typeof window.KAI_CANARY"), "undefined", "the reload cleared the page");
      const mark = adminPage.mark();
      await adminPage.evaluate(CANARY_SOURCE);
      const offline = await adminPage.evaluate("KAI_CANARY.status()");
      assert.deepEqual(offline.stages, summary.stages, "status() reads the saved run");
      summary = await canaryCall(adminPage, "KAI_CANARY.resume()");
      state = await expectCanary(adminPage, summary, { workspace: "PASS", measurement: "PASS", internal_eligibility: "PASS", generation: "WAITING_FOR_HUMAN" });
      assert.equal(state.runId, runId, "the same run, reconnected");
      assert.deepEqual(adminPage.requestsSince(mark).filter((r) => r.method !== "GET").map(pathOf), [], "re-paste and resume write nothing");
      const customerGk = await canaryCall(adminPage, `KAI_CANARY.gk({ organizationId: ${J(ORG_X)}, claimId: ${J(ids.claimId)} })`);
      assert.equal(customerGk.status, "BLOCKED", "the customer cannot read GK traceability");
      await gkReviewerPage.evaluate(CANARY_SOURCE);
      const gk = await canaryCall(gkReviewerPage, `KAI_CANARY.gk({ organizationId: ${J(ORG_X)}, claimId: ${J(ids.claimId)} })`);
      assert.deepEqual([gk.eligible, gk.blockerCodes], [true, []], J(gk));
      results.canary.reloadRecovery = "PASS: same run, no write";
      results.canary.internalEligibility = gk;
    });

    await test("E1: with zero human decisions the measured claim is usable impact evidence for internal use; Knowledge Studio shows the measurement as usable with no review action; funder and public stay closed", async () => {
      assert.deepEqual(await approvalState(), NO_APPROVALS, "no approval, review, queue resolution, follow-up or release exists");
      ids.approvalsBeforeReports = await approvalState();
      const traced = await gkReviewerPage.api("GET", claimTraceabilityPath(ORG_X, ids.claimId, "internal"));
      assert.deepEqual([traced.body.data.eligible, traced.body.data.blockerCodes], [true, []], J(traced.body.data.blockerCodes));
      assert.deepEqual([traced.body.data.evidence_review_decision, traced.body.data.claim_review_decision], [null, null], "no reviewer is implied");
      assert.deepEqual([traced.body.data.claim.claim_review_status, traced.body.data.claim.claim_strength, traced.body.data.evidence.support_strength],
        ["needs_gk_review", "unassessed", "unassessed"], "the stored review state is not rewritten");
      const carried = Object.entries(traced.body.data.dimensions).filter(([, value]) => value.assessment_status === "unresolved").map(([key]) => key).sort();
      assert.deepEqual(carried, ["conflicting_source_indicators", "requirement_alignment", "small_cell_risk"]);
      assert.ok(carried.every((key) => traced.body.data.dimensions[key].internal_limitation_accepted === false && traced.body.data.dimensions[key].blocks_requested_audience === false),
        "carried as limitations, never recorded as accepted");
      for (const audience of ["funder", "public"]) {
        const external = await gkReviewerPage.api("GET", claimTraceabilityPath(ORG_X, ids.claimId, audience));
        assert.equal(external.body.data.eligible, false, audience);
        for (const code of ["claim_not_approved_for_requested_audience", "evidence_review_unresolved", "coverage_dimension_unresolved"]) {
          assert.ok(external.body.data.blockerCodes.includes(code), `${audience}: ${code}`);
        }
      }
      // Usable impact evidence: the client-safe Impact Facts read lists it, with its limitations.
      const facts = await adminPage.api("GET", `${orgPath()}/impact-facts`);
      const fact = facts.body.data.items.find((item) => item.claimId === ids.claimId);
      assert.ok(fact, J(facts.body.data.items));
      assert.match(fact.statement, /^The promoted source records 5 programme sessions for the reporting period 2026-09-01 to 2026-09-30/);
      assert.deepEqual(fact.limitationDimensionKeys, carried);
      assert.ok(!facts.body.data.items.some((item) => /field_\d/.test(item.statement || "")), "no field-presence claim is offered as an impact fact");

      await openStudioTab("Data Sources");
      await adminPage.waitFor(async () => Boolean(await textOf(adminPage, `[data-client-open-measured-claim-review="${ids.claimId}"]`)), "the measurement action");
      assert.match(await textOf(adminPage, `[data-client-open-measured-claim-review="${ids.claimId}"]`), /View measurement/);
      await adminPage.clickIn(`[data-client-open-measured-claim-review="${ids.claimId}"]`, "View measurement");
      const panel = `[data-client-measured-claim-review="${ids.claimId}"]`;
      await adminPage.waitFor(async () => Boolean(await textOf(adminPage, "[data-client-measured-claim-eligibility]")), "the eligibility line");
      assert.match(await textOf(adminPage, "[data-client-measured-claim-review-measurement]"), /Measured: 5 programme sessions/);
      assert.match(await textOf(adminPage, "[data-client-measured-claim-no-review-required]"), /No evidence, claim or limitation review is required for internal use/);
      assert.equal(await adminPage.evaluate(`document.querySelector("[data-client-measured-claim-eligibility]").getAttribute("data-client-measured-claim-eligibility")`), "eligible");
      assert.match(await textOf(adminPage, "[data-client-measured-claim-eligibility]"), /Usable in internal reports now/);
      assert.equal(await textOf(adminPage, '[data-client-measured-claim-judgment="supported"]'), null, "no confirmation is offered");
      assert.doesNotMatch(await textOf(adminPage, panel), /Confirm: the count is supported/);
      assert.deepEqual(await approvalState(), NO_APPROVALS, "viewing writes nothing");
      results.e1 = { internal: "eligible with 0 human decisions", carriedLimitations: carried, funderPublic: "ineligible", impactFact: true };
    });

    await test("E1 boundaries: the administrator gets no Get Kinder authority and approves no external audience; other roles and organizations cannot use the measurement view", async () => {
      const reviewPath = organizationFactualReviewPath(ORG_X, ids.claimId);
      const outcomes = {};
      for (const [label, page] of [["client_contributor", contributorPage], ["client_reviewer", reviewerPage], ["inactive organization administrator", inactiveAdminPage],
        ["another organization's administrator", adminYPage]]) {
        outcomes[label] = (await page.api("GET", reviewPath)).status;
        assert.equal(outcomes[label], 403, label);
      }
      const claimQueue = await queueOf("claim_review", ids.claimId);
      const funderClaim = await adminPage.api("POST", claimReviewCompletePath(ORG_X, ids.claimId, claimQueue.review_queue_item_id), claimReviewDecisionBody({
        expectedUpdatedAt: new Date(claimQueue.updated_at).toISOString(), decision: "approved", approvedAudiences: ["internal", "funder"] }));
      assert.deepEqual([funderClaim.status, funderClaim.body.blockers?.map((b) => b.blocking_reason)], [403, ["audience_requires_get_kinder_review"]]);
      for (const audience of ["funder", "public"]) {
        assert.equal((await adminPage.api("POST", `${orgPath()}/claims/${ids.claimId}/coverage-dimensions/small_cell_risk/${audience}-acceptance`, {})).status, 403, audience);
      }
      assert.equal((await adminPage.api("GET", claimTraceabilityPath(ORG_X, ids.claimId, "funder"))).status, 403, "no GK traceability");
      assert.equal((await adminPage.api("GET", `${BASE_PATH}/admin/organizations/${ORG_X}/review-queue`)).status, 403, "no GK Review Queue");
      const capabilities = await adminPage.api("GET", `${orgPath()}/access-capabilities`);
      const operations = capabilities.body.data.workflowOperations;
      assert.deepEqual([operations.recordEvidenceReview, operations.recordClaimReview, operations.acceptCoverageLimitation], [false, false, false]);
      assert.deepEqual(await approvalState(), NO_APPROVALS, "refusals write nothing");
      results.e1Boundaries = outcomes;
    });

    await test("E2: the administrator generates the internal Evidence Summary in the UI; the generator receives the measured claim and its limitations; the draft is ready for internal use with no approval or release action", async () => {
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
      await adminPage.waitFor(async () => Boolean(await textOf(adminPage, `[data-client-open-internal-report="${ids.draftId}"]`)), "the internal report action");
      assert.match(await textOf(adminPage, "[data-client-internal-draft-detail-review-state]"), /Ready for internal use/);
      for (const selector of ["[data-client-factual-review-action]", "[data-client-factual-review-approve]", "[data-client-internal-release-action]",
        "[data-client-internal-release-submit]", "[data-client-internal-draft-release-state]", "[data-client-open-released-report]"]) {
        assert.equal(await textOf(adminPage, selector), null, `${selector} is not offered`);
      }
      assert.doesNotMatch(await textOf(adminPage, `[data-client-internal-draft-detail="${ids.draftId}"]`), /Approve factual content|Release internal report|awaiting your release|factual review is completed before/i);
      const { approvalsBeforeReports } = ids;
      assert.deepEqual(await approvalState(), approvalsBeforeReports, "generation records no approval");
      results.e2 = { modelCalls: modelCalls.length, generatedValue: ids.generatedValue, draft: [draft.draft_status, draft.review_status] };
    });

    await test("Console canary: the generated draft is validated for count, unit, period, citation and disclosures, and its internal report download is validated with no review or release stage; a loopback run is never a production pass", async () => {
      const summary = await canaryCall(adminPage, "KAI_CANARY.next()");
      const state = await expectCanary(adminPage, summary, { generation: "PASS", download_validation: "PASS" });
      assert.equal(state.ids.draftId, ids.draftId);
      assert.ok(Object.values(state.generation.checks).every(Boolean), J(state.generation));
      assert.ok(Object.values(state.validation.checks).every(Boolean), J(state.validation));
      assert.deepEqual(Object.keys(summary.stages), ["workspace", "fixture", "upload_processing", "sensitivity_source", "measurement", "internal_eligibility", "generation", "download_validation"],
        "no GK review, factual review or release stage");
      assert.match(summary.verdict, /^LOCAL_SIMULATION_ONLY/);
      assert.ok(!/END_TO_END_PASS/.test(summary.verdict));
      const report = await canaryCall(adminPage, "KAI_CANARY.report()");
      assert.deepEqual(new Set(Object.values(report.stages)), new Set(["PASS"]));
      // The internal report is not an export: the export flag does not gate it.
      process.env.KAI_PUBLIC_EXPORT_ENABLED = "false";
      try {
        const flagOff = await fetchText(adminPage, clientInternalReportMarkdownPath(ORG_X, PROJECT_X, ids.draftId));
        assert.equal(flagOff.status, 200, flagOff.body.slice(0, 300));
      } finally {
        process.env.KAI_PUBLIC_EXPORT_ENABLED = "true";
      }
      results.canary.final = { verdict: summary.verdict, markdownChecks: Object.keys(state.validation.checks).length, coverageCodes: state.validation.coverageCodes };
    });

    await test("E3: Report 1 - the administrator opens and downloads the complete internal Evidence Summary Markdown in the UI; nothing is approved, reviewed, confirmed or released", async () => {
      await adminPage.clickIn(`[data-client-internal-draft="${ids.draftId}"] button`, "Read draft");
      await adminPage.waitFor(async () => Boolean(await textOf(adminPage, `[data-client-open-internal-report="${ids.draftId}"]`)), "the report action");
      const mark = adminPage.mark();
      await adminPage.clickIn(`[data-client-open-internal-report="${ids.draftId}"]`, "Open report");
      await adminPage.waitFor(async () => Boolean(await textOf(adminPage, "[data-client-internal-report-markdown]")), "the report");
      await adminPage.idle();
      const requests = adminPage.requestsSince(mark);
      assert.deepEqual(requests.filter((r) => r.method !== "GET").map(pathOf), [], "opening the report writes nothing");
      assert.deepEqual(requests.filter((r) => r.url.includes("/markdown")).map((r) => [pathOf(r), r.status]), [[clientInternalReportMarkdownPath(ORG_X, PROJECT_X, ids.draftId), 200]]);
      const shown = await textOf(adminPage, "[data-client-internal-report-markdown]");
      const download = await adminPage.evaluate(`document.querySelector("[data-client-download-internal-report]").getAttribute("href")`);
      assert.equal(download, clientInternalReportMarkdownPath(ORG_X, PROJECT_X, ids.draftId));
      const fetched = await fetchText(adminPage, download);
      assert.deepEqual([fetched.status, fetched.body], [200, shown], "the download is the report shown");
      assert.match(fetched.disposition, /attachment; filename="kai-internal-evidence-summary\.md"/);
      assertCompleteReport(shown, "# Internal Evidence Summary");
      ids.markdownValue = Number((/records \*\*(\d+) programme sessions\*\*/.exec(shown) || [])[1]);
      ids.reportMarkdown = { evidenceSummary: shown };
      writeFileSync(join(WORKDIR, "report-1-internal-evidence-summary.md"), shown);
      console.log(`[internal-report:evidence_summary:begin]\n${shown}[internal-report:end]`);
      assert.deepEqual(await approvalState(), ids.approvalsBeforeReports, "report 1: zero new approvals of any kind");
      results.e3 = { status: 200, bytes: Buffer.byteLength(shown), value: ids.markdownValue };
    });

    await test("E4: Report 2 - an internal impact narrative from the same claim reuses the same factual authority; it is generated, opened and downloaded with no second approval", async () => {
      await openStudioTab("Data Sources");
      await adminPage.waitFor(async () => Boolean(await textOf(adminPage, `[data-client-claim="${ids.claimId}"]`)), "the measured claim");
      await adminPage.clickIn(`[data-client-claim="${ids.claimId}"] input[type=checkbox]`, "Use in an internal draft");
      await adminPage.clickButton("Generate internal impact narrative");
      await adminPage.waitForText("Internal impact narrative created");
      await adminPage.idle();
      assert.equal(modelCalls.length, 2);
      const [narrative] = await query("SELECT generated_content_draft_id::text, review_status FROM kai.generated_content_drafts WHERE organization_id = $1::uuid AND content_type = 'impact_narrative'", [ORG_X]);
      ids.narrativeId = narrative.generated_content_draft_id;
      await adminPage.waitFor(async () => Boolean(await textOf(adminPage, `[data-client-open-internal-report="${ids.narrativeId}"]`)), "the narrative's report action");
      assert.equal(await textOf(adminPage, "[data-client-factual-review-action]"), null);
      await adminPage.clickIn(`[data-client-open-internal-report="${ids.narrativeId}"]`, "Open report");
      await adminPage.waitFor(async () => /^# Internal Impact Narrative/.test((await textOf(adminPage, "[data-client-internal-report-markdown]")) || ""), "the narrative report");
      const shown = await textOf(adminPage, "[data-client-internal-report-markdown]");
      const fetched = await fetchText(adminPage, clientInternalReportMarkdownPath(ORG_X, PROJECT_X, ids.narrativeId));
      assert.deepEqual([fetched.status, fetched.body], [200, shown]);
      assert.match(fetched.disposition, /attachment; filename="kai-internal-impact-narrative\.md"/);
      assertCompleteReport(shown, "# Internal Impact Narrative");
      ids.reportMarkdown.impactNarrative = shown;
      writeFileSync(join(WORKDIR, "report-2-internal-impact-narrative.md"), shown);
      console.log(`[internal-report:impact_narrative:begin]\n${shown}[internal-report:end]`);
      const after = await approvalState();
      assert.deepEqual(after, ids.approvalsBeforeReports, "report 2: zero new approvals of any kind");
      const [drafts] = await query("SELECT count(*)::int AS n FROM kai.generated_content_drafts WHERE organization_id = $1::uuid", [ORG_X]);
      results.e4 = {
        successfulInternalReports: drafts.n,
        completeMarkdownArtifacts: Object.keys(ids.reportMarkdown).length,
        newHumanApprovalDecisions: after.evidence_decisions + after.claim_decisions + after.coverage_decisions + after.draft_reviews,
        newMandatoryApprovalQueueItems: after.export_review_queues + after.client_followups + after.resolved_review_queues,
        newHumanReleaseDecisions: after.release_decisions,
        manualAcknowledgmentSteps: after.limitation_confirmations,
      };
      assert.deepEqual(results.e4, { successfulInternalReports: 2, completeMarkdownArtifacts: 2, newHumanApprovalDecisions: 0, newMandatoryApprovalQueueItems: 0, newHumanReleaseDecisions: 0, manualAcknowledgmentSteps: 0 });
    });

    await test("F boundaries: other roles, organizations, Projects and non-human actors are refused; an unsupported metric or causal assertion is never persisted; a stale source, a sensitive source and revoked permission make the report unavailable; funder and public disclosure stay Get Kinder's", async () => {
      const path = clientInternalReportMarkdownPath(ORG_X, PROJECT_X, ids.draftId);
      const outcomes = {};
      for (const [label, page, target, status] of [
        ["client_contributor", contributorPage, path, 403],
        ["client_reviewer", reviewerPage, path, 403],
        ["inactive organization administrator", inactiveAdminPage, path, 403],
        ["GK reviewer on the customer route", gkReviewerPage, path, 403],
        ["another organization's administrator", adminYPage, path, 403],
        ["another organization's path", adminPage, clientInternalReportMarkdownPath(ORG_Y, PROJECT_Y, ids.draftId), 403],
        ["another Project of the organization", adminPage, clientInternalReportMarkdownPath(ORG_X, PROJECT_X2, ids.draftId), 404],
      ]) {
        const response = await fetchText(page, target);
        assert.equal(response.status, status, `${label}: ${response.body.slice(0, 300)}`);
        assert.doesNotMatch(response.body, /programme sessions/, label);
        outcomes[label] = response.status;
      }
      const { getClientInternalReportMarkdown, approveClientInternalDraftFactualReview, releaseClientInternalReport } = await import("../Backend/kai/services/kaiClientGeneratedContentService.js");
      const scope = { organizationId: ORG_X, engagementId: PROJECT_X, generatedContentDraftId: ids.draftId };
      for (const actorType of ["ai", "assistant", "system"]) {
        const actorContext = { actorType, actorUserId: ids.adminUserId, organizationMemberships: [{ organization_id: ORG_X, role_name: "client_admin", membership_status: "active" }] };
        const read = await getClientInternalReportMarkdown({ ...scope, actorContext });
        const approve = await approveClientInternalDraftFactualReview({ ...scope, decision: "approved", actorContext }, { createReviewAudit: () => ({}) });
        const release = await releaseClientInternalReport({ ...scope, decision: "release_for_internal_use", limitationsConfirmed: true, actorContext }, { createReleaseAudit: () => ({}) });
        assert.deepEqual([read.error?.code, approve.error?.code, release.error?.code], ["authorization_denied", "authorization_denied", "authorization_denied"], actorType);
        outcomes[`${actorType} read/approve/release`] = "authorization_denied";
      }

      // Unsupported or fabricated content: VAL-GEN-004 refuses it before anything is persisted.
      const draftsBefore = (await query("SELECT count(*)::int AS n FROM kai.generated_content_drafts WHERE organization_id = $1::uuid", [ORG_X]))[0].n;
      for (const [label, text] of [
        ["fabricated metric", "The promoted source records 12 programme sessions for the reporting period 2026-09-01 to 2026-09-30, reaching 40 participants."],
        ["causal outcome", COMPLIANT_TEXT.replace("This is a count", "The programme improves literacy because of these sessions. This is a count")],
      ]) {
        modelOverride.text = text;
        try {
          const refused = await adminPage.api("POST", `${orgPath()}/generated-content-drafts/evidence-summary`,
            { claim_ids: [ids.claimId], idempotency_key: `refused-${label.replace(/\W+/g, "-")}`, engagement_id: PROJECT_X });
          assert.equal(refused.status, 422, `${label}: ${JSON.stringify(refused.body)}`);
          assert.ok(refused.body.blockers.some((b) => b.validator_key === "VAL-GEN-004" && b.blocking_reason === "unsupported_numeric_or_causal_assertion"), J(refused.body.blockers));
          outcomes[label] = "VAL-GEN-004 422";
        } finally {
          modelOverride.text = null;
        }
      }
      assert.equal((await query("SELECT count(*)::int AS n FROM kai.generated_content_drafts WHERE organization_id = $1::uuid", [ORG_X]))[0].n, draftsBefore, "nothing persisted");

      // Funder and public disclosure keep their own authority: the customer cannot generate a funder summary or start any GK export step.
      const funder = await adminPage.api("POST", `${orgPath()}/generated-content-drafts/evidence-summary/funder`,
        { claim_ids: [ids.claimId], idempotency_key: "refused-funder", engagement_id: PROJECT_X });
      assert.ok([403, 422].includes(funder.status), `funder generation: ${funder.status} ${JSON.stringify(funder.body)}`);
      const draftPath = `${orgPath()}/generated-content-drafts/${ids.draftId}`;
      for (const audience of ["internal", "funder", "public"]) {
        assert.equal((await adminPage.api("POST", `${draftPath}/export-review-request`, { requested_export_audience: audience })).status, 403, audience);
      }
      outcomes.funderGeneration = funder.status;

      // INJECTED STATE (labeled): no application operation supersedes a source version.
      await query("UPDATE kai.source_versions SET is_current = false WHERE source_version_id = $1::uuid", [ids.sourceVersionId]);
      try {
        const stale = await fetchText(adminPage, path);
        assert.equal(stale.status, 409, stale.body);
        assert.doesNotMatch(stale.body, /programme sessions/);
        outcomes.stale = stale.status;
      } finally {
        await query("UPDATE kai.source_versions SET is_current = true WHERE source_version_id = $1::uuid", [ids.sourceVersionId]);
      }

      // Sensitive content and revoked permission: the administrator's own corrective sensitivity review.
      const recordSensitivity = async (overrides) => {
        const detail = projectSensitivityDetail((await adminPage.api("GET", sensitivityProfilePath(ORG_X, ids.sensitivityProfileId))).body.data);
        const formState = { ...sensitivityReviewFormStateFromDecision(detail.currentDecision), reviewed_llm_processing_allowed: true, ...overrides };
        const response = await adminPage.api("POST", sensitivityDecisionPath(ORG_X, ids.sensitivityProfileId), buildSensitivityDecisionRequestBody({
          decision: "reviewed", expectedUpdatedAt: detail.reviewQueueItem.updated_at, reviewQueueItemId: detail.reviewQueueItem.review_queue_item_id, formState }));
        assert.equal(response.status, 200, JSON.stringify(response.body));
      };
      const internalEligibility = async () => {
        const traced = await gkReviewerPage.api("GET", claimTraceabilityPath(ORG_X, ids.claimId, "internal"));
        return [traced.body.data.eligible, traced.body.data.blockerCodes];
      };
      await recordSensitivity({ reviewed_minor_data_status: "present" });
      try {
        assert.equal((await internalEligibility())[0], false, "a sensitive source is not ordinary");
        const sensitive = await fetchText(adminPage, path);
        assert.equal(sensitive.status, 422, sensitive.body);
        assert.deepEqual(JSON.parse(sensitive.body).blockers.map((b) => b.blocking_reason), ["minor_information_not_cleared", "cited_claims_not_currently_eligible"]);
        outcomes.sensitive = sensitive.status;
      } finally {
        await recordSensitivity({ reviewed_minor_data_status: "absent" });
      }
      await recordSensitivity({ reviewed_llm_processing_allowed: false });
      try {
        const revoked = await fetchText(adminPage, path);
        assert.ok([409, 422].includes(revoked.status), `${revoked.status} ${revoked.body}`);
        assert.doesNotMatch(revoked.body, /programme sessions/);
        outcomes.revokedPermission = revoked.status;
      } finally {
        await recordSensitivity({ reviewed_llm_processing_allowed: true });
      }
      assert.deepEqual(await internalEligibility(), [true, []], "the ordinary decision restored");
      assert.equal((await fetchText(adminPage, path)).status, 200);
      results.fBoundaries = outcomes;
    });

    await test("Governance after the journey: a recorded human decision still governs - a negative review makes the claim ineligible, and Get Kinder's decision supersedes the organization's, which cannot override it", async () => {
      const reviewPath = organizationFactualReviewPath(ORG_X, ids.claimId);
      const reviewNow = async () => (await adminPage.api("GET", reviewPath)).body.data;
      const claimDecision = async (decision, page = adminPage) => {
        const queue = await queueOf("claim_review", ids.claimId);
        return page.api("POST", claimReviewCompletePath(ORG_X, ids.claimId, queue.review_queue_item_id),
          claimReviewDecisionBody({ expectedUpdatedAt: new Date(queue.updated_at).toISOString(), decision, approvedAudiences: decision === "approved" ? ["internal"] : undefined }));
      };
      const evidenceDecision = async (decision, page) => {
        const queue = await queueOf("evidence_review", ids.evidenceItemId);
        return page.api("POST", evidenceReviewCompletePath(ORG_X, ids.evidenceItemId, queue.review_queue_item_id),
          evidenceReviewDecisionBody({ expectedUpdatedAt: new Date(queue.updated_at).toISOString(), decision }));
      };
      const internalEligibility = async () => {
        const traced = await gkReviewerPage.api("GET", claimTraceabilityPath(ORG_X, ids.claimId, "internal"));
        return [traced.body.data.eligible, traced.body.data.blockerCodes];
      };
      const outcomes = {};
      // Reporting a problem: the administrator's own "not supported".
      const notSupported = await evidenceDecision("not_supported", adminPage);
      assert.equal(notSupported.status, 200, JSON.stringify(notSupported.body));
      const [ineligible, codes] = await internalEligibility();
      assert.equal(ineligible, false);
      assert.ok(codes.includes("support_strength_unassessed"), codes.join(","));
      const refused = await fetchText(adminPage, clientInternalReportMarkdownPath(ORG_X, PROJECT_X, ids.draftId));
      assert.equal(refused.status, 422);
      outcomes.notSupported = "claim ineligible; report 422";
      // The administrator corrects it; the recorded decisions govern again.
      assert.equal((await evidenceDecision("supported", adminPage)).status, 200);
      assert.equal((await claimDecision("rejected")).status, 200);
      assert.equal((await internalEligibility())[0], false, "a rejected claim is not eligible");
      assert.equal((await claimDecision("approved")).status, 200);
      assert.deepEqual(await internalEligibility(), [true, []]);
      // Get Kinder supersedes the organization's evidence decision; the organization cannot override it.
      const gkDecision = await evidenceDecision("needs_more_information", gkReviewerPage);
      assert.equal(gkDecision.status, 200, JSON.stringify(gkDecision.body));
      assert.equal((await internalEligibility())[0], false);
      const override = await evidenceDecision("supported", adminPage);
      assert.deepEqual([override.status, override.body.blockers?.map((b) => b.blocking_reason)], [422, ["get_kinder_decision_recorded"]]);
      const view = await reviewNow();
      assert.deepEqual([view.evidence_review.decided_by, view.evidence_review.organization_may_decide], ["get_kinder", false]);
      outcomes.gkSupersedes = "gk_reviewer superseded the organization's evidence decision; the organization's override was refused";
      results.governance = outcomes;
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
        internalReportMarkdown: ids.markdownValue,
        secondReportMarkdown: Number((/records \*\*(\d+) programme sessions\*\*/.exec(ids.reportMarkdown.impactNarrative) || [])[1]),
      };
      assert.deepEqual(new Set(Object.values(chain)), new Set([5]), JSON.stringify(chain));
      results.byteToReport = { ...chain, checksum: independent.checksum, profileCounts: ids.profileCounts };
      // The administrator acted only as itself in X, and never as GK.
      const adminRoles = await query("SELECT role_id FROM kai.user_roles WHERE user_id = $1::uuid", [ids.adminUserId]);
      assert.deepEqual(adminRoles, [], "no global role for the customer");
      const humanActors = await query(
        `SELECT DISTINCT a.actor_user_id::text, u.legacy_public_userdata_id FROM kai.audit_events a JOIN kai.users u ON u.user_id = a.actor_user_id
          WHERE a.organization_id = $1::uuid AND a.actor_type::text = 'human' ORDER BY u.legacy_public_userdata_id`, [ORG_X]);
      assert.deepEqual(humanActors.map((row) => row.legacy_public_userdata_id).sort(), [USERS.gkReviewer, USERS.clientAdmin].sort());
      // What Get Kinder did: only the governance test after the journey,
      // superseding the organization's evidence decision (gk_reviewer). No
      // evidence, claim, coverage, draft review or release decision was made
      // by anyone before both reports were retrieved (E1-E4).
      const gkActions = await query(
        `SELECT DISTINCT a.action, u.legacy_public_userdata_id FROM kai.audit_events a JOIN kai.users u ON u.user_id = a.actor_user_id
          WHERE a.organization_id = $1::uuid AND u.legacy_public_userdata_id = ANY($2::int[]) ORDER BY 2, 1`, [ORG_X, [USERS.gkReviewer, USERS.gkAdmin]]);
      results.gkActions = gkActions.map((row) => `${row.legacy_public_userdata_id === USERS.gkAdmin ? "gk_admin" : "gk_reviewer"}:${row.action}`);
      for (const action of ["generated_content_review_started", "generated_content_review_completed", "export_review_requested", "export_review_started",
        "export_review_completed", "limitation_snapshot_confirmed", "export_candidate_created", "human_authority_decision_recorded", "export_manifest_created"]) {
        assert.ok(!gkActions.some((row) => row.action === action), `no GK ${action}`);
      }
      const [releaseRows] = await query(`SELECT (SELECT count(*) FROM kai.human_authority_decisions WHERE organization_id = $1::uuid)::int AS decisions,
        (SELECT count(*) FROM kai.export_manifests WHERE organization_id = $1::uuid)::int AS manifests,
        (SELECT count(*) FROM kai.limitation_snapshots WHERE organization_id = $1::uuid)::int AS snapshots`, [ORG_X]);
      assert.deepEqual(releaseRows, { decisions: 0, manifests: 0, snapshots: 0 }, "no release, manifest or limitation confirmation exists at all");
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
