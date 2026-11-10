import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";

/**
 * Owner Package 3 (2026-11-10): governed measurement-to-draft usability on
 * synthetic Community Impact Project B, on the Cedar Bridge runner's
 * disposable loopback PostgreSQL. Run only by
 *   KAI_COMMUNITY_PROJECT_B_PACKAGE=<package root> KAI_PROJECT_B_PROVISIONAL_DRAFT=true \
 *     node scripts/kai-cedar-bridge-six-source-acceptance-local-postgres.js
 * after `npm run build`. Skipped otherwise.
 *
 * Package 2's acceptance (kai-community-project-b-cross-source-acceptance)
 * remains the independent counting proof of 190 contacts / 67 people; this
 * spec proves the customer use of those persisted findings and the
 * permission decisions around it.
 *
 * Real: the intake API, P1 worker and profiler, the human sensitivity /
 * allowed-use decision and re-decision (Review Cockpit review-work +
 * decision), promotion and successor promotion, Count records, the
 * cross-source request, reconciliation job and worker, persisted derived
 * measurements, the interpretation and claim-proposal routes, P2-06, the
 * organization diagnostic with its provisional draft admission, the client
 * generation route with the real generator, validators, disclosures and
 * persistence, the client draft list / detail / internal Markdown reads, the
 * organization factual-review and release routes, Get Kinder's review routes,
 * the built Knowledge Studio bundle in headless Chrome, and (for scenario D)
 * the previous application revision's own record-count route.
 * Simulated at external boundaries only: the session (harness cookie),
 * object storage (in-process signed PUT), the malware scanner (clean adapter
 * behind the real assessor) and the model provider (patched SDK
 * Messages.create, deterministic). The deterministic provider proves only
 * what the server sent and that the server's validators and persistence
 * accept or refuse a response; it is not evidence of model quality.
 *
 * Fixture setup through the API (not the customer journey): organizations,
 * actors, the Project and its reporting period, upload / decision /
 * promotion of the two files, and the 217-record Count records. Through the
 * browser: Sources -> Count records -> Link to a participant register, the
 * stated meanings and claim proposals, claim selection in Evidence,
 * generation in Drafts, and opening the saved draft and its report.
 */

const RUNNER_DATABASE_URL = process.env.KAI_CEDAR_ACCEPTANCE_DATABASE_URL;
const RUNNER_DATABASE_NAME = process.env.KAI_CEDAR_ACCEPTANCE_DATABASE_NAME;
const PACKAGE = process.env.KAI_COMMUNITY_PROJECT_B_PACKAGE;
const ENABLED = process.env.KAI_PROJECT_B_PROVISIONAL_DRAFT === "true";
const CHROME = process.env.KAI_P3_CHROME;
const WORKDIR = process.env.KAI_P3_WORKDIR;
const LEGACY_CHECKOUT = process.env.KAI_P3_LEGACY_CHECKOUT;
const LEGACY_REVISION = process.env.KAI_P3_LEGACY_REVISION;
const REPORT_PATH = process.env.KAI_CEDAR_BRIDGE_REPORT;

// Owner-supplied Project B expectations (Package 2/3 prompts). Package 2's
// spec recomputes them independently from the bytes; here they are only the
// values the persisted measurements must still carry.
const EXPECTED = Object.freeze({ raw: 217, deduplicated: 215, completed: 197, in_period: 192, eligible: 190, people: 67, cc: [105, 42], ra: [85, 36], both: 11 });
const CORRECTED = Object.freeze({ eligible: 188, people: 66 });
const PERIOD = Object.freeze({ start: "2024-04-01", end: "2025-03-31" });
const RAW_IDENTIFIER = /\bCE\d{4}\b|\bCBR\d{3}\b/;

function assertLoopbackDatabaseUrl(urlString) {
  const host = new URL(urlString).hostname.toLowerCase();
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw new Error(`Package 3 acceptance refused a non-loopback database URL host: ${host}`);
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("Package 3 acceptance isolation: a non-loopback runner URL is refused", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
});

if (!ENABLED || !RUNNER_DATABASE_URL || !PACKAGE || !CHROME || !WORKDIR || !LEGACY_CHECKOUT || !existsSync(join(PACKAGE, "01_UPLOAD_TO_KAI"))) {
  test("Package 3 provisional-draft acceptance requires its runner mode (KAI_PROJECT_B_PROVISIONAL_DRAFT) and KAI_COMMUNITY_PROJECT_B_PACKAGE", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_DATABASE_URL);
  await runPackage3Acceptance();
}

// ---------------------------------------------------------------------------
// Minimal Chrome DevTools protocol client (the shape of the other Knowledge
// Studio acceptances). Controls are found and activated only while visible
// and enabled; a mounted view or disclosure is revealed only by clicking its
// own visible tab or toggle.
// ---------------------------------------------------------------------------

async function launchChrome() {
  const profileDir = join(WORKDIR, "chrome-profile-package-3");
  mkdirSync(profileDir, { recursive: true });
  const child = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profileDir}`, "--no-first-run",
    "--no-default-browser-check", "--disable-gpu", "--disable-extensions", "--disable-background-networking", "about:blank"], { stdio: "ignore" });
  const portFile = join(profileDir, "DevToolsActivePort");
  for (let attempt = 0; attempt < 100 && !existsSync(portFile); attempt += 1) await new Promise((r) => setTimeout(r, 100));
  const [port] = readFileSync(portFile, "utf8").split("\n");
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
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
      try { await send("Browser.close"); } catch { /* closing */ }
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
    if (method === "Network.requestWillBeSent" && params.type !== "Document" && /\/api\/|\/js\/bundles\//.test(params.request.url)) {
      const entry = { url: params.request.url, method: params.request.method, status: null, done: false, requestId: params.requestId, postData: params.request.postData ?? null };
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
    if (result.exceptionDetails) throw new Error(`evaluate failed: ${result.exceptionDetails.text} ${expression.slice(0, 160)}`);
    return result.result.value;
  };
  const text = () => evaluate("document.body ? document.body.innerText : ''");
  const idle = async () => {
    let quietSince = Date.now();
    for (let i = 0; i < 600; i += 1) {
      await new Promise((r) => setTimeout(r, 50));
      if (requests.some((request) => !request.done)) quietSince = Date.now();
      else if (Date.now() - quietSince > 500) return;
    }
    throw new Error("network never went idle");
  };
  const waitFor = async (predicate, description, { timeout = 20000 } = {}) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`timed out waiting for ${description}\n--- page ---\n${(await text()).slice(0, 4000)}`);
  };
  // Reveal an element by clicking the visible tab of the mounted view, or the
  // visible toggle of the disclosure list, that holds it (as a person would).
  const REVEAL = `function reveal(el) {
    for (let node = el; node && node !== document.body; node = node.parentElement) {
      if (!node.hidden) continue;
      if (node.dataset.knowledgeStudioView) document.querySelector('[data-knowledge-studio-tab="' + node.dataset.knowledgeStudioView + '"]')?.click();
      else if (node.dataset.knowledgeStudioReveal) document.querySelector('[data-knowledge-studio-reveal-toggle="' + node.dataset.knowledgeStudioReveal + '"]')?.click();
    }
  }`;
  const visible = (selector) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return Boolean(el && el.offsetParent !== null); })()`);
  const clickVisible = async (selector, description) => {
    await evaluate(`(() => { ${REVEAL} const el = document.querySelector(${JSON.stringify(selector)}); if (el && el.offsetParent === null) reveal(el); return true; })()`);
    await waitFor(() => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return Boolean(el && el.offsetParent !== null && !el.disabled); })()`), description, { timeout: 30000 });
    const clicked = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el || el.offsetParent === null || el.disabled) return false; el.click(); return true; })()`);
    if (!clicked) throw new Error(`no visible enabled control: ${description}`);
  };
  const clickButton = async (label) => {
    await waitFor(() => evaluate(`[...document.querySelectorAll("button")].some((el) => el.offsetParent !== null && !el.disabled && el.innerText.trim() === ${JSON.stringify(label)})`), `button ${label}`);
    const clicked = await evaluate(`(() => { const el = [...document.querySelectorAll("button")].find((b) => b.offsetParent !== null && !b.disabled && b.innerText.trim() === ${JSON.stringify(label)}); if (!el) return false; el.click(); return true; })()`);
    if (!clicked) throw new Error(`no visible enabled button: ${label}`);
  };
  const clickNav = async (label) => {
    await waitFor(() => evaluate(`[...document.querySelectorAll("[role=button], a, button")].some((el) => el.offsetParent !== null && el.innerText.trim() === ${JSON.stringify(label)})`), `nav ${label}`);
    await evaluate(`[...document.querySelectorAll("[role=button], a, button")].find((el) => el.offsetParent !== null && el.innerText.trim() === ${JSON.stringify(label)}).click()`);
  };
  const clickTab = async (label) => {
    await waitFor(() => evaluate(`[...document.querySelectorAll(".nav-tabs button")].some((el) => el.offsetParent !== null && el.innerText.trim() === ${JSON.stringify(label)})`), `tab ${label}`);
    await evaluate(`[...document.querySelectorAll(".nav-tabs button")].find((el) => el.offsetParent !== null && el.innerText.trim() === ${JSON.stringify(label)}).click()`);
  };
  // A person's choice in a visible <select> (the option must be listed).
  const choose = (selector, value) => evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el || el.offsetParent === null || el.disabled || ![...el.options].some((option) => option.value === ${JSON.stringify(value)})) return false;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  // A person's typing in a visible input.
  const type = (selector, value) => evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el || el.offsetParent === null || el.disabled) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  const textOf = (selector) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? el.innerText : null; })()`);
  const attrOf = (selector, name) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? el.getAttribute(${JSON.stringify(name)}) : null; })()`);
  const responseBody = async (entry) => {
    const { body, base64Encoded } = await browser.send("Network.getResponseBody", { requestId: entry.requestId }, sessionId);
    const raw = base64Encoded ? Buffer.from(body, "base64").toString("utf8") : body;
    try { return JSON.parse(raw); } catch { return raw; }
  };
  // Same-origin JSON request from the signed-in page, exactly as the bundle makes it.
  const api = (method, path, body) => evaluate(`(async () => {
    const response = await fetch(${JSON.stringify(path)}, { method: ${JSON.stringify(method)}, credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" }, ${body === undefined ? "" : `body: ${JSON.stringify(JSON.stringify(body))},`} });
    return { status: response.status, body: await response.json() };
  })()`);
  return {
    requests: () => requests.slice(), mark: () => requests.length, requestsSince: (mark) => requests.slice(mark), exceptions,
    evaluate, text, idle, waitFor, visible, clickVisible, clickButton, clickNav, clickTab, choose, type, textOf, attrOf, responseBody, api,
    async selectProject(engagementId) { assert.ok(await choose("#gk-shell-project-select", engagementId), "the Project selector lists the Project"); },
    async goto(path) { await browser.send("Page.navigate", { url: `${baseUrl}${path}` }, sessionId); await idle(); },
    async close() { browser.listeners.delete(listener); await browser.send("Target.closeTarget", { targetId }); },
  };
}

// ---------------------------------------------------------------------------
// Acceptance
// ---------------------------------------------------------------------------

async function runPackage3Acceptance() {
  const J = JSON.stringify;
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-unused-dummy-key";
  process.env.KAI_PUBLIC_EXPORT_ENABLED = "true";
  // The external model boundary: deterministic, and every request recorded
  // exactly as serialized. The response restates each claim the server sent
  // and also asserts "approved" / "released", which the server must ignore.
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const messagesPrototype = Object.getPrototypeOf(new Anthropic({ apiKey: "sk-ant-test-unused-dummy-key" }).messages);
  const modelCalls = [];
  messagesPrototype.create = async function deterministicCreate(payload) {
    const requestBody = JSON.parse(payload.messages[0].content);
    modelCalls.push({ claims: requestBody.claims, requestedAudience: requestBody.requestedAudience ?? null, serialized: J(payload) });
    return { content: [{ type: "text", text: J({ approved: true, draftStatus: "released",
      blocks: requestBody.claims.map((claim) => ({ text: claim.claimStatement, citations: [{ claimId: claim.claimId, evidenceItemId: claim.evidenceItemId }] })) }) }] };
  };

  const { Pool } = await import("pg");
  const express = (await import("express")).default;
  const ambientPool = (await import("../Backend/db/pg.js")).default;
  const seedPool = new Pool({ connectionString: RUNNER_DATABASE_URL, ssl: false, max: 4 });
  const query = async (sql, params = []) => (await seedPool.query(sql, params)).rows;
  const { findOrCreateKaiUserByLegacyPublicUserdataId } = await import("../Backend/kai/db/kaiQueries.js");
  const intakeQueries = await import("../Backend/kai/db/kaiIntakeQueries.js");
  const { evaluateMeasuredClaimIntegrityInTransaction } = await import("../Backend/kai/dictionary/postgresOrdinaryInternalFactAuthority.js");
  const {
    BASE_PATH, claimProposalPath, claimReviewCompletePath, claimReviewDecisionBody, claimTraceabilityPath, clientInternalDraftFactualReviewPath,
    clientInternalDraftPath, clientInternalDraftReleasePath, clientInternalDraftsPath, clientInternalReportMarkdownPath, coverageInternalAcceptancePath,
    createEvidenceSummaryPath, createFunderEvidenceSummaryPath, evidenceReviewCompletePath, evidenceReviewDecisionBody, sourceCandidateDecisionPath,
  } = await import("../frontend/impactEvidenceLibraryLogic.js");
  // Namespace import, so the same spec can also record the behaviour of a
  // revision without the Package 3 helpers ("unavailable").
  const workflowLogic = await import("../frontend/knowledgeStudio/clientEvidenceWorkflowLogic.js");
  const { claimUseDiagnosis } = workflowLogic;
  const claimDraftAdmission = workflowLogic.claimDraftAdmission || (() => "unavailable");
  const provisionalDraftRefusalMessage = workflowLogic.provisionalDraftRefusalMessage || (() => null);
  const { confirmUploadPath, createBatchPath, fileReservationsPath, requestUploadUrlPath } = await import("../frontend/kaiWebIntakeLogic.js");
  const { sourceRecordCountMeasurementPath } = await import("../frontend/knowledgeStudio/clientSourceMeasurementLogic.js");
  const {
    crossSourceMeasurementsPath, crossSourceReconciliationJobPath, derivedMeasurementBasisPath, derivedMeasurementInterpretationPath,
  } = await import("../frontend/knowledgeStudio/clientDerivedMeasurementLogic.js");
  const router = (await import("../Backend/kai/routes/sprint2IntakeApi.js")).default;
  const config = await import("../Backend/kai/config/kaiSprint2Config.js");
  const auth = await import("../Backend/kai/middleware/kaiSprint2Authentication.js");
  const runtimeService = await import("../Backend/kai/services/kaiIntakeRuntimeService.js");
  const upload = await import("../Backend/kai/upload/postgresUploadLifecycleRepository.js");
  const executor = await import("../Backend/kai/security/internalSecurityAssessmentExecutor.js");
  const assessor = await import("../Backend/kai/security/boundedFileSecurityAssessor.js");
  const dispatch = await import("../Backend/kai/parsing/p1FileDispatch.js");
  const reconciliationRuntime = await import("../Backend/kai/parsing/crossSourceReconciliationJobRuntime.js");
  // The previous revision (before Package 1), loaded only for its own record-count route.
  const legacy = {
    router: (await import(join(LEGACY_CHECKOUT, "Backend/kai/routes/sprint2IntakeApi.js"))).default,
    config: await import(join(LEGACY_CHECKOUT, "Backend/kai/config/kaiSprint2Config.js")),
    auth: await import(join(LEGACY_CHECKOUT, "Backend/kai/middleware/kaiSprint2Authentication.js")),
    pool: (await import(join(LEGACY_CHECKOUT, "Backend/db/pg.js"))).default,
  };

  const ambientTarget = (await ambientPool.query("SELECT current_database() AS database_name, inet_server_addr()::text AS server_addr")).rows[0];
  assert.equal(ambientTarget.database_name, RUNNER_DATABASE_NAME);
  assert.ok(["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(ambientTarget.server_addr));

  // --- the two original upload files ----------------------------------------
  const UPLOAD_DIR = join(PACKAGE, "01_UPLOAD_TO_KAI");
  const fileOf = (key, name, bytes = readFileSync(join(UPLOAD_DIR, name))) => ({ key, name, extension: ".csv", mime: "text/csv", bytes, checksum: sha256(bytes) });
  const roster = fileOf("roster", "02_Community_Participant_Roster.csv");
  const events = fileOf("events", "03_Community_Service_Log.csv");
  // A corrected roster without one participant served in both programmes
  // (chosen from the roster and the service log by the first sorted id that
  // appears under both programme codes; the same construction as Package 2).
  const correctedRoster = (() => {
    const lines = events.bytes.toString("utf8").replace(/^﻿/, "").split(/\r?\n/).filter(Boolean).slice(1).map((line) => line.split(","));
    const programmes = new Map();
    for (const row of lines) if (row[5] === "completed" && row[3] >= PERIOD.start && row[3] <= PERIOD.end) programmes.set(row[1], new Set([...(programmes.get(row[1]) || []), row[2]]));
    const rosterIds = new Set(roster.bytes.toString("utf8").replace(/^﻿/, "").split(/\r?\n/).slice(1).map((line) => line.split(",")[0]));
    const [removed] = [...programmes].filter(([id, set]) => set.size === 2 && rosterIds.has(id)).map(([id]) => id).sort();
    const kept = roster.bytes.toString("utf8").split(/(?<=\n)/).filter((line, index) => index === 0 || !line.replace(/^﻿/, "").startsWith(`${removed},`));
    return fileOf("roster-corrected", "02_Community_Participant_Roster_corrected.csv", Buffer.from(kept.join(""), "utf8"));
  })();

  // Pseudonymous participant-level files: personal information present (the
  // truthful synthetic classification); allowed for internal use and AI processing.
  const PARTICIPANT_LEVEL = Object.freeze({
    reviewed_personal_data_status: "present", reviewed_minor_data_status: "absent", reviewed_health_housing_justice_immigration_status: "absent",
    reviewed_indigenous_governance_status: "absent", reviewed_staff_notes_status: "absent", reviewed_story_testimonial_status: "absent",
    reviewed_small_cell_risk_status: "absent", reviewed_financial_records_status: "absent", reviewed_consent_basis_status: "unknown",
    reviewed_allowed_use_status: "allowed", reviewed_llm_processing_allowed: true, reviewed_product_learning_allowed: false,
    reviewed_public_use_allowed: false, reviewed_funder_use_allowed: false,
  });

  // --- organizations (one per scenario, so no decision contaminates another)
  const SCENARIOS = ["P", "A", "B", "C", "D", "E"];
  const ORGS = Object.fromEntries(SCENARIOS.map((key, index) => [key, {
    key, organizationId: `0c000000-0000-4000-8000-0000000000${String(index + 1).padStart(2, "0")}`,
    projectId: `7c000000-0000-4000-8000-0000000000${String(index + 1).padStart(2, "0")}`, adminUserId: 1001 + index * 2,
  }]));
  const USERS = Object.freeze({ gkReviewer: 991, outsider: 997 });
  for (const legacyId of [...Object.values(USERS), ...Object.values(ORGS).map((org) => org.adminUserId)]) {
    await query("INSERT INTO public.userdata (id) VALUES ($1) ON CONFLICT DO NOTHING", [legacyId]);
  }
  const gkUser = await findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: USERS.gkReviewer, email: `user${USERS.gkReviewer}@package3.test` });
  await query("INSERT INTO kai.user_roles (user_id, role_id) SELECT $1::uuid, role_id FROM kai.roles WHERE role_name = 'gk_reviewer'", [gkUser.user_id]);
  for (const org of Object.values(ORGS)) {
    await query("INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES ($1::uuid, $2, $3)", [org.organizationId, `Project B ${org.key} (synthetic)`, `project-b-p3-${org.key.toLowerCase()}`]);
    await query("INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code, project_metadata) VALUES ($1::uuid, $2::uuid, $3, '{}'::jsonb)", [org.projectId, org.organizationId, `Project B ${org.key} FY2024-25`]);
    const [gkOrganization] = await query("INSERT INTO public.organizations (name, status) VALUES ($1, 'approved') RETURNING id", [`Project B ${org.key} (synthetic)`]);
    await query("INSERT INTO kai.gk_organization_bindings (gk_organization_id, kai_organization_id, status) VALUES ($1, $2::uuid, 'active')", [gkOrganization.id, org.organizationId]);
    await query("INSERT INTO public.user_org_memberships (org_id, user_id, role, is_active) VALUES ($1, $2, 'admin', true)", [gkOrganization.id, org.adminUserId]);
    await query("INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status) VALUES ($1::uuid, $2::uuid, 'gk_reviewer', 'active')", [org.organizationId, gkUser.user_id]);
  }

  // --- external boundaries ---------------------------------------------------
  const objects = new Map();
  const signedTargets = new Map();
  let generation = 1790000000000001n;
  let baseUrl = "";
  const storage = Object.freeze({
    enabled: true,
    async createSignedUploadUrl({ objectKey, contentType }) {
      const token = randomUUID();
      signedTargets.set(token, { objectKey, contentType });
      return { ok: true, data: { url: `${baseUrl}/synthetic-storage/${token}`, method: "PUT", headers: { "Content-Type": contentType }, expires_in_seconds: 900 } };
    },
    async headObject({ objectKey }) {
      const stored = objects.get(objectKey);
      return stored ? { ok: true, data: { candidate_generation: stored.generation, size_bytes: stored.bytes.byteLength } } : { ok: false, error: { code: "not_found" } };
    },
    async statExactGeneration({ objectKey, gcsGeneration }) {
      const stored = objects.get(objectKey);
      return stored && stored.generation === gcsGeneration ? { ok: true, data: { size_bytes: stored.bytes.byteLength } } : { ok: false, error: { code: "not_found" } };
    },
    async openExactGenerationReadStream({ objectKey, gcsGeneration }) {
      const stored = objects.get(objectKey);
      if (!stored || stored.generation !== gcsGeneration) return { ok: false, error: { code: "not_found" } };
      return { ok: true, data: { size_bytes: stored.bytes.byteLength, byte_source: Readable.from([Buffer.from(stored.bytes)]) } };
    },
  });
  const malwareScanAdapter = Object.freeze({ async scan() { return { status: "clean", provenance: { adapter_id: "kai_synthetic_fixture_adapter", signature_set: "v1" } }; } });
  const restoreRuntime = runtimeService.setKaiIntakeRuntimeDependenciesForTest(Object.freeze({
    env: process.env, gcsProvider: storage, gcsUploadSignerProvider: storage, gcsParserReaderProvider: storage,
    uploadLifecycleRepository: upload.createPostgresUploadLifecycleRepository(),
    internalSecurityAssessmentExecutor: executor.createInternalSecurityAssessmentExecutor({ assessor: (input) => assessor.assessBoundedFileSecurity(input, { malwareScanAdapter }) }),
  }));
  const dispatcher = dispatch.getKaiP1FileDispatcher();
  const reconciliationDispatcher = reconciliationRuntime.getCrossSourceReconciliationDispatcher();

  const harnessSession = (req, _res, next) => {
    const match = /(?:^|;\s*)kai_harness_user=(\d+)/.exec(req.headers.cookie || "");
    if (match) req.user = { id: Number(match[1]), email: `user${match[1]}@package3.test` };
    req.isAuthenticated = () => Boolean(req.user);
    next();
  };
  const publicDir = new URL("../public/", import.meta.url).pathname;
  const bundleSha = sha256(readFileSync(join(publicDir, "js", "bundles", "entry.js")));
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
  app.use("/api/kai/sprint2/intake", config.requireKaiSprint2Enabled, auth.requireKaiSprint2Authenticated, router);
  app.get("/impact-library", (_req, res) => res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><title>Impact Library</title>
    <link rel="stylesheet" href="/css/style.css" /><link rel="stylesheet" href="/css/gk-design-tokens.css" /></head>
    <body><div id="impact-evidence-library-root"></div><script src="/js/bundles/entry.js"></script>
    <script>window.renderImpactEvidenceLibrary();</script></body></html>`));
  app.use(express.static(publicDir));
  const server = await new Promise((resolve) => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const legacyApp = express();
  legacyApp.use(express.json());
  legacyApp.use(harnessSession);
  legacyApp.use("/api/kai/sprint2/intake", legacy.config.requireKaiSprint2Enabled, legacy.auth.requireKaiSprint2Authenticated, legacy.router);
  const legacyServer = await new Promise((resolve) => { const listening = legacyApp.listen(0, "127.0.0.1", () => resolve(listening)); });
  const legacyBaseUrl = `http://127.0.0.1:${legacyServer.address().port}`;

  const client = (origin, legacyUserId) => async (method, path, body) => {
    const response = await fetch(`${origin}${path}`, {
      method, headers: { "Content-Type": "application/json", Accept: "application/json", Cookie: `kai_harness_user=${legacyUserId}` },
      ...(body === undefined ? {} : { body: J(body) }),
    });
    const text = await response.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: response.status, body: parsed };
  };
  for (const org of Object.values(ORGS)) org.api = client(baseUrl, org.adminUserId);
  const gkApi = client(baseUrl, USERS.gkReviewer);
  const outsiderApi = client(baseUrl, USERS.outsider);
  const legacyApiOf = (org) => client(legacyBaseUrl, org.adminUserId);
  const orgPath = (organizationId) => `${BASE_PATH}/admin/organizations/${organizationId}`;
  const COCKPIT = `${BASE_PATH}/admin/review-cockpit`;
  const blockersOf = (response) => (response.body?.blockers || response.body?.error?.blockers || []).map((b) => b.blocking_reason || b.code || b.reason);

  const report = { generated_at: new Date().toISOString(), bundle_sha256: bundleSha, legacy_revision: LEGACY_REVISION, browser: {}, admission: {}, matrix: [], drafts: {}, refusals: {}, provider: {} };
  const MATRIX = report.matrix;

  // --- shared reads ----------------------------------------------------------
  const counts = async (organizationId) => (await query(`SELECT
      (SELECT count(*) FROM kai.generated_content_drafts WHERE organization_id = $1::uuid)::int AS drafts,
      (SELECT count(*) FROM kai.claim_review_decisions WHERE organization_id = $1::uuid)::int AS claim_review_decisions,
      (SELECT count(*) FROM kai.evidence_review_decisions WHERE organization_id = $1::uuid)::int AS evidence_review_decisions,
      (SELECT count(*) FROM kai.coverage_review_decisions WHERE organization_id = $1::uuid)::int AS coverage_review_decisions,
      (SELECT count(*) FROM kai.human_authority_decisions WHERE organization_id = $1::uuid)::int AS human_authority_decisions,
      (SELECT count(*) FROM kai.export_candidates WHERE organization_id = $1::uuid)::int AS export_candidates,
      (SELECT count(*) FROM kai.export_manifests WHERE organization_id = $1::uuid)::int AS export_manifests`, [organizationId]))[0];
  const queueOf = async (organizationId, queueType, targetId) => (await query(
    "SELECT review_queue_item_id::text, updated_at FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = $2 AND target_object_id = $3::uuid ORDER BY created_at DESC",
    [organizationId, queueType, targetId]))[0];
  const gkTrace = async (org, claimId, audience = "internal") => {
    const traced = await gkApi("GET", claimTraceabilityPath(org.organizationId, claimId, audience));
    return { status: traced.status, eligible: traced.body?.data?.eligible ?? null, reason: traced.body?.data?.traceability_conflict_reason ?? null,
      blockerCodes: traced.body?.data?.blockerCodes ?? blockersOf(traced),
      unresolved: Object.entries(traced.body?.data?.dimensions || {}).filter(([, v]) => v.assessment_status === "unresolved").map(([k]) => k).sort() };
  };
  // The organization administrator's diagnostic (the read the bundle makes),
  // and the frontend's own projection of it.
  const diagnose = async (org, claimId, api = org.api) => {
    const read = await api("GET", claimTraceabilityPath(org.organizationId, claimId, "internal"));
    const diagnosis = claimUseDiagnosis({ statusCode: read.status, body: read.body });
    return {
      status: read.status,
      strict: read.body?.data ? { eligible: read.body.data.eligible ?? null, blocker_codes: read.body.data.blocker_codes ?? [], conflict: read.body.data.traceability_conflict_reason ?? null } : null,
      provisional: read.body?.data?.provisional_internal_draft ?? null,
      frontend: claimDraftAdmission({ claimId, evidenceSourceVersionIsCurrent: true }, diagnosis),
      frontendMessage: claimDraftAdmission({ claimId, evidenceSourceVersionIsCurrent: true }, diagnosis) === "refused" ? provisionalDraftRefusalMessage(diagnosis) : null,
    };
  };
  const generate = async (org, claimIds, path = createEvidenceSummaryPath(org.organizationId), api = org.api) => {
    const calls = modelCalls.length;
    const before = await counts(org.organizationId);
    const created = await api("POST", path, { claim_ids: claimIds, idempotency_key: `p3-${org.key}-${randomUUID()}`, engagement_id: org.projectId });
    const after = await counts(org.organizationId);
    const sent = modelCalls.slice(calls);
    return { status: created.status, body: created.body, blockers: blockersOf(created), providerCalls: sent.length, sentClaimIds: sent.flatMap((call) => call.claims.map((c) => c.claimId)).sort(),
      draftsWritten: after.drafts - before.drafts, sourceRole: (created.body?.blockers || []).find((b) => b.evidence?.source_role)?.evidence.source_role ?? null,
      requiredFix: (created.body?.blockers || [])[0]?.required_fix ?? null, draftId: created.body?.data?.generatedContentDraftId ?? null };
  };
  const recordRow = (scenario, row) => { MATRIX.push({ scenario, ...row }); return row; };

  // Upload one file through the intake API, run P1, decide and promote it.
  const uploadAndPromote = async (org, file, supersedes = null) => {
    const { api, organizationId, projectId } = org;
    const batch = await api("POST", createBatchPath(), { organization_id: organizationId, engagement_id: projectId, batch_code: `p3-${file.key}`, idempotency_key: `batch-${randomUUID()}` });
    assert.ok([200, 201].includes(batch.status), J(batch.body));
    const batchId = batch.body.data.intake_batch_id;
    const reserved = await api("POST", fileReservationsPath(batchId), { organization_id: organizationId, engagement_id: projectId, original_filename: file.name, file_extension: file.extension,
      mime_type: file.mime, file_size_bytes: file.bytes.byteLength, checksum: file.checksum, hash_algorithm: "sha256", idempotency_key: `file-${randomUUID()}` });
    assert.ok(reserved.status < 300, J(reserved.body));
    const intakeFileId = reserved.body.data.intake_file_id;
    const signed = await api("POST", requestUploadUrlPath(batchId), { organization_id: organizationId, engagement_id: projectId, intake_file_id: intakeFileId });
    const put = await fetch(signed.body.data.upload_url, { method: signed.body.data.upload_method, headers: signed.body.data.upload_headers, body: file.bytes });
    const confirmed = await api("POST", confirmUploadPath(organizationId, intakeFileId), { organization_id: organizationId });
    assert.deepEqual([put.status, confirmed.status], [200, 200], J(confirmed.body));
    await dispatcher.whenIdle();
    const [sensitivity] = await query(
      `SELECT s.intake_sensitivity_profile_id::text, q.review_queue_item_id::text, q.updated_at FROM kai.intake_sensitivity_profiles s
         JOIN kai.review_queue_items q ON q.target_object_id = s.intake_sensitivity_profile_id AND q.queue_type = 'sensitivity_review' WHERE s.intake_file_id = $1::uuid`, [intakeFileId]);
    const decided = await api("POST", `${COCKPIT}/sensitivity-profiles/${sensitivity.intake_sensitivity_profile_id}/decision?organization_id=${organizationId}`, {
      expected_updated_at: new Date(sensitivity.updated_at).toISOString(), review_queue_item_id: sensitivity.review_queue_item_id, decision: "reviewed", reviewed_snapshot: PARTICIPANT_LEVEL });
    assert.equal(decided.status, 200, J(decided.body));
    const [candidate] = await query("SELECT intake_source_candidate_id::text FROM kai.intake_source_candidates WHERE intake_sensitivity_profile_id = $1::uuid", [sensitivity.intake_sensitivity_profile_id]);
    const promoted = await api("POST", sourceCandidateDecisionPath(organizationId, candidate.intake_source_candidate_id), {
      outcome: "promoted", reviewed_source_type: "organization_primary_record", ...(supersedes ? { supersedes_source_version_id: supersedes } : {}) });
    assert.equal(promoted.status, 200, J(promoted.body));
    const [version] = await query("SELECT source_version_id::text, source_id::text, is_current, profile_canonical_sha256 FROM kai.source_versions WHERE intake_sensitivity_profile_id = $1::uuid", [sensitivity.intake_sensitivity_profile_id]);
    assert.equal(version.is_current, true);
    return { intakeFileId, sensitivityProfileId: sensitivity.intake_sensitivity_profile_id, sourceVersionId: version.source_version_id, sourceId: version.source_id, profileSha: version.profile_canonical_sha256 };
  };
  // The administrator reviews one source's processing permissions again
  // (Review Cockpit review-work, then a decision that supersedes the current one).
  const reviewPermissionsAgain = async (org, source, patch) => {
    const work = await org.api("POST", `${COCKPIT}/sensitivity-profiles/${source.sensitivityProfileId}/review-work?organization_id=${org.organizationId}`, {});
    const [queue] = await query(`SELECT review_queue_item_id::text, updated_at FROM kai.review_queue_items
      WHERE organization_id = $1::uuid AND queue_type = 'sensitivity_review' AND target_object_id = $2::uuid ORDER BY created_at DESC LIMIT 1`, [org.organizationId, source.sensitivityProfileId]);
    const decided = await org.api("POST", `${COCKPIT}/sensitivity-profiles/${source.sensitivityProfileId}/decision?organization_id=${org.organizationId}`, {
      expected_updated_at: new Date(queue.updated_at).toISOString(), review_queue_item_id: queue.review_queue_item_id, decision: "reviewed",
      reviewed_snapshot: { ...PARTICIPANT_LEVEL, ...patch } });
    assert.ok([200, 201].includes(work.status) && decided.status === 200, `review permissions again: ${J([work.status, work.body?.error, decided.status, blockersOf(decided)])}`);
  };
  const setPeriod = async (org) => {
    const set = await org.api("PUT", `${orgPath(org.organizationId)}/engagements/${org.projectId}/requirement-target`,
      { target: { reporting_period_start: PERIOD.start, reporting_period_end: PERIOD.end, report_identity: "Community Connection Project B" } });
    assert.ok([200, 201].includes(set.status), J(set.body));
  };
  const mappingFor = async (org, eventsSv, rosterSv) => {
    const eventsBasis = await org.api("GET", derivedMeasurementBasisPath(org.organizationId, eventsSv));
    const rosterBasis = await org.api("GET", derivedMeasurementBasisPath(org.organizationId, rosterSv));
    const at = (basis, position) => basis.body.data.tabular.fields.find((field) => field.column_position === position);
    const status = at(eventsBasis, 6);
    return {
      events: { event_identifier_field_key: at(eventsBasis, 1).field_key, participant_identifier_field_key: at(eventsBasis, 2).field_key, status_field_key: status.field_key,
        completed_value_key: status.values.find((v) => v.label === "completed").value_key, date_field_key: at(eventsBasis, 4).field_key, group_field_key: at(eventsBasis, 3).field_key },
      register: { participant_identifier_field_key: at(rosterBasis, 1).field_key },
    };
  };
  const metricOf = (m) => m.definition.metric;
  const reconcile = async (org, eventsSv, rosterSv) => {
    const queued = await org.api("POST", crossSourceMeasurementsPath(org.organizationId), { primary_source_version_id: eventsSv, reference_source_version_id: rosterSv, mapping: await mappingFor(org, eventsSv, rosterSv) });
    assert.equal(queued.status, 202, J(queued.body));
    await reconciliationDispatcher.whenIdle();
    const read = await org.api("GET", crossSourceReconciliationJobPath(org.organizationId, queued.body.data.reconciliationJob.reconciliation_job_id));
    assert.equal(read.body.data.reconciliationJob.job_state, "succeeded", J(read.body));
    const byMetric = Object.fromEntries(read.body.data.measurements.map((m) => [metricOf(m), m]));
    return { encounters: byMetric.eligible_linked_encounters, people: byMetric.distinct_people_served };
  };
  const MEANINGS = Object.freeze({
    encounters: ["Eligible completed contacts", "Human-stated for this synthetic acceptance: completed, deduplicated service events in the reporting period linked to a roster participant; contacts, not people."],
    people: ["People served", "Human-stated for this synthetic acceptance: distinct roster participants with at least one eligible completed contact."],
  });
  const interpretAndPropose = async (org, measurement, label) => {
    const [indicatorLabel, meaning] = MEANINGS[label];
    const stated = await org.api("POST", derivedMeasurementInterpretationPath(org.organizationId, measurement.source_derived_measurement_id),
      { indicator_label: indicatorLabel, meaning_text: meaning, evidence_basis: "organization_record" });
    assert.equal(stated.status, 200, J(stated.body));
    assert.equal(stated.body.data.measurement.measured_value, measurement.measured_value, "a meaning never changes the count");
    const proposed = await org.api("POST", claimProposalPath(org.organizationId, stated.body.data.evidenceItem.evidence_item_id), {});
    assert.ok([200, 201].includes(proposed.status), J(proposed.body));
    return { claimId: proposed.body.data.claim.claim_id, evidenceItemId: stated.body.data.evidenceItem.evidence_item_id, measurementId: measurement.source_derived_measurement_id, statement: proposed.body.data.claim.statement };
  };
  // The whole Project B path for one organization, through the API.
  const buildProjectB = async (org) => {
    await setPeriod(org);
    const rosterSource = await uploadAndPromote(org, roster);
    const eventsSource = await uploadAndPromote(org, events);
    const cross = await reconcile(org, eventsSource.sourceVersionId, rosterSource.sourceVersionId);
    assert.deepEqual([cross.encounters.measured_value, cross.people.measured_value], [EXPECTED.eligible, EXPECTED.people]);
    const claims = { encounters: await interpretAndPropose(org, cross.encounters, "encounters"), people: await interpretAndPropose(org, cross.people, "people") };
    Object.assign(org, { roster: rosterSource, events: eventsSource, cross, claims });
    return org;
  };
  const clientReads = async (org, draftId) => {
    const list = await org.api("GET", clientInternalDraftsPath(org.organizationId, org.projectId));
    const item = (list.body?.data?.items || []).find((entry) => entry.generatedContentDraftId === draftId) ?? null;
    const detail = await org.api("GET", clientInternalDraftPath(org.organizationId, org.projectId, draftId));
    const markdown = await org.api("GET", clientInternalReportMarkdownPath(org.organizationId, org.projectId, draftId));
    const persisted = await query(`SELECT d.draft_status, d.review_status, count(b.*)::int AS blocks FROM kai.generated_content_drafts d
      LEFT JOIN kai.generated_content_blocks b ON b.generated_content_draft_id = d.generated_content_draft_id
     WHERE d.generated_content_draft_id = $1::uuid GROUP BY d.draft_status, d.review_status`, [draftId]);
    return {
      metadata: { status: list.status, listed: Boolean(item), internalReportAvailable: item?.internalReportAvailable ?? null },
      content: { status: detail.status, blocks: detail.body?.data?.blocks?.length ?? null, available: detail.body?.data?.internalReport?.available ?? null,
        blockedReasons: detail.body?.data?.internalReport?.blockedReasons ?? null, getKinderReviewReasons: detail.body?.data?.internalReport?.getKinderReviewReasons ?? null,
        informationReasons: detail.body?.data?.internalReport?.informationReasons ?? null, error: detail.body?.error?.code ?? null },
      markdown: { status: markdown.status, blockers: blockersOf(markdown), length: typeof markdown.body?.data?.markdown === "string" ? markdown.body.data.markdown.length : 0 },
      persisted: persisted[0] ?? null,
      markdownText: markdown.body?.data?.markdown ?? null,
    };
  };
  // Release and factual review attempts by the organization administrator, and the funder route.
  const releaseAttempts = async (org, draftId) => {
    const before = await counts(org.organizationId);
    const factual = await org.api("POST", clientInternalDraftFactualReviewPath(org.organizationId, org.projectId, draftId), { decision: "approved" });
    const release = await org.api("POST", clientInternalDraftReleasePath(org.organizationId, org.projectId, draftId), { decision: "release_for_internal_use", limitations_confirmed: true });
    const after = await counts(org.organizationId);
    return { factual_review: [factual.status, blockersOf(factual)], release: [release.status, blockersOf(release)], writes: J(before) === J(after) ? "none" : { before, after } };
  };

  const browser = await launchChrome();
  const page = await openPage(browser, { baseUrl, legacyUserId: ORGS.P.adminUserId });
  const P = ORGS.P;

  try {
    await test("0: the two upload files match the package's checksum manifest; the answer key is not a source; the tested bundle is the built one", () => {
      const manifest = JSON.parse(readFileSync(join(PACKAGE, "03_ANSWER_KEY_DO_NOT_UPLOAD", "Community_File_Checksums.json"), "utf8"));
      for (const file of [roster, events]) {
        const entry = manifest.find((candidate) => candidate.relative_path === `01_UPLOAD_TO_KAI/${file.name}`);
        assert.ok(entry, file.name);
        assert.deepEqual([file.checksum, file.bytes.byteLength], [entry.sha256, entry.bytes], file.name);
      }
      assert.match(bundleSha, /^[0-9a-f]{64}$/);
    });

    // ---- Positive scenario P: browser journey -----------------------------
    await test("P1 (fixture, API): the Project, its period, both files decided as participant-level and promoted; Count records records 217 source records", async () => {
      await setPeriod(P);
      P.roster = await uploadAndPromote(P, roster);
      P.events = await uploadAndPromote(P, events);
      const recorded = await P.api("POST", sourceRecordCountMeasurementPath(P.organizationId, P.events.sourceVersionId), {
        counted_unit: "service log record", unit_label: "service log records", definition_text: "Each data row of the service log records one service event as exported.",
        inclusion_rule: "Completed events in the reporting period linked to the roster.", exclusion_rule: "Cancelled and no-show events." });
      assert.equal(recorded.status, 200, J(recorded.body));
      let claimId = recorded.body.data.claim?.claim_id ?? null;
      if (!claimId) claimId = (await P.api("POST", claimProposalPath(P.organizationId, recorded.body.data.evidenceItem.evidence_item_id), {})).body.data.claim.claim_id;
      const [row] = await query("SELECT statement FROM kai.claims WHERE claim_id = $1::uuid", [claimId]);
      assert.match(row.statement, /\b217 source records\b/);
      assert.match(row.statement, /Not applied by KAI:/);
      P.recordCount = { claimId, evidenceItemId: recorded.body.data.evidenceItem.evidence_item_id, statement: row.statement };
      P.approvalsBefore = await counts(P.organizationId);
      assert.deepEqual([P.approvalsBefore.claim_review_decisions, P.approvalsBefore.evidence_review_decisions, P.approvalsBefore.coverage_review_decisions], [0, 0, 0]);
    });

    const openStudio = async (view) => {
      await page.goto("/impact-library");
      await page.clickNav("Knowledge Studio");
      await page.waitFor(() => page.visible("#gk-shell-project-select"), "the Project selector");
      await page.idle();
      await page.selectProject(P.projectId);
      await page.idle();
      await page.clickTab(view);
      await page.idle();
    };

    await test("P2 (browser): Sources -> Count records -> Link to a participant register; KAI's job records 190 contacts and 67 people, read back with both versions", async () => {
      await openStudio("Sources");
      const bundleRequest = page.requests().find((r) => new URL(r.url).pathname === "/js/bundles/entry.js");
      assert.equal(bundleRequest?.status, 200, "the page ran the built bundle");
      await page.clickVisible(`[data-client-open-source-measurement="${P.events.sourceVersionId}"]`, "Count records on the service log");
      const section = `[data-client-cross-source="${P.events.sourceVersionId}"]`;
      await page.waitFor(() => page.visible(`${section} [data-client-cross-source-form]`), "the Link to a participant register form");
      assert.match(await page.textOf(section), /Link to a participant register/);
      assert.match(await page.textOf(`${section} [data-client-cross-source-period]`), new RegExp(`${PERIOD.start} to ${PERIOD.end}`));
      const field = (key) => `${section} [data-client-cross-source-field="${key}"]`;
      assert.ok(await page.choose(field("referenceSourceVersionId"), P.roster.sourceVersionId), "choose the roster version");
      await page.waitFor(() => page.visible(field("registerParticipantFieldKey")), "the roster's fields");
      for (const [key, value] of [["eventIdentifierFieldKey", "field_1"], ["participantIdentifierFieldKey", "field_2"], ["statusFieldKey", "field_6"], ["dateFieldKey", "field_4"], ["groupFieldKey", "field_3"], ["registerParticipantFieldKey", "field_1"]]) {
        assert.ok(await page.choose(field(key), value), key);
      }
      const completedKey = await page.evaluate(`(() => { const el = document.querySelector(${J(field("completedValueKey"))}); const o = el && [...el.options].find((x) => x.textContent.includes("completed")); return o ? o.value : null; })()`);
      assert.ok(completedKey && await page.choose(field("completedValueKey"), completedKey), "the listed completed value");
      await page.waitFor(async () => !(await page.textOf(`${section} [data-client-cross-source-problem]`)), "the form is complete");
      assert.doesNotMatch(await page.textOf(section), RAW_IDENTIFIER, "no identifier is shown");
      const mark = page.mark();
      await page.clickVisible(`${section} [data-client-cross-source-submit]`, "Reconcile and record");
      await page.waitFor(async () => (await page.attrOf(`${section} [data-client-cross-source-job]`, "data-client-cross-source-job-state")) === "succeeded", "the job settles", { timeout: 60000 });
      await page.idle();
      const posted = page.requestsSince(mark).find((r) => r.method === "POST");
      assert.deepEqual([new URL(posted.url).pathname, posted.status], [crossSourceMeasurementsPath(P.organizationId), 202]);
      const shownEncounters = await page.textOf(`${section} [data-client-cross-source-result="eligible_linked_encounters"]`);
      const shownPeople = await page.textOf(`${section} [data-client-cross-source-result="distinct_people_served"]`);
      assert.match(shownEncounters, new RegExp(`\\b${EXPECTED.eligible}$`));
      assert.match(shownPeople, new RegExp(`\\b${EXPECTED.people}$`));
      // The displayed values are the persisted measurement rows of this job (no stub, no recomputation).
      const rows = await query(`SELECT source_derived_measurement_id::text, definition->>'metric' AS metric, measured_value::int, component_counts
        FROM kai.source_derived_measurements WHERE organization_id = $1::uuid AND measurement_family = 'cross_source_reach'`, [P.organizationId]);
      const byMetric = Object.fromEntries(rows.map((row) => [row.metric, row]));
      const c = byMetric.distinct_people_served.component_counts;
      const stages = { raw: c.physical_record_count, deduplicated: c.distinct_event_count, completed: c.completed_event_count, in_period: c.in_period_completed_event_count,
        eligible: byMetric.eligible_linked_encounters.measured_value, people: byMetric.distinct_people_served.measured_value, both: byMetric.people_in_more_than_one_group.measured_value };
      assert.deepEqual(stages, { raw: 217, deduplicated: 215, completed: 197, in_period: 192, eligible: 190, people: 67, both: 11 });
      const groups = await query(`SELECT definition->'group'->>'value_label' AS label, definition->>'metric' AS metric, measured_value::int FROM kai.source_derived_measurements
        WHERE organization_id = $1::uuid AND definition->>'metric' IN ('group_linked_encounters', 'group_distinct_people_served') ORDER BY 1, 2`, [P.organizationId]);
      assert.deepEqual(groups.map((g) => [g.label, g.metric, g.measured_value]), [["CC", "group_distinct_people_served", 42], ["CC", "group_linked_encounters", 105], ["RA", "group_distinct_people_served", 36], ["RA", "group_linked_encounters", 85]]);
      P.cross = { encounters: byMetric.eligible_linked_encounters, people: byMetric.distinct_people_served };
      report.browser.measurement = { request: [new URL(posted.url).pathname, posted.status], shown: [shownEncounters, shownPeople], persisted_stages: stages,
        groups: groups.map((g) => [g.label, g.metric, g.measured_value]) };
    });

    await test("P3 (browser): the administrator states each finding's meaning and proposes its claim from the recorded measurement", async () => {
      // Reload: the recorded rows are read back.
      await openStudio("Sources");
      await page.clickVisible(`[data-client-open-source-measurement="${P.events.sourceVersionId}"]`, "Count records on the service log");
      P.claims = {};
      for (const label of ["encounters", "people"]) {
        const recorded = `[data-client-derived-recorded="${P.cross[label].source_derived_measurement_id}"]`;
        await page.waitFor(() => page.visible(recorded), `${label} recorded row`);
        const sources = await page.evaluate(`[...document.querySelectorAll(${J(`${recorded} [data-client-derived-contributing-source]`)})].map((el) => [el.getAttribute("data-client-derived-contributing-source"), el.getAttribute("data-client-derived-contributing-current")])`);
        assert.deepEqual(sources, [["primary", "current"], ["reference", "current"]], `${label}: both contributing versions, current`);
        await page.clickVisible(`${recorded} [data-client-derived-clarify]`, "Clarify meaning");
        await page.waitFor(() => page.visible(`${recorded} [data-client-derived-clarify-form]`), "the meaning form");
        assert.ok(await page.type(`${recorded} [data-client-derived-clarify-field="indicatorLabel"]`, MEANINGS[label][0]));
        assert.ok(await page.type(`${recorded} [data-client-derived-clarify-field="meaningText"]`, MEANINGS[label][1]));
        assert.ok(await page.choose(`${recorded} [data-client-derived-clarify-field="evidenceBasis"]`, "organization_record"));
        let mark = page.mark();
        await page.clickVisible(`${recorded} [data-client-derived-clarify-submit]`, "Record meaning");
        await page.waitFor(() => page.visible(`${recorded} [data-client-derived-propose-claim]`), `${label}: Propose a claim`, { timeout: 30000 });
        await page.idle();
        const stated = page.requestsSince(mark).find((r) => r.method === "POST");
        assert.deepEqual([new URL(stated.url).pathname, stated.status], [derivedMeasurementInterpretationPath(P.organizationId, P.cross[label].source_derived_measurement_id), 200]);
        const statedBody = await page.responseBody(stated);
        assert.equal(statedBody.data.measurement.measured_value, P.cross[label].measured_value, "a meaning never changes the count");
        mark = page.mark();
        await page.clickVisible(`${recorded} [data-client-derived-propose-claim]`, "Propose a claim");
        await page.waitFor(() => page.visible(`${recorded} [data-client-derived-claim]`), `${label}: claim shown`, { timeout: 30000 });
        await page.idle();
        const proposed = page.requestsSince(mark).find((r) => r.method === "POST");
        assert.ok([200, 201].includes(proposed.status));
        const { claim } = (await page.responseBody(proposed)).data;
        assert.equal(await page.textOf(`${recorded} [data-client-derived-claim]`), `Claim: ${claim.statement}`);
        P.claims[label] = { claimId: claim.claim_id, evidenceItemId: statedBody.data.evidenceItem.evidence_item_id, measurementId: P.cross[label].source_derived_measurement_id, statement: claim.statement };
      }
      report.browser.claims = Object.fromEntries(Object.entries(P.claims).map(([k, v]) => [k, { claim_id: v.claimId, statement: v.statement }]));
    });

    await test("P4: before generation - claim identity, both current versions, profile lineage, decisions, period/units/exclusions, integrity, and a distinct 217-record finding", async () => {
      for (const label of ["encounters", "people"]) {
        const claim = P.claims[label];
        // 1. The claim belongs to the current measurement.
        const [link] = await query(`SELECT l.source_derived_measurement_id::text, c.evidence_item_id::text, c.claim_type FROM kai.claims c
          JOIN kai.evidence_derived_measurements l ON l.evidence_item_id = c.evidence_item_id WHERE c.claim_id = $1::uuid`, [claim.claimId]);
        assert.deepEqual([link.source_derived_measurement_id, link.evidence_item_id, link.claim_type], [claim.measurementId, claim.evidenceItemId, "finding"]);
        // 2-3. Both contributing versions current, each bound to its promoted profile.
        const sources = await query(`SELECT s.source_role, s.source_version_id::text, s.profile_canonical_sha256, v.is_current, v.profile_canonical_sha256 AS version_sha
          FROM kai.source_derived_measurement_sources s JOIN kai.source_versions v ON v.source_version_id = s.source_version_id
         WHERE s.source_derived_measurement_id = $1::uuid ORDER BY s.source_role`, [claim.measurementId]);
        assert.deepEqual(sources.map((s) => [s.source_role, s.source_version_id, s.is_current, s.profile_canonical_sha256 === s.version_sha]),
          [["primary", P.events.sourceVersionId, true, true], ["reference", P.roster.sourceVersionId, true, true]]);
        // 4. The source-level decisions exist: reviewed, allowed, AI permitted, personal information present (truthful).
        for (const source of [P.events, P.roster]) {
          const [decision] = await query(`SELECT decision_outcome, reviewed_allowed_use_status, reviewed_llm_processing_allowed, reviewed_personal_data_status
            FROM kai.intake_sensitivity_review_decisions d WHERE d.intake_sensitivity_profile_id = $1::uuid
             AND NOT EXISTS (SELECT 1 FROM kai.intake_sensitivity_review_decisions s WHERE s.supersedes_decision_id = d.decision_id)`, [source.sensitivityProfileId]);
          assert.deepEqual(decision, { decision_outcome: "reviewed", reviewed_allowed_use_status: "allowed", reviewed_llm_processing_allowed: true, reviewed_personal_data_status: "present" });
        }
        // 5. Period, counted entities, method and exclusions are in the claim.
        assert.match(claim.statement, new RegExp(`reporting period ${PERIOD.start} to ${PERIOD.end} by day`));
        if (label === "encounters") assert.match(claim.statement, /190 eligible service encounters \(encounters, not people\)/);
        if (label === "people") assert.match(claim.statement, /67 distinct register participants served, each counted once, among 190 eligible encounters/);
        assert.match(claim.statement, /excluded 5 outside period, 2 unmatched, 0 conflicting/);
        assert.ok(claim.statement.includes(P.roster.sourceVersionId), "the claim names the roster version");
        // 6. Package 1's integrity rule passes for the current claim (read-only, real rows).
        const tx = await ambientPool.connect();
        try {
          await tx.query("BEGIN READ ONLY");
          const evidenceItemRow = await intakeQueries.getScopedEvidenceItemById({ organizationId: P.organizationId, evidenceItemId: claim.evidenceItemId }, tx);
          const locatorRow = await intakeQueries.getScopedSourceLocatorById({ organizationId: P.organizationId, sourceLocatorId: evidenceItemRow.source_locator_id }, tx);
          const sourceVersionRow = await intakeQueries.getScopedSourceVersionById({ organizationId: P.organizationId, sourceVersionId: evidenceItemRow.source_version_id }, tx);
          const claimRow = await intakeQueries.getScopedClaimById({ organizationId: P.organizationId, claimId: claim.claimId }, tx);
          const integrity = await evaluateMeasuredClaimIntegrityInTransaction(tx, { organizationId: P.organizationId, evidenceItemRow, locatorRow, sourceVersionRow, claimRow });
          assert.deepEqual([integrity.applies, integrity.reason], [true, null], label);
        } finally {
          await tx.query("ROLLBACK");
          tx.release();
        }
      }
      // 7. The 217 record count is a distinct source-record finding.
      assert.ok(![P.claims.encounters.claimId, P.claims.people.claimId].includes(P.recordCount.claimId));
      assert.doesNotMatch(P.recordCount.statement, /\b(190|67)\b/);
    });

    await test("P5: the server's strict P2-06 answer is 'not eligible' (open GK review) while its provisional internal draft admission admits both claims; no approval exists", async () => {
      for (const label of ["encounters", "people"]) {
        const strict = await gkTrace(P, P.claims[label].claimId);
        const client = await diagnose(P, P.claims[label].claimId);
        assert.equal(strict.eligible, false, J(strict));
        assert.ok(!strict.blockerCodes.includes("measured_claim_integrity_not_established"), J(strict));
        assert.equal(client.status, 200);
        assert.deepEqual(client.provisional, { admitted: true, blocker_codes: [], source_role: null }, J(client));
        assert.equal(client.frontend, "admitted");
        report.admission[`P:${label}`] = { strict: { eligible: strict.eligible, blockerCodes: strict.blockerCodes }, client };
        recordRow("P positive", { claim: label, primary: "allowed+AI", reference: "allowed+AI", strict_eligible: strict.eligible, provisional_admitted: true, operation: "admission read", http: client.status });
      }
      const now = await counts(P.organizationId);
      assert.deepEqual([now.claim_review_decisions, now.evidence_review_decisions, now.coverage_review_decisions], [0, 0, 0], "no review was recorded to obtain the admission");
    });

    await test("P6 (browser): in Evidence both claims show 'Usable in a provisional internal draft now' with the open final-use items; the administrator selects them", async () => {
      await openStudio("Evidence");
      for (const label of ["encounters", "people"]) {
        const row = `[data-client-claim="${P.claims[label].claimId}"]`;
        // Observed first (also on a revision without the repair): what the row says once KAI's reads settle.
        await page.waitFor(async () => !["unknown", null].includes(await page.attrOf(row, "data-client-claim-internal-use")), `${label}: the strict read settles`, { timeout: 30000 });
        await page.idle();
        report.browser[`observed_row_${label}`] = { strict_attribute: await page.attrOf(row, "data-client-claim-internal-use"), provisional_attribute: await page.attrOf(row, "data-client-claim-provisional-draft"),
          text: await page.textOf(row), select_offered: await page.evaluate(`Boolean(document.querySelector('[data-client-select-claim="${P.claims[label].claimId}"]'))`) };
        await page.waitFor(async () => (await page.attrOf(row, "data-client-claim-provisional-draft")) === "admitted", `${label}: the server's admission is shown`, { timeout: 30000 });
        // Reveal the row by clicking whatever visible tab or list toggle holds it.
        await page.evaluate(`(() => { const el = document.querySelector(${J(row)}); if (el && el.offsetParent === null) { for (let n = el; n && n !== document.body; n = n.parentElement) {
          if (n.hidden && n.dataset.knowledgeStudioReveal) document.querySelector('[data-knowledge-studio-reveal-toggle="' + n.dataset.knowledgeStudioReveal + '"]')?.click(); } } return true; })()`);
        await page.waitFor(() => page.visible(row), `${label} claim row visible`);
        const shown = await page.textOf(row);
        assert.match(shown, /Usable in a provisional internal draft now \(determined by KAI.s checks; this is not a review or an approval\)\./, shown);
        assert.doesNotMatch(shown, /Not usable/, "no contradiction on an admitted claim");
        await page.clickVisible(`${row} [data-knowledge-studio-disclosure="claim-final-use-open"] > button`, "Before final use");
        await page.waitFor(() => page.visible(`${row} [data-client-claim-final-use-open]`), `${label}: open final-use items`);
        const open = await page.textOf(`${row} [data-client-claim-final-use-open]`);
        assert.match(open, /^Not yet established for final internal use \(factual review and release\), and never for funder or public use from this draft: /);
        assert.doesNotMatch(open, /Processing permissions|Count records|record-count rule/, "no unrelated permission or record-count advice on a cross-source finding");
        assert.match(open, /its claim has no completed review/);
        report.browser[`status_${label}`] = { attribute: "admitted", text: shown.split("\n")[0], final_use_open: open };
        await page.clickVisible(`[data-client-select-claim="${P.claims[label].claimId}"]`, `${label}: Use in an internal draft`);
        await page.waitFor(() => page.evaluate(`document.querySelector('[data-client-select-claim="${P.claims[label].claimId}"]').checked === true`), `${label} selected`);
      }
      // The 217-record finding is listed separately and not selected.
      assert.equal(await page.evaluate(`document.querySelector('[data-client-select-claim="${P.recordCount.claimId}"]')?.checked ?? null`) !== true, true);
    });

    await test("P7 (browser): in Drafts the selection is described as provisional; Generate internal evidence summary saves a draft from exactly the two admitted claims", async () => {
      await page.clickTab("Drafts");
      await page.idle();
      await page.waitFor(async () => Boolean(await page.textOf("[data-client-draft-selected-claims]")), "the selected findings");
      const selected = await page.textOf("[data-client-draft-selected-claims]");
      assert.equal(selected.split("\n").filter(Boolean).length, 2, selected);
      const note = await page.textOf("[data-client-draft-selection-usability]");
      report.browser.observed_selection_note = { attribute: await page.attrOf("[data-client-draft-selection-usability]", "data-client-draft-selection-usability"), text: note };
      assert.equal(await page.attrOf("[data-client-draft-selection-usability]", "data-client-draft-selection-usability"), "provisional");
      assert.match(note, /2 selected finding\(s\) are provisional: KAI's checks admit them to an internal draft/);
      assert.doesNotMatch(note, /will be refused/);
      const calls = modelCalls.length;
      const mark = page.mark();
      await page.clickButton("Generate internal evidence summary");
      await page.waitFor(() => page.visible("[data-client-generated-draft]"), "the created draft", { timeout: 60000 });
      await page.idle();
      const posted = page.requestsSince(mark).find((r) => r.method === "POST");
      assert.deepEqual([new URL(posted.url).pathname, posted.status], [createEvidenceSummaryPath(P.organizationId), 201]);
      const sent = JSON.parse(posted.postData);
      assert.deepEqual(sent.claim_ids, [P.claims.encounters.claimId, P.claims.people.claimId].sort());
      assert.equal(sent.engagement_id, P.projectId);
      const created = await page.responseBody(posted);
      P.draftId = created.data.generatedContentDraftId;
      assert.equal(await page.attrOf("[data-client-generated-draft]", "data-client-generated-draft"), P.draftId);
      // The provider received exactly the two admitted claims, once.
      const providerCalls = modelCalls.slice(calls);
      assert.equal(providerCalls.length, 1);
      const call = providerCalls[0];
      assert.deepEqual(call.claims.map((c) => c.claimId).sort(), sent.claim_ids);
      assert.ok(!call.claims.some((c) => c.claimId === P.recordCount.claimId), "the 217-record claim was not sent");
      for (const c of call.claims) {
        assert.ok(c.limitationCodes.includes("derived.cross_source_linked"), J(c.limitationCodes));
        assert.ok(c.limitationCodes.includes("claim_review_unresolved") || c.limitationCodes.includes("evidence_review_unresolved"), "the open review travels as a limitation");
      }
      assert.doesNotMatch(call.serialized, RAW_IDENTIFIER, "no participant or event identifier reaches the model");
      report.provider.positive = { calls: providerCalls.length, claim_ids: call.claims.map((c) => c.claimId).sort(), requested_audience: call.requestedAudience,
        limitation_codes: Object.fromEntries(call.claims.map((c) => [c.claimId, c.limitationCodes])), raw_identifier_found: RAW_IDENTIFIER.test(call.serialized) };
      report.browser.generation = { request: [new URL(posted.url).pathname, posted.status], claim_ids: sent.claim_ids, draft_id: P.draftId };
      recordRow("P positive", { claim: "both", primary: "allowed+AI", reference: "allowed+AI", strict_eligible: false, provisional_admitted: true,
        operation: "generate internal evidence summary (browser)", http: posted.status, provider_invoked: true, draft: "saved" });
    });

    await test("P8: the persisted draft is a draft, cites exactly the two claims with their numbers and qualifications, and records no approval", async () => {
      const [draft] = await query(`SELECT d.draft_status, d.review_status, d.requested_audience, d.content_type, r.engagement_id::text FROM kai.generated_content_drafts d
        JOIN kai.generation_runs r ON r.generation_run_id = d.generation_run_id WHERE d.generated_content_draft_id = $1::uuid`, [P.draftId]);
      assert.deepEqual(draft, { draft_status: "draft", review_status: "needs_gk_review", requested_audience: "internal", content_type: "evidence_summary", engagement_id: P.projectId },
        "the model's 'approved' / 'released' assertions changed nothing");
      const blocks = await query(`SELECT b.ordinal, b.text, c.claim_id::text, c.evidence_item_id::text FROM kai.generated_content_blocks b
        JOIN kai.generated_content_citations c ON c.generated_content_block_id = b.generated_content_block_id WHERE b.generated_content_draft_id = $1::uuid ORDER BY b.ordinal`, [P.draftId]);
      assert.deepEqual(blocks.map((b) => b.claim_id).sort(), [P.claims.encounters.claimId, P.claims.people.claimId].sort());
      const of = (label) => blocks.find((b) => b.claim_id === P.claims[label].claimId);
      assert.equal(of("encounters").evidence_item_id, P.claims.encounters.evidenceItemId);
      assert.match(of("encounters").text, /\b190\b/);
      assert.match(of("encounters").text, /This counts service encounters, not people/);
      assert.match(of("people").text, /\b67\b/);
      assert.match(of("people").text, /counted once/);
      for (const block of blocks) {
        assert.match(block.text, /linked to the participant register by matching identifier values exactly/);
        assert.doesNotMatch(block.text, /\b217\b/, "no 217 assertion");
        assert.doesNotMatch(block.text, /\b(approved|released|final)\b/i, "no approval or release language");
        // "verified" appears only as the server disclosure's negation.
        assert.deepEqual(block.text.match(/\S+ \S+ verified/gi) || [], (block.text.match(/\S+ \S+ verified/gi) || []).filter((m) => /^not independently verified$/i.test(m)));
      }
      const now = await counts(P.organizationId);
      assert.deepEqual(now, { ...P.approvalsBefore, drafts: P.approvalsBefore.drafts + 1 }, "only the draft was written");
      const contentQueue = await queueOf(P.organizationId, "generated_content_review", P.draftId);
      assert.ok(contentQueue, "the draft waits in the existing content review queue");
      report.drafts.P = { persisted: draft, blocks: blocks.map((b) => ({ claim_id: b.claim_id, text: b.text })) };
    });

    await test("P9 (browser): the administrator opens the saved draft and its internal report; Markdown carries citations, both versions, period, exclusions and provisional status", async () => {
      await page.waitFor(() => page.visible(`[data-client-internal-draft-detail="${P.draftId}"]`), "the saved draft opened from the server", { timeout: 30000 });
      const detailGet = page.requests().filter((r) => r.method === "GET" && new URL(r.url).pathname === clientInternalDraftPath(P.organizationId, P.projectId, P.draftId)).at(-1);
      assert.equal(detailGet?.status, 200, "the supported client read path");
      const detail = await page.textOf(`[data-client-internal-draft-detail="${P.draftId}"]`);
      assert.match(detail, /provisional internal report/);
      assert.match(detail, /not reviewed, verified or released/);
      assert.doesNotMatch(detail, /no further review or release step is needed/);
      assert.equal(await page.attrOf(`[data-client-internal-draft-detail="${P.draftId}"] [data-client-internal-report]`, "data-client-internal-report-provisional"), "true");
      for (const label of ["encounters", "people"]) assert.ok(await page.textOf(`[data-client-internal-draft-detail="${P.draftId}"] [data-client-internal-draft-citation="${P.claims[label].claimId}"]`), `${label} cited`);
      const mark = page.mark();
      await page.clickVisible(`[data-client-open-internal-report="${P.draftId}"]`, "Open report");
      await page.waitFor(() => page.visible("[data-client-internal-report-markdown]"), "the internal report", { timeout: 30000 });
      await page.idle();
      const markdownGet = page.requestsSince(mark).find((r) => new URL(r.url).pathname === clientInternalReportMarkdownPath(P.organizationId, P.projectId, P.draftId));
      assert.equal(markdownGet?.status, 200);
      const markdown = await page.textOf("[data-client-internal-report-markdown]");
      assert.match(markdown, /\*\*Status:\*\* Provisional internal draft\./);
      assert.match(markdown, /not approved for release, funders or the public/);
      assert.match(markdown, /Review for final use complete: no \(provisional finding\)/);
      assert.match(markdown, /\b190\b[\s\S]*\b67\b|\b67\b[\s\S]*\b190\b/);
      assert.match(markdown, new RegExp(`${PERIOD.start}[\\s\\S]*${PERIOD.end}`));
      for (const sv of [P.events.sourceVersionId, P.roster.sourceVersionId]) assert.ok(markdown.includes(sv), `the report cites version ${sv}`);
      assert.match(markdown, /CIT-001/);
      assert.match(markdown, /encounters, not people/);
      assert.match(markdown, /2 unmatched/);
      assert.doesNotMatch(markdown, /\b217 (?:completed|eligible|contacts|people)/i, "no unsupported 217 completed-contact assertion");
      assert.doesNotMatch(markdown, RAW_IDENTIFIER);
      report.browser.saved_draft = { detail_get: detailGet.status, markdown_get: markdownGet.status, markdown_length: markdown.length,
        status_line: (/\*\*Status:\*\*[^\n]*/.exec(markdown) || [""])[0], authority_lines: markdown.split("\n").filter((l) => /Review for final use complete/.test(l)) };
      assert.deepEqual(page.exceptions, [], "no page exception");
    });

    // ---- F: unauthorized actors and audiences on P ------------------------
    await test("F: an outsider and another tenant's administrator cannot read or generate P's content; provisional admission is not funder, release or factual-review authority", async () => {
      const before = await counts(P.organizationId);
      const calls = modelCalls.length;
      const attempts = {};
      for (const [who, api] of [["outsider", outsiderApi], ["other_tenant_admin", ORGS.A.api]]) {
        attempts[who] = {
          diagnostic: (await api("GET", claimTraceabilityPath(P.organizationId, P.claims.people.claimId, "internal"))).status,
          drafts: (await api("GET", clientInternalDraftsPath(P.organizationId, P.projectId))).status,
          draft: (await api("GET", clientInternalDraftPath(P.organizationId, P.projectId, P.draftId))).status,
          markdown: (await api("GET", clientInternalReportMarkdownPath(P.organizationId, P.projectId, P.draftId))).status,
          generate: (await api("POST", createEvidenceSummaryPath(P.organizationId), { claim_ids: [P.claims.people.claimId], idempotency_key: `x-${randomUUID()}`, engagement_id: P.projectId })).status,
        };
        for (const [key, status] of Object.entries(attempts[who])) assert.ok([401, 403, 404].includes(status), `${who} ${key}: ${status}`);
      }
      // Another tenant's administrator naming its OWN organization with P's claim: P's claim is not found there.
      const crossNamed = await ORGS.A.api("POST", createEvidenceSummaryPath(ORGS.A.organizationId), { claim_ids: [P.claims.people.claimId], idempotency_key: `x-${randomUUID()}`, engagement_id: ORGS.A.projectId });
      attempts.other_tenant_names_p_claim = [crossNamed.status, blockersOf(crossNamed)];
      assert.ok(crossNamed.status >= 400 && crossNamed.status < 500, J(attempts.other_tenant_names_p_claim));
      // Funder generation: the administrator's role is refused outright, and
      // Get Kinder's reviewer, whose role may request it, is refused because
      // the claims are not funder-eligible. Neither reaches the provider.
      const funder = await generate(P, [P.claims.encounters.claimId, P.claims.people.claimId], createFunderEvidenceSummaryPath(P.organizationId));
      const gkFunder = await generate(P, [P.claims.encounters.claimId, P.claims.people.claimId], createFunderEvidenceSummaryPath(P.organizationId), gkApi);
      for (const attempt of [funder, gkFunder]) {
        assert.ok([403, 422].includes(attempt.status), J(attempt.body));
        assert.deepEqual([attempt.providerCalls, attempt.draftsWritten], [0, 0]);
      }
      assert.deepEqual([funder.status, funder.blockers[0]], [403, "role_not_allowed"]);
      if (gkFunder.status === 422) assert.equal(gkFunder.body?.error?.code, "funder_use_not_currently_eligible");
      const release = await releaseAttempts(P, P.draftId);
      for (const step of ["factual_review", "release"]) {
        assert.ok(release[step][0] >= 400, `${step}: ${J(release[step])}`);
      }
      assert.ok(release.factual_review[1].includes("personal_information_not_cleared"), J(release.factual_review));
      assert.equal(release.writes, "none");
      assert.equal(modelCalls.length, calls, "no provider call");
      assert.deepEqual(await counts(P.organizationId), before, "nothing written");
      report.refusals.F = { attempts, funder_by_admin: [funder.status, funder.blockers, funder.providerCalls], funder_by_gk_reviewer: [gkFunder.status, gkFunder.body?.error?.code, gkFunder.blockers, gkFunder.providerCalls], release };
      recordRow("F audience", { claim: "both", strict_eligible: false, provisional_admitted: true, operation: "funder evidence summary", http: funder.status, provider_invoked: false, draft: "refused",
        blocker: `admin ${funder.blockers[0]}; GK reviewer ${gkFunder.status} ${gkFunder.body?.error?.code}` });
      recordRow("F release", { claim: "draft", operation: "organization factual review / release", http: `${release.factual_review[0]}/${release.release[0]}`, provider_invoked: false,
        draft: "refused", blocker: release.factual_review[1].join(",") });
    });

    // ---- A: primary source not permitted + G ------------------------------
    await test("A + G: a saved draft, then the service log's AI processing is withdrawn; new generation is refused before the provider; saved-draft operations each follow their own rule", async () => {
      const A = await buildProjectB(ORGS.A);
      const claimIds = [A.claims.encounters.claimId, A.claims.people.claimId];
      const first = await generate(A, claimIds);
      assert.deepEqual([first.status, first.providerCalls, first.draftsWritten], [201, 1, 1], J(first.body));
      const draftId = first.draftId;
      const beforeReads = await clientReads(A, draftId);
      assert.deepEqual([beforeReads.metadata.status, beforeReads.content.status, beforeReads.markdown.status], [200, 200, 200]);
      await reviewPermissionsAgain(A, A.events, { reviewed_llm_processing_allowed: false });
      const admission = await diagnose(A, A.claims.people.claimId);
      const observedRefusal = await generate(A, claimIds);
      const observedReads = await clientReads(A, draftId);
      report.refusals.A_observed = { admission, generation: [observedRefusal.status, observedRefusal.blockers, observedRefusal.sourceRole, observedRefusal.providerCalls],
        saved_draft: { ...observedReads, markdownText: undefined } };
      assert.deepEqual(admission.provisional, { admitted: false, blocker_codes: ["ai_processing_not_permitted"], source_role: "primary" }, J(admission));
      assert.equal(admission.frontend, "refused");
      assert.match(admission.frontendMessage, /its source's recorded processing permissions do not allow AI processing/);
      const refused = await generate(A, claimIds);
      assert.equal(refused.status, 422, J(refused.body));
      assert.deepEqual([refused.blockers[0], refused.sourceRole, refused.providerCalls, refused.draftsWritten], ["ai_processing_not_permitted", "primary", 0, 0]);
      const after = await clientReads(A, draftId);
      report.refusals.A = { admission, generation: { status: refused.status, blockers: refused.blockers, source_role: refused.sourceRole, required_fix: refused.requiredFix, provider_calls: refused.providerCalls },
        saved_draft_before: { ...beforeReads, markdownText: undefined }, saved_draft_after: { ...after, markdownText: undefined }, release: await releaseAttempts(A, draftId) };
      // G (governing rules): reading the saved draft is not AI processing, so
      // its metadata and content stay readable under the allowed internal use;
      // the internal report (Markdown) is withheld while a cited source's AI
      // processing is not permitted (draft-first availability rule, 2026-11-06).
      assert.deepEqual([after.metadata.status, after.metadata.listed, after.metadata.internalReportAvailable], [200, true, false]);
      assert.deepEqual([after.content.status, after.content.available, after.content.blockedReasons], [200, false, ["processing_permission_not_established"]]);
      assert.deepEqual([after.markdown.status, after.markdown.blockers], [422, ["processing_permission_not_established"]]);
      assert.deepEqual(after.persisted, beforeReads.persisted, "the historical draft is unchanged");
      recordRow("A primary not permitted", { claim: "both", primary: "allowed, AI not permitted", reference: "allowed+AI", strict_eligible: admission.strict?.eligible,
        provisional_admitted: false, operation: "generate internal evidence summary", http: refused.status, provider_invoked: false, draft: "refused", blocker: "ai_processing_not_permitted (primary)", remedy: refused.requiredFix });
      for (const [operation, read] of [["G saved draft metadata", after.metadata.status], ["G saved draft content", after.content.status], ["G saved draft internal Markdown", after.markdown.status]]) {
        recordRow("A primary not permitted", { claim: "saved draft", operation, http: read, provider_invoked: false, draft: read === 200 ? "opened" : "refused" });
      }
    });

    // ---- B: reference roster not permitted + G ----------------------------
    await test("B + G: the roster's AI processing is withdrawn; the permitted service log does not override it; new generation and the internal report are refused and name the roster", async () => {
      const B = await buildProjectB(ORGS.B);
      const claimIds = [B.claims.encounters.claimId, B.claims.people.claimId];
      const first = await generate(B, claimIds);
      assert.equal(first.status, 201, J(first.body));
      const draftId = first.draftId;
      await reviewPermissionsAgain(B, B.roster, { reviewed_llm_processing_allowed: false });
      // The service log's own decision is unchanged and permits AI processing.
      const [eventsDecision] = await query(`SELECT reviewed_llm_processing_allowed FROM kai.intake_sensitivity_review_decisions d WHERE d.intake_sensitivity_profile_id = $1::uuid
        AND NOT EXISTS (SELECT 1 FROM kai.intake_sensitivity_review_decisions s WHERE s.supersedes_decision_id = d.decision_id)`, [B.events.sensitivityProfileId]);
      assert.equal(eventsDecision.reviewed_llm_processing_allowed, true);
      const admission = await diagnose(B, B.claims.people.claimId);
      const observedRefusal = await generate(B, claimIds);
      const observedReads = await clientReads(B, draftId);
      report.refusals.B_observed = { admission, generation: [observedRefusal.status, observedRefusal.blockers, observedRefusal.sourceRole, observedRefusal.providerCalls],
        saved_draft: { ...observedReads, markdownText: undefined } };
      assert.deepEqual(admission.provisional, { admitted: false, blocker_codes: ["ai_processing_not_permitted"], source_role: "reference" }, J(admission));
      assert.match(admission.frontendMessage, /the linked participant register's recorded processing permissions do not allow AI processing \(a permitted service log does not override the register's decision\)/);
      const refused = await generate(B, claimIds);
      assert.deepEqual([refused.status, refused.blockers[0], refused.sourceRole, refused.providerCalls, refused.draftsWritten], [422, "ai_processing_not_permitted", "reference", 0, 0], J(refused.body));
      assert.match(refused.requiredFix, /linked reference source/);
      assert.doesNotMatch(J(refused.body), RAW_IDENTIFIER);
      const after = await clientReads(B, draftId);
      // Repaired (Package 3): the roster's decision now counts for the saved report too, as it does for generation.
      assert.deepEqual([after.metadata.status, after.metadata.internalReportAvailable], [200, false]);
      assert.deepEqual([after.content.status, after.content.blockedReasons], [200, ["processing_permission_not_established"]]);
      assert.deepEqual([after.markdown.status, after.markdown.blockers], [422, ["processing_permission_not_established"]]);
      report.refusals.B = { admission, generation: { status: refused.status, blockers: refused.blockers, source_role: refused.sourceRole, required_fix: refused.requiredFix, provider_calls: refused.providerCalls },
        saved_draft_after_ai_withdrawn: { ...after, markdownText: undefined } };
      recordRow("B roster not permitted", { claim: "both", primary: "allowed+AI", reference: "allowed, AI not permitted", strict_eligible: admission.strict?.eligible, provisional_admitted: false,
        operation: "generate internal evidence summary", http: refused.status, provider_invoked: false, draft: "refused", blocker: "ai_processing_not_permitted (reference)", remedy: refused.requiredFix });
      recordRow("B roster not permitted", { claim: "saved draft", operation: "G saved draft internal Markdown", http: after.markdown.status, provider_invoked: false, draft: "refused", blocker: after.markdown.blockers.join(",") });

      // The roster's allowed use withdrawn entirely: P2-06 itself refuses the
      // cross-source claims (contributing source not permitted).
      await reviewPermissionsAgain(B, B.roster, { reviewed_allowed_use_status: "not_allowed", reviewed_llm_processing_allowed: false });
      const notAllowed = await diagnose(B, B.claims.people.claimId);
      assert.deepEqual([notAllowed.status, notAllowed.strict?.conflict], [409, "derived_measurement_contributing_source_not_permitted"], J(notAllowed));
      assert.equal(notAllowed.frontend, "refused");
      assert.match(notAllowed.frontendMessage, /the linked participant register's recorded allowed use no longer permits this use/);
      const refusedAgain = await generate(B, claimIds);
      assert.deepEqual([refusedAgain.status >= 400, refusedAgain.providerCalls, refusedAgain.draftsWritten], [true, 0, 0], J(refusedAgain.body));
      const afterNotAllowed = await clientReads(B, draftId);
      assert.notEqual(afterNotAllowed.markdown.status, 200, "no report from a source whose use is withdrawn");
      assert.notEqual(afterNotAllowed.content.status, 200, "no content from a source whose use is withdrawn");
      report.refusals.B.roster_use_not_allowed = { admission: notAllowed, generation: [refusedAgain.status, refusedAgain.blockers, refusedAgain.providerCalls], saved_draft: { ...afterNotAllowed, markdownText: undefined } };
      recordRow("B roster use not allowed", { claim: "both", primary: "allowed+AI", reference: "not allowed", strict_eligible: null, provisional_admitted: false, operation: "generate internal evidence summary",
        http: refusedAgain.status, provider_invoked: false, draft: "refused", blocker: refusedAgain.blockers.join(",") || "traceability 409 derived_measurement_contributing_source_not_permitted" });
      for (const [operation, read] of [["G saved draft metadata", afterNotAllowed.metadata.listed ? 200 : `${afterNotAllowed.metadata.status} (not listed)`], ["G saved draft content", afterNotAllowed.content.status], ["G saved draft internal Markdown", afterNotAllowed.markdown.status]]) {
        recordRow("B roster use not allowed", { claim: "saved draft", operation, http: read, provider_invoked: false, draft: read === 200 ? "opened" : "refused" });
      }
    });

    await test("B (browser): the roster-refused claim is shown as not usable in a new draft with the register's remedy; it cannot be selected; the same request from the page is refused", async () => {
      const B = ORGS.B;
      // Restore AI-only withdrawal (allowed use, AI not permitted) so the claim is readable and refused for AI.
      await reviewPermissionsAgain(B, B.roster, { reviewed_llm_processing_allowed: false });
      const bPage = await openPage(browser, { baseUrl, legacyUserId: B.adminUserId });
      try {
        await bPage.goto("/impact-library");
        await bPage.clickNav("Knowledge Studio");
        await bPage.waitFor(() => bPage.visible("#gk-shell-project-select"), "the Project selector");
        await bPage.idle();
        await bPage.selectProject(B.projectId);
        await bPage.idle();
        await bPage.clickTab("Evidence");
        await bPage.idle();
        const row = `[data-client-claim="${B.claims.people.claimId}"]`;
        await bPage.waitFor(async () => (await bPage.attrOf(row, "data-client-claim-provisional-draft")) === "refused", "the server's refusal is shown", { timeout: 30000 });
        assert.match(await bPage.textOf(`${row} [data-client-claim-not-usable]`), /^Not usable in a new internal draft\.$/);
        await bPage.clickVisible(`${row} [data-knowledge-studio-disclosure="claim-not-usable-reason"] > button`, "Why");
        await bPage.waitFor(() => bPage.visible(`${row} [data-client-claim-not-usable-reason]`), "the reason");
        const why = await bPage.textOf(`${row} [data-client-claim-not-usable-reason]`);
        assert.match(why, /The linked participant register's recorded processing permissions do not allow AI processing/);
        assert.equal(await bPage.evaluate(`Boolean(document.querySelector('[data-client-select-claim="${B.claims.people.claimId}"]'))`), false, "no selection control");
        const calls = modelCalls.length;
        const forced = await bPage.api("POST", createEvidenceSummaryPath(B.organizationId), { claim_ids: [B.claims.people.claimId], idempotency_key: `forced-${randomUUID()}`, engagement_id: B.projectId });
        assert.deepEqual([forced.status, forced.body?.blockers?.[0]?.blocking_reason, forced.body?.blockers?.[0]?.evidence?.source_role, modelCalls.length - calls], [422, "ai_processing_not_permitted", "reference", 0]);
        report.browser.roster_refused = { attribute: "refused", head: "Not usable in a new internal draft.", why, forced_request: [forced.status, forced.body?.blockers?.[0]?.blocking_reason] };
        recordRow("B frontend bypass", { claim: "people", reference: "allowed, AI not permitted", provisional_admitted: false, operation: "same-origin POST of a refused id from the page", http: forced.status, provider_invoked: false, draft: "refused" });
      } finally {
        await bPage.close();
      }
    });

    // ---- C: recorded negative review --------------------------------------
    await test("C: Get Kinder's recorded rejection of the people claim is not overridden by provisional drafting; the contacts claim alone still drafts", async () => {
      const C = await buildProjectB(ORGS.C);
      // Claim review follows a completed evidence review (existing rule): the
      // evidence is found supported, the claim is rejected.
      const evidenceQueue = await queueOf(C.organizationId, "evidence_review", C.claims.people.evidenceItemId);
      const evidenceReview = await gkApi("POST", evidenceReviewCompletePath(C.organizationId, C.claims.people.evidenceItemId, evidenceQueue.review_queue_item_id),
        evidenceReviewDecisionBody({ expectedUpdatedAt: new Date(evidenceQueue.updated_at).toISOString(), decision: "supported" }));
      assert.equal(evidenceReview.status, 200, J(evidenceReview.body));
      const claimQueue = await queueOf(C.organizationId, "claim_review", C.claims.people.claimId);
      const rejected = await gkApi("POST", claimReviewCompletePath(C.organizationId, C.claims.people.claimId, claimQueue.review_queue_item_id),
        claimReviewDecisionBody({ expectedUpdatedAt: new Date(claimQueue.updated_at).toISOString(), decision: "rejected" }));
      assert.equal(rejected.status, 200, J(rejected.body));
      const admission = await diagnose(C, C.claims.people.claimId);
      assert.deepEqual(admission.provisional, { admitted: false, blocker_codes: ["claim_reviewed_not_supported"], source_role: null }, J(admission));
      assert.match(admission.frontendMessage, /recorded review found it or its evidence not supported; that decision stands/);
      const refused = await generate(C, [C.claims.encounters.claimId, C.claims.people.claimId]);
      assert.deepEqual([refused.status, refused.body?.error?.code, refused.providerCalls, refused.draftsWritten], [422, "claim_reviewed_not_supported", 0, 0], J(refused.body));
      const contacts = await generate(C, [C.claims.encounters.claimId]);
      assert.deepEqual([contacts.status, contacts.providerCalls, contacts.sentClaimIds], [201, 1, [C.claims.encounters.claimId]]);
      const [decision] = await query("SELECT decision_outcome FROM kai.claim_review_decisions WHERE claim_id = $1::uuid", [C.claims.people.claimId]);
      assert.equal(decision.decision_outcome, "rejected", "the review result is unchanged");
      report.refusals.C = { admission, generation: [refused.status, refused.body?.error?.code, refused.providerCalls], contacts_only: [contacts.status, contacts.sentClaimIds] };
      recordRow("C recorded rejection", { claim: "people", primary: "allowed+AI", reference: "allowed+AI", strict_eligible: admission.strict?.eligible, provisional_admitted: false,
        operation: "generate internal evidence summary", http: refused.status, provider_invoked: false, draft: "refused", blocker: "claim_reviewed_not_supported" });
      recordRow("C recorded rejection", { claim: "encounters only", provisional_admitted: true, operation: "generate internal evidence summary", http: contacts.status, provider_invoked: true, draft: "saved" });
    });

    // ---- D: legacy factual-integrity failure ------------------------------
    await test(`D: a genuine pre-repair claim written by ${LEGACY_REVISION} ('217 completed contacts'), favourably reviewed, stays blocked and never reaches the provider`, async () => {
      const D = ORGS.D;
      await setPeriod(D);
      D.events = await uploadAndPromote(D, events);
      const legacyApi = legacyApiOf(D);
      const recorded = await legacyApi("POST", sourceRecordCountMeasurementPath(D.organizationId, D.events.sourceVersionId), {
        counted_unit: "completed contact", unit_label: "completed contacts", definition_text: "Each data row of the service log records one completed contact.",
        inclusion_rule: "Completed contacts in the reporting period.", exclusion_rule: "Cancelled and no-show contacts." });
      assert.equal(recorded.status, 200, `previous revision's Count records: ${J(recorded.body)}`);
      const evidenceItemId = recorded.body.data.evidenceItem.evidence_item_id;
      let claimId = recorded.body.data.claim?.claim_id ?? null;
      if (!claimId) claimId = (await legacyApi("POST", claimProposalPath(D.organizationId, evidenceItemId), {})).body.data.claim.claim_id;
      const [claim] = await query("SELECT statement FROM kai.claims WHERE claim_id = $1::uuid", [claimId]);
      assert.match(claim.statement, /\b217 completed contacts\b/, "the pre-repair claim asserts unexecuted completed contacts");
      // Get Kinder's favourable review through the existing routes.
      const evidenceQueue = await queueOf(D.organizationId, "evidence_review", evidenceItemId);
      const evidenceReview = await gkApi("POST", evidenceReviewCompletePath(D.organizationId, evidenceItemId, evidenceQueue.review_queue_item_id),
        evidenceReviewDecisionBody({ expectedUpdatedAt: new Date(evidenceQueue.updated_at).toISOString(), decision: "supported" }));
      const claimQueue = await queueOf(D.organizationId, "claim_review", claimId);
      const claimReview = await gkApi("POST", claimReviewCompletePath(D.organizationId, claimId, claimQueue.review_queue_item_id),
        claimReviewDecisionBody({ expectedUpdatedAt: new Date(claimQueue.updated_at).toISOString(), decision: "approved", approvedAudiences: ["internal"] }));
      assert.deepEqual([evidenceReview.status, claimReview.status], [200, 200]);
      for (const dimensionKey of (await gkTrace(D, claimId)).unresolved) await gkApi("POST", coverageInternalAcceptancePath(D.organizationId, claimId, dimensionKey), {});
      const strict = await gkTrace(D, claimId);
      assert.equal(strict.eligible, false);
      assert.ok(strict.blockerCodes.includes("measured_claim_integrity_not_established"), J(strict));
      const admission = await diagnose(D, claimId);
      assert.deepEqual(admission.provisional, { admitted: false, blocker_codes: ["measured_claim_integrity_not_established"], source_role: null }, J(admission));
      const refused = await generate(D, [claimId]);
      assert.deepEqual([refused.status, refused.blockers[0], refused.providerCalls, refused.draftsWritten], [422, "measured_claim_not_currently_eligible", 0, 0], J(refused.body));
      const [unchanged] = await query("SELECT statement FROM kai.claims WHERE claim_id = $1::uuid", [claimId]);
      assert.equal(unchanged.statement, claim.statement, "the historical claim is not rewritten");
      report.refusals.D = { legacy_statement_excerpt: claim.statement.slice(0, 80), reviews: [evidenceReview.status, claimReview.status], strict, admission, generation: [refused.status, refused.blockers, refused.providerCalls] };
      recordRow("D legacy integrity", { claim: "217 'completed contacts' (pre-repair, reviewed+approved)", primary: "allowed+AI", strict_eligible: false, provisional_admitted: false,
        operation: "generate internal evidence summary", http: refused.status, provider_invoked: false, draft: "refused", blocker: "measured_claim_integrity_not_established / measured_claim_not_currently_eligible" });
    });

    // ---- E: stale contributing source + G ---------------------------------
    await test("E + G: a corrected roster promoted as successor makes the 190/67 claims historical for new drafts; the current roster gives new 188/66 identities that draft", async () => {
      const E = await buildProjectB(ORGS.E);
      const oldIds = [E.claims.encounters.claimId, E.claims.people.claimId];
      const first = await generate(E, oldIds);
      assert.equal(first.status, 201, J(first.body));
      const draftId = first.draftId;
      const draftBefore = await query("SELECT b.ordinal, b.text FROM kai.generated_content_blocks b WHERE b.generated_content_draft_id = $1::uuid ORDER BY ordinal", [draftId]);
      const successor = await uploadAndPromote(E, correctedRoster, E.roster.sourceVersionId);
      const admission = await diagnose(E, E.claims.people.claimId);
      assert.deepEqual([admission.status, admission.strict?.conflict, admission.frontend], [409, "derived_measurement_contributing_source_not_current", "refused"], J(admission));
      assert.match(admission.frontendMessage, /has since been replaced, so this is a historical result/);
      const refused = await generate(E, oldIds);
      assert.deepEqual([refused.status >= 400, refused.providerCalls, refused.draftsWritten], [true, 0, 0], J(refused.body));
      const staleReads = await clientReads(E, draftId);
      const current = await reconcile(E, E.events.sourceVersionId, successor.sourceVersionId);
      assert.deepEqual([current.encounters.measured_value, current.people.measured_value], [CORRECTED.eligible, CORRECTED.people]);
      assert.notEqual(current.encounters.source_derived_measurement_id, E.cross.encounters.source_derived_measurement_id);
      const sources = await query("SELECT source_role, source_version_id::text FROM kai.source_derived_measurement_sources WHERE source_derived_measurement_id = $1::uuid ORDER BY source_role", [current.people.source_derived_measurement_id]);
      assert.deepEqual(sources.map((s) => [s.source_role, s.source_version_id]), [["primary", E.events.sourceVersionId], ["reference", successor.sourceVersionId]]);
      const newClaims = { encounters: await interpretAndPropose(E, current.encounters, "encounters"), people: await interpretAndPropose(E, current.people, "people") };
      const newAdmission = await diagnose(E, newClaims.people.claimId);
      assert.deepEqual(newAdmission.provisional, { admitted: true, blocker_codes: [], source_role: null });
      const second = await generate(E, [newClaims.encounters.claimId, newClaims.people.claimId]);
      assert.deepEqual([second.status, second.providerCalls, second.sentClaimIds], [201, 1, [newClaims.encounters.claimId, newClaims.people.claimId].sort()]);
      const blocks = await query(`SELECT b.text FROM kai.generated_content_blocks b WHERE b.generated_content_draft_id = $1::uuid`, [second.draftId]);
      assert.ok(blocks.some((b) => /\b188\b/.test(b.text)) && blocks.some((b) => /\b66\b/.test(b.text)), J(blocks));
      assert.ok(!blocks.some((b) => /\b190\b|\b67 distinct\b/.test(b.text)), "the old figures are not restated as current");
      assert.deepEqual(await query("SELECT b.ordinal, b.text FROM kai.generated_content_blocks b WHERE b.generated_content_draft_id = $1::uuid ORDER BY ordinal", [draftId]), draftBefore, "the historical draft is unchanged");
      assert.equal((await query("SELECT measured_value::int FROM kai.source_derived_measurements WHERE source_derived_measurement_id = $1::uuid", [E.cross.encounters.source_derived_measurement_id]))[0].measured_value, 190, "history is not rewritten");
      assert.notEqual(staleReads.markdown.status, 200, "a report from a superseded contributing version is not delivered as current");
      report.refusals.E = { admission, generation_old: [refused.status, refused.blockers, refused.providerCalls], saved_draft_after_successor: { ...staleReads, markdownText: undefined },
        new_identities: { encounters: [current.encounters.source_derived_measurement_id, current.encounters.measured_value], people: [current.people.source_derived_measurement_id, current.people.measured_value] },
        new_generation: [second.status, second.sentClaimIds] };
      recordRow("E stale roster", { claim: "old 190/67", reference: "superseded", strict_eligible: null, provisional_admitted: false, operation: "generate internal evidence summary", http: refused.status,
        provider_invoked: false, draft: "refused", blocker: refused.blockers.join(",") || "traceability 409 derived_measurement_contributing_source_not_current" });
      for (const [operation, read] of [["G saved draft metadata", staleReads.metadata.listed ? 200 : `${staleReads.metadata.status} (not listed)`], ["G saved draft content", staleReads.content.status], ["G saved draft internal Markdown", staleReads.markdown.status]]) {
        recordRow("E stale roster", { claim: "saved draft", operation, http: read, provider_invoked: false, draft: read === 200 ? "opened" : "refused" });
      }
      recordRow("E current roster", { claim: "new 188/66", provisional_admitted: true, operation: "generate internal evidence summary", http: second.status, provider_invoked: true, draft: "saved" });
    });

    await test("agreement: for every generation attempt the server's admission read predicted whether the provider was called", () => {
      const generations = MATRIX.filter((row) => /^generate/.test(row.operation) && typeof row.provisional_admitted === "boolean");
      assert.ok(generations.length >= 7);
      for (const row of generations) assert.equal(row.provider_invoked, row.provisional_admitted, J(row));
    });
  } finally {
    if (REPORT_PATH) writeFileSync(REPORT_PATH, `${J(report, null, 2)}\n`);
    await page.close().catch(() => {});
    await browser.close();
    restoreRuntime();
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => legacyServer.close(resolve));
    await seedPool.end();
    await ambientPool.end();
    await legacy.pool.end().catch(() => {});
  }
}
