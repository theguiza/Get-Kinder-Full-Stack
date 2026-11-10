import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";

/**
 * Owner Package 4 (2026-11-10): preserve document evidence meaning through
 * claims and drafting, on synthetic Community Impact Project B, on the Cedar
 * Bridge runner's disposable loopback PostgreSQL. Run only by
 *   KAI_COMMUNITY_PROJECT_B_PACKAGE=<package root> KAI_PROJECT_B_DOCUMENT_EVIDENCE=true \
 *     node scripts/kai-cedar-bridge-six-source-acceptance-local-postgres.js
 * after `npm run build`. Skipped otherwise.
 *
 * Package 2 (counting) and Package 3 (measurement-to-draft) acceptances stay
 * the independent proofs of 190/67 and of the measured permission matrix;
 * this spec proves what happens when the ORIGINAL programme notes (TXT) and
 * management review (PDF) join them: three statements chosen from the source
 * text (A programme scope / participation method, B the deduplication
 * instruction, C the preliminary "at least 90" estimate), persisted through
 * the real extraction and claim-proposal routes, their meaning at the
 * admission, model-input, validation, persistence and report boundaries, and
 * the document / roster processing refusals.
 *
 * Real: the intake API, P1 worker, profiler and mupdf worker, the human
 * sensitivity decisions and re-decisions (Review Cockpit), promotion, the
 * cross-source request, job and worker, interpretation and claim-proposal
 * routes, document evidence extraction, P2-06, the organization diagnostic
 * with its provisional admission, the client generation route with the real
 * generator, validators and persistence, the client draft reads, and the
 * built Knowledge Studio bundle in headless Chrome. Simulated at external
 * boundaries only: the session (harness cookie), object storage, the malware
 * scanner and the model provider (patched SDK Messages.create,
 * deterministic). The provider proves what the server sent and that the
 * server's validators and persistence accept or refuse a response; it says
 * nothing about a real model's quality.
 *
 * Fixture setup through the API (labelled "fixture"): organizations, actors,
 * the Project and period, upload / decision / promotion of the four files, the
 * cross-source measurement, its meanings and claims, document extraction and
 * document claim proposals, permission re-decisions. Through the browser
 * (visible, enabled controls only): Evidence (labels, selection), Drafts
 * (generation), opening the saved draft and its report.
 */

const RUNNER_DATABASE_URL = process.env.KAI_CEDAR_ACCEPTANCE_DATABASE_URL;
const RUNNER_DATABASE_NAME = process.env.KAI_CEDAR_ACCEPTANCE_DATABASE_NAME;
const PACKAGE = process.env.KAI_COMMUNITY_PROJECT_B_PACKAGE;
const ENABLED = process.env.KAI_PROJECT_B_DOCUMENT_EVIDENCE === "true";
const CHROME = process.env.KAI_P3_CHROME;
const WORKDIR = process.env.KAI_P3_WORKDIR;
const REPORT_PATH = process.env.KAI_CEDAR_BRIDGE_REPORT;

const EXPECTED = Object.freeze({ raw: 217, deduplicated: 215, completed: 197, in_period: 192, eligible: 190, people: 67, both: 11 });
const PERIOD = Object.freeze({ start: "2024-04-01", end: "2025-03-31" });
const RAW_IDENTIFIER = /\bCE\d{4}\b|\bCBR\d{3}\b/;
// Chosen by reading the original files (not by KAI's output); the locator is what each must carry.
const CASES = Object.freeze({
  A: { file: "notes", anchor: "both patterns are legitimate", role: "source_limitation",
    locator: { unit: "text_lines", line_start: 7, line_end: 7, sentence_start: 3, sentence_end: 5 } },
  B: { file: "review", anchor: "must be deduplicated for the organization-wide reach figure", role: "source_method_or_instruction",
    locator: { unit: "pdf_page_blocks", page_number: 1, block_start: 10, block_end: 10, sentence_start: 4, sentence_end: 4 } },
  C: { file: "review", anchor: "at least 90 different people", role: "source_estimate",
    locator: { unit: "pdf_page_blocks", page_number: 2, block_start: 3, block_end: 5, sentence_start: 1, sentence_end: 2 } },
});

function assertLoopbackDatabaseUrl(urlString) {
  const host = new URL(urlString).hostname.toLowerCase();
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw new Error(`Package 4 acceptance refused a non-loopback database URL host: ${host}`);
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("Package 4 acceptance isolation: a non-loopback runner URL is refused", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
});

if (!ENABLED || !RUNNER_DATABASE_URL || !PACKAGE || !CHROME || !WORKDIR || !existsSync(join(PACKAGE, "01_UPLOAD_TO_KAI"))) {
  test("Package 4 document-evidence acceptance requires its runner mode (KAI_PROJECT_B_DOCUMENT_EVIDENCE) and KAI_COMMUNITY_PROJECT_B_PACKAGE", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_DATABASE_URL);
  await runPackage4Acceptance();
}

// ---------------------------------------------------------------------------
// Minimal Chrome DevTools protocol client (verbatim from the Package 3
// acceptance). Controls are found and activated only while visible and
// enabled; a mounted view or disclosure is revealed only by clicking its own
// visible tab or toggle.
// ---------------------------------------------------------------------------

async function launchChrome() {
  const profileDir = join(WORKDIR, "chrome-profile-package-4");
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

async function runPackage4Acceptance() {
  const J = JSON.stringify;
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-unused-dummy-key";
  // The external model boundary: deterministic, and every request recorded
  // exactly as serialized. By default the response restates each claim the
  // server sent and also asserts "approved" / "released", which the server
  // must ignore. A test may set `respond` to return chosen block text per
  // claim (the permitted / prohibited outputs below).
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const messagesPrototype = Object.getPrototypeOf(new Anthropic({ apiKey: "sk-ant-test-unused-dummy-key" }).messages);
  const modelCalls = [];
  let respond = null;
  messagesPrototype.create = async function deterministicCreate(payload) {
    const requestBody = JSON.parse(payload.messages[0].content);
    modelCalls.push({ claims: requestBody.claims, requestedAudience: requestBody.requestedAudience ?? null, system: payload.system, serialized: J(payload) });
    return { content: [{ type: "text", text: J({ approved: true, draftStatus: "released",
      blocks: requestBody.claims.map((claim) => ({ text: (respond && respond(claim)) || claim.claimStatement, citations: [{ claimId: claim.claimId, evidenceItemId: claim.evidenceItemId }] })) }) }] };
  };

  const { Pool } = await import("pg");
  const express = (await import("express")).default;
  const ambientPool = (await import("../Backend/db/pg.js")).default;
  const seedPool = new Pool({ connectionString: RUNNER_DATABASE_URL, ssl: false, max: 4 });
  const query = async (sql, params = []) => (await seedPool.query(sql, params)).rows;
  const { findOrCreateKaiUserByLegacyPublicUserdataId } = await import("../Backend/kai/db/kaiQueries.js");
  const DOC = await import("../Backend/kai/validators/kaiDocumentEvidenceValidators.js");
  const {
    BASE_PATH, claimProposalPath, claimTraceabilityPath, clientInternalDraftPath, clientInternalDraftsPath, clientInternalReportMarkdownPath,
    createEvidenceSummaryPath, errorText, evidenceExtractionPath, sourceCandidateDecisionPath,
  } = await import("../frontend/impactEvidenceLibraryLogic.js");
  const { claimUseDiagnosis, claimDraftAdmission, provisionalDraftRefusalMessage } = await import("../frontend/knowledgeStudio/clientEvidenceWorkflowLogic.js");
  const { confirmUploadPath, createBatchPath, fileReservationsPath, requestUploadUrlPath } = await import("../frontend/kaiWebIntakeLogic.js");
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

  const ambientTarget = (await ambientPool.query("SELECT current_database() AS database_name, inet_server_addr()::text AS server_addr")).rows[0];
  assert.equal(ambientTarget.database_name, RUNNER_DATABASE_NAME);
  assert.ok(["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(ambientTarget.server_addr));

  // --- the four original upload files (never the answer-key folder) ---------
  const UPLOAD_DIR = join(PACKAGE, "01_UPLOAD_TO_KAI");
  const fileOf = (key, name, extension, mime) => { const bytes = readFileSync(join(UPLOAD_DIR, name)); return { key, name, extension, mime, bytes, checksum: sha256(bytes) }; };
  const FILES = {
    roster: fileOf("roster", "02_Community_Participant_Roster.csv", ".csv", "text/csv"),
    events: fileOf("events", "03_Community_Service_Log.csv", ".csv", "text/csv"),
    notes: fileOf("notes", "05_Programme_Coordination_Notes.txt", ".txt", "text/plain"),
    review: fileOf("review", "06_Community_Review.pdf", ".pdf", "application/pdf"),
  };

  // Truthful synthetic classifications: the CSVs carry pseudonymous
  // participant identifiers; the documents carry no participant records (the
  // notes are internal staff working material). Internal use and AI allowed.
  const ABSENT = Object.freeze({
    reviewed_personal_data_status: "absent", reviewed_minor_data_status: "absent", reviewed_health_housing_justice_immigration_status: "absent",
    reviewed_indigenous_governance_status: "absent", reviewed_staff_notes_status: "absent", reviewed_story_testimonial_status: "absent",
    reviewed_small_cell_risk_status: "absent", reviewed_financial_records_status: "absent", reviewed_consent_basis_status: "unknown",
    reviewed_allowed_use_status: "allowed", reviewed_llm_processing_allowed: true, reviewed_product_learning_allowed: false,
    reviewed_public_use_allowed: false, reviewed_funder_use_allowed: false,
  });
  const DECISIONS = Object.freeze({
    roster: { ...ABSENT, reviewed_personal_data_status: "present" }, events: { ...ABSENT, reviewed_personal_data_status: "present" },
    notes: { ...ABSENT, reviewed_staff_notes_status: "present" }, review: ABSENT,
  });

  // --- organizations (one per scenario) --------------------------------------
  const ORGS = Object.fromEntries(["P", "D", "R"].map((key, index) => [key, {
    key, organizationId: `0d000000-0000-4000-8000-0000000000${String(index + 1).padStart(2, "0")}`,
    projectId: `7d000000-0000-4000-8000-0000000000${String(index + 1).padStart(2, "0")}`, adminUserId: 2001 + index * 2,
  }]));
  const USERS = Object.freeze({ gkReviewer: 1991 });
  for (const legacyId of [USERS.gkReviewer, ...Object.values(ORGS).map((org) => org.adminUserId)]) {
    await query("INSERT INTO public.userdata (id) VALUES ($1) ON CONFLICT DO NOTHING", [legacyId]);
  }
  const gkUser = await findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: USERS.gkReviewer, email: `user${USERS.gkReviewer}@package4.test` });
  await query("INSERT INTO kai.user_roles (user_id, role_id) SELECT $1::uuid, role_id FROM kai.roles WHERE role_name = 'gk_reviewer'", [gkUser.user_id]);
  for (const org of Object.values(ORGS)) {
    await query("INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES ($1::uuid, $2, $3)", [org.organizationId, `Project B ${org.key} (synthetic, P4)`, `project-b-p4-${org.key.toLowerCase()}`]);
    await query("INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code, project_metadata) VALUES ($1::uuid, $2::uuid, $3, '{}'::jsonb)", [org.projectId, org.organizationId, `Project B ${org.key} FY2024-25`]);
    const [gkOrganization] = await query("INSERT INTO public.organizations (name, status) VALUES ($1, 'approved') RETURNING id", [`Project B ${org.key} (synthetic, P4)`]);
    await query("INSERT INTO kai.gk_organization_bindings (gk_organization_id, kai_organization_id, status) VALUES ($1, $2::uuid, 'active')", [gkOrganization.id, org.organizationId]);
    await query("INSERT INTO public.user_org_memberships (org_id, user_id, role, is_active) VALUES ($1, $2, 'admin', true)", [gkOrganization.id, org.adminUserId]);
    await query("INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status) VALUES ($1::uuid, $2::uuid, 'gk_reviewer', 'active')", [org.organizationId, gkUser.user_id]);
  }

  // --- external boundaries ---------------------------------------------------
  const objects = new Map();
  const signedTargets = new Map();
  let generation = 1890000000000001n;
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
    if (match) req.user = { id: Number(match[1]), email: `user${match[1]}@package4.test` };
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
  const orgPath = (organizationId) => `${BASE_PATH}/admin/organizations/${organizationId}`;
  const COCKPIT = `${BASE_PATH}/admin/review-cockpit`;
  const blockersOf = (response) => (response.body?.blockers || response.body?.error?.blockers || []).map((b) => b.blocking_reason || b.code || b.reason);

  const report = { generated_at: new Date().toISOString(), bundle_sha256: bundleSha, files: {}, cases: {}, comparability: {}, admission: {}, provider: {}, validator: {}, browser: {}, drafts: {}, matrix: [] };
  const MATRIX = report.matrix;
  const recordRow = (scenario, row) => { MATRIX.push({ scenario, ...row }); return row; };

  const counts = async (organizationId) => (await query(`SELECT
      (SELECT count(*) FROM kai.generated_content_drafts WHERE organization_id = $1::uuid)::int AS drafts,
      (SELECT count(*) FROM kai.claim_review_decisions WHERE organization_id = $1::uuid)::int AS claim_review_decisions,
      (SELECT count(*) FROM kai.evidence_review_decisions WHERE organization_id = $1::uuid)::int AS evidence_review_decisions,
      (SELECT count(*) FROM kai.coverage_review_decisions WHERE organization_id = $1::uuid)::int AS coverage_review_decisions,
      (SELECT count(*) FROM kai.human_authority_decisions WHERE organization_id = $1::uuid)::int AS human_authority_decisions,
      (SELECT count(*) FROM kai.export_candidates WHERE organization_id = $1::uuid)::int AS export_candidates`, [organizationId]))[0];
  const gkTrace = async (org, claimId) => {
    const traced = await gkApi("GET", claimTraceabilityPath(org.organizationId, claimId, "internal"));
    return { status: traced.status, eligible: traced.body?.data?.eligible ?? null, blockerCodes: traced.body?.data?.blockerCodes ?? blockersOf(traced) };
  };
  // The administrator's diagnostic (the read the bundle makes) and the frontend's own projection of it.
  const diagnose = async (org, claimId) => {
    const read = await org.api("GET", claimTraceabilityPath(org.organizationId, claimId, "internal"));
    const diagnosis = claimUseDiagnosis({ statusCode: read.status, body: read.body });
    const frontend = claimDraftAdmission({ claimId, evidenceSourceVersionIsCurrent: true }, diagnosis);
    return { status: read.status, strictEligible: read.body?.data?.eligible ?? null, provisional: read.body?.data?.provisional_internal_draft ?? null,
      frontend, frontendMessage: frontend === "refused" ? provisionalDraftRefusalMessage(diagnosis) : null };
  };
  const generate = async (org, claimIds) => {
    const calls = modelCalls.length;
    const before = await counts(org.organizationId);
    const created = await org.api("POST", createEvidenceSummaryPath(org.organizationId), { claim_ids: claimIds, idempotency_key: `p4-${org.key}-${randomUUID()}`, engagement_id: org.projectId });
    const after = await counts(org.organizationId);
    const sent = modelCalls.slice(calls);
    const blockers = created.body?.blockers || [];
    return { status: created.status, body: created.body, blockers: blockersOf(created), validatorKeys: blockers.map((b) => b.validator_key),
      assertionClasses: blockers.flatMap((b) => b.evidence?.assertion_classes || []), providerCalls: sent.length, sent,
      sentClaimIds: sent.flatMap((call) => call.claims.map((c) => c.claimId)).sort(), draftsWritten: after.drafts - before.drafts,
      sourceRole: blockers.find((b) => b.evidence?.source_role)?.evidence.source_role ?? null, draftId: created.body?.data?.generatedContentDraftId ?? null,
      customerMessage: created.status >= 400 ? errorText({ statusCode: created.status, body: created.body }) : null };
  };

  // Fixture: upload one file through the intake API, run P1, decide and promote it.
  const uploadAndPromote = async (org, file) => {
    const { api, organizationId, projectId } = org;
    const batch = await api("POST", createBatchPath(), { organization_id: organizationId, engagement_id: projectId, batch_code: `p4-${file.key}`, idempotency_key: `batch-${randomUUID()}` });
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
    assert.ok(sensitivity, `${file.key}: sensitivity profile`);
    const decided = await api("POST", `${COCKPIT}/sensitivity-profiles/${sensitivity.intake_sensitivity_profile_id}/decision?organization_id=${organizationId}`, {
      expected_updated_at: new Date(sensitivity.updated_at).toISOString(), review_queue_item_id: sensitivity.review_queue_item_id, decision: "reviewed", reviewed_snapshot: DECISIONS[file.key] });
    assert.equal(decided.status, 200, J(decided.body));
    const [candidate] = await query("SELECT intake_source_candidate_id::text FROM kai.intake_source_candidates WHERE intake_sensitivity_profile_id = $1::uuid", [sensitivity.intake_sensitivity_profile_id]);
    const promoted = await api("POST", sourceCandidateDecisionPath(organizationId, candidate.intake_source_candidate_id), { outcome: "promoted", reviewed_source_type: "organization_primary_record" });
    assert.equal(promoted.status, 200, J(promoted.body));
    const [version] = await query("SELECT source_version_id::text, source_id::text, is_current FROM kai.source_versions WHERE intake_sensitivity_profile_id = $1::uuid", [sensitivity.intake_sensitivity_profile_id]);
    assert.equal(version.is_current, true);
    return { key: file.key, intakeFileId, sensitivityProfileId: sensitivity.intake_sensitivity_profile_id, sourceVersionId: version.source_version_id, sourceId: version.source_id };
  };
  // The administrator reviews one source's processing permissions again (Review Cockpit review-work, then a superseding decision).
  const reviewPermissionsAgain = async (org, source, patch) => {
    const work = await org.api("POST", `${COCKPIT}/sensitivity-profiles/${source.sensitivityProfileId}/review-work?organization_id=${org.organizationId}`, {});
    const [queue] = await query(`SELECT review_queue_item_id::text, updated_at FROM kai.review_queue_items
      WHERE organization_id = $1::uuid AND queue_type = 'sensitivity_review' AND target_object_id = $2::uuid ORDER BY created_at DESC LIMIT 1`, [org.organizationId, source.sensitivityProfileId]);
    const decided = await org.api("POST", `${COCKPIT}/sensitivity-profiles/${source.sensitivityProfileId}/decision?organization_id=${org.organizationId}`, {
      expected_updated_at: new Date(queue.updated_at).toISOString(), review_queue_item_id: queue.review_queue_item_id, decision: "reviewed",
      reviewed_snapshot: { ...DECISIONS[source.key], ...patch } });
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
  const reconcile = async (org) => {
    const queued = await org.api("POST", crossSourceMeasurementsPath(org.organizationId), { primary_source_version_id: org.events.sourceVersionId,
      reference_source_version_id: org.roster.sourceVersionId, mapping: await mappingFor(org, org.events.sourceVersionId, org.roster.sourceVersionId) });
    assert.equal(queued.status, 202, J(queued.body));
    await reconciliationDispatcher.whenIdle();
    const read = await org.api("GET", crossSourceReconciliationJobPath(org.organizationId, queued.body.data.reconciliationJob.reconciliation_job_id));
    assert.equal(read.body.data.reconciliationJob.job_state, "succeeded", J(read.body));
    const byMetric = Object.fromEntries(read.body.data.measurements.map((m) => [m.definition.metric, m]));
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
    const proposed = await org.api("POST", claimProposalPath(org.organizationId, stated.body.data.evidenceItem.evidence_item_id), {});
    assert.ok([200, 201].includes(proposed.status), J(proposed.body));
    return { claimId: proposed.body.data.claim.claim_id, evidenceItemId: stated.body.data.evidenceItem.evidence_item_id, measurementId: measurement.source_derived_measurement_id, statement: proposed.body.data.claim.statement };
  };
  const documentRows = async (org, sourceVersionId) => query(`SELECT e.evidence_item_id::text, e.source_version_id::text, e.statement, e.evidence_review_status,
      l.locator_type, l.coordinates FROM kai.evidence_items e JOIN kai.source_locators l ON l.source_locator_id = e.source_locator_id
     WHERE e.organization_id = $1::uuid AND e.source_version_id = $2::uuid AND e.evidence_type = 'source_document_statement' ORDER BY e.created_at, e.evidence_item_id`, [org.organizationId, sourceVersionId]);
  // Fixture (the supported document route): extraction on the promoted version.
  const extract = async (org, source) => {
    const extracted = await org.api("POST", evidenceExtractionPath(org.organizationId, source.sourceVersionId), {});
    assert.equal(extracted.status, 200, J(extracted.body));
    assert.equal(extracted.body.data.documentEvidence.outcome, "statements_extracted", J(extracted.body.data.documentEvidence));
    return extracted.body.data;
  };
  // Fixture (the supported claim route): propose the claim of the case's persisted evidence.
  const proposeCase = async (org, key) => {
    const spec = CASES[key];
    const row = (await documentRows(org, org[spec.file].sourceVersionId)).find((candidate) => candidate.statement.includes(spec.anchor));
    assert.ok(row, `case ${key}: the statement was persisted as evidence`);
    const proposed = await org.api("POST", claimProposalPath(org.organizationId, row.evidence_item_id), {});
    assert.ok([200, 201].includes(proposed.status), J(proposed.body));
    return { key, claimId: proposed.body.data.claim.claim_id, evidenceItemId: row.evidence_item_id, statement: proposed.body.data.claim.statement,
      evidenceStatement: row.statement, coordinates: row.coordinates, sourceVersionId: row.source_version_id };
  };
  const buildMeasured = async (org) => {
    await setPeriod(org);
    org.roster = await uploadAndPromote(org, FILES.roster);
    org.events = await uploadAndPromote(org, FILES.events);
    org.cross = await reconcile(org);
    assert.deepEqual([org.cross.encounters.measured_value, org.cross.people.measured_value], [EXPECTED.eligible, EXPECTED.people]);
    org.claims = { encounters: await interpretAndPropose(org, org.cross.encounters, "encounters"), people: await interpretAndPropose(org, org.cross.people, "people") };
    return org;
  };
  const clientReads = async (org, draftId) => {
    const list = await org.api("GET", clientInternalDraftsPath(org.organizationId, org.projectId));
    const detail = await org.api("GET", clientInternalDraftPath(org.organizationId, org.projectId, draftId));
    const markdown = await org.api("GET", clientInternalReportMarkdownPath(org.organizationId, org.projectId, draftId));
    return { listed: (list.body?.data?.items || []).some((entry) => entry.generatedContentDraftId === draftId), detail: detail.status, markdown: markdown.status,
      // The route serves the report as a Markdown attachment (raw text).
      markdownText: typeof markdown.body === "string" ? markdown.body : markdown.body?.data?.markdown ?? null, markdownBlockers: blockersOf(markdown) };
  };

  const browser = await launchChrome();
  const page = await openPage(browser, { baseUrl, legacyUserId: ORGS.P.adminUserId });
  const P = ORGS.P;

  try {
    await test("0: the four original upload files match the package checksum manifest; nothing from the answer-key folder is a source; the tested bundle is the built one", async () => {
      const manifest = JSON.parse(readFileSync(join(PACKAGE, "03_ANSWER_KEY_DO_NOT_UPLOAD", "Community_File_Checksums.json"), "utf8"));
      for (const file of Object.values(FILES)) {
        const entry = manifest.find((candidate) => candidate.relative_path === `01_UPLOAD_TO_KAI/${file.name}`);
        assert.ok(entry, file.name);
        assert.deepEqual([file.checksum, file.bytes.byteLength], [entry.sha256, entry.bytes], file.name);
        report.files[file.key] = { name: file.name, sha256: file.checksum, bytes: file.bytes.byteLength };
      }
      assert.match(bundleSha, /^[0-9a-f]{64}$/);
    });

    // ---- Positive scenario P ----------------------------------------------
    await test("P1 (fixture, API): Project, period and the four files decided and promoted; the persisted cross-source measurements are 190 contacts / 67 people with both versions", async () => {
      await buildMeasured(P);
      P.notes = await uploadAndPromote(P, FILES.notes);
      P.review = await uploadAndPromote(P, FILES.review);
      const rows = await query(`SELECT definition->>'metric' AS metric, measured_value::int, component_counts FROM kai.source_derived_measurements
        WHERE organization_id = $1::uuid AND measurement_family = 'cross_source_reach'`, [P.organizationId]);
      const byMetric = Object.fromEntries(rows.map((row) => [row.metric, row]));
      const c = byMetric.distinct_people_served.component_counts;
      const stages = { raw: c.physical_record_count, deduplicated: c.distinct_event_count, completed: c.completed_event_count, in_period: c.in_period_completed_event_count,
        eligible: byMetric.eligible_linked_encounters.measured_value, people: byMetric.distinct_people_served.measured_value, both: byMetric.people_in_more_than_one_group.measured_value };
      assert.deepEqual(stages, EXPECTED);
      assert.equal(c.conflicting_event_identity_count, 0);
      for (const label of ["encounters", "people"]) {
        const sources = await query(`SELECT source_role, source_version_id::text FROM kai.source_derived_measurement_sources WHERE source_derived_measurement_id = $1::uuid ORDER BY source_role`, [P.claims[label].measurementId]);
        assert.deepEqual(sources.map((s) => [s.source_role, s.source_version_id]), [["primary", P.events.sourceVersionId], ["reference", P.roster.sourceVersionId]]);
        assert.match(P.claims[label].statement, /2 duplicate copies counted once; excluded 5 outside period, 2 unmatched, 0 conflicting\./, "Project B wording unchanged by the conflict correction");
      }
      report.measurement = { stages, claims: Object.fromEntries(Object.entries(P.claims).map(([k, v]) => [k, v.statement])) };
    });

    await test("P2 (fixture, the supported document route): the TXT and PDF statements persist with locators; replay writes nothing; the three cases are found where the source puts them", async () => {
      const extracted = { notes: await extract(P, P.notes), review: await extract(P, P.review) };
      const rows = { notes: await documentRows(P, P.notes.sourceVersionId), review: await documentRows(P, P.review.sourceVersionId) };
      assert.deepEqual([rows.notes.length, rows.review.length], [17, 30], "persisted statement evidence");
      for (const key of ["notes", "review"]) {
        const replay = await P.api("POST", evidenceExtractionPath(P.organizationId, P[key].sourceVersionId), {});
        assert.deepEqual([replay.status, replay.body.data.replayed, replay.body.data.evidenceItems.length], [200, true, rows[key].length], key);
        assert.equal((await documentRows(P, P[key].sourceVersionId)).length, rows[key].length);
        for (const row of rows[key]) {
          assert.equal(row.locator_type, "document_text_span");
          assert.equal(row.statement, DOC.composeDocumentEvidenceStatement({ excerpt: DOC.excerptFromDocumentEvidenceStatement(row.statement), coordinates: row.coordinates }));
        }
      }
      // The proposed roles the extractor reported in its response (not persisted as a column).
      const roles = Object.fromEntries(Object.entries(extracted).map(([key, data]) => [key, (data.documentEvidence.statements || []).length]));
      report.extraction = { persisted: { notes: rows.notes.length, review: rows.review.length }, statements_reported: roles };
      // Independent location of each anchor in the raw bytes.
      const mupdf = await import("mupdf");
      const pdfPageOf = (bytes, text) => {
        const doc = mupdf.Document.openDocument(new Uint8Array(bytes), "application/pdf");
        let found = 0;
        for (let i = 0; i < doc.countPages(); i += 1) if (doc.loadPage(i).toStructuredText().asText().replace(/\s+/g, " ").includes(text)) found = i + 1;
        doc.destroy();
        return found;
      };
      for (const [key, spec] of Object.entries(CASES)) {
        const row = rows[spec.file].find((candidate) => candidate.statement.includes(spec.anchor));
        assert.ok(row, key);
        assert.deepEqual(Object.fromEntries(Object.keys(spec.locator).map((k) => [k, row.coordinates[k]])), spec.locator, `case ${key} locator`);
        if (spec.file === "notes") {
          const line = FILES.notes.bytes.toString("utf8").split("\n").findIndex((l) => l.includes(spec.anchor)) + 1;
          assert.ok(row.coordinates.line_start <= line && line <= row.coordinates.line_end, key);
        } else {
          assert.equal(row.coordinates.page_number, pdfPageOf(FILES.review.bytes, spec.anchor), key);
        }
        const responseStatement = extracted[spec.file].documentEvidence.statements.find((s) => s.evidence_item_id === row.evidence_item_id);
        report.cases[key] = { source: FILES[spec.file].name, source_version_id: row.source_version_id, locator: DOC.documentLocatorLabel(row.coordinates), coordinates: row.coordinates,
          extractor_assertion_kind: responseStatement?.assertion_kind ?? null, evidence_statement: row.statement, evidence_review_status: row.evidence_review_status };
      }
    });

    await test("P3 (fixture, the supported claim route): the three claims restate their excerpts as source-reported; reload recomputes the same meaning; no review was manufactured", async () => {
      const before = await counts(P.organizationId);
      P.docs = {};
      for (const key of Object.keys(CASES)) P.docs[key] = await proposeCase(P, key);
      for (const [key, doc] of Object.entries(P.docs)) {
        const excerpt = DOC.excerptFromDocumentEvidenceStatement(doc.evidenceStatement);
        assert.equal(doc.statement, DOC.composeDocumentClaimStatement({ excerpt, coordinates: doc.coordinates }), key);
        // Independent reload of the persisted claim row.
        const [claimRow] = await query("SELECT statement, claim_type, claim_status, evidence_item_id::text FROM kai.claims WHERE claim_id = $1::uuid", [doc.claimId]);
        assert.deepEqual([claimRow.statement, claimRow.claim_type, claimRow.evidence_item_id], [doc.statement, "finding", doc.evidenceItemId]);
        const codes = DOC.documentGenerationLimitationCodes(claimRow.statement);
        assert.equal(DOC.documentStatementRole(DOC.excerptFromDocumentClaimStatement(claimRow.statement)), CASES[key].role, key);
        report.cases[key] = { ...report.cases[key], claim_id: doc.claimId, claim_type: claimRow.claim_type, claim_status: claimRow.claim_status, claim_statement: claimRow.statement,
          role_after_reload: CASES[key].role, limitation_codes_after_reload: codes };
      }
      assert.ok(report.cases.C.limitation_codes_after_reload.includes("document.source_estimate"));
      assert.ok(report.cases.C.limitation_codes_after_reload.includes("document.contains_uncertainty"));
      assert.ok(report.cases.B.limitation_codes_after_reload.includes("document.method_or_instruction"));
      assert.ok(!report.cases.A.limitation_codes_after_reload.some((code) => ["document.source_estimate", "document.method_or_instruction"].includes(code)));
      const after = await counts(P.organizationId);
      assert.deepEqual([after.claim_review_decisions, after.evidence_review_decisions, after.coverage_review_decisions], [before.claim_review_decisions, before.evidence_review_decisions, before.coverage_review_decisions]);
    });

    await test("P4: the 90-person estimate and the 67-person measurement are not shown to share scope; neither replaces the other", async () => {
      const estimate = DOC.excerptFromDocumentClaimStatement(P.docs.C.statement);
      const reviewRows = await documentRows(P, P.review.sourceVersionId);
      const caveat = reviewRows.find((row) => row.statement.includes("Repeat attendance, programme overlap, cancellation codes and the roster join had not been checked"));
      assert.ok(caveat, "the source's own caveat on the estimate is persisted evidence");
      const [people] = await query("SELECT definition, component_counts FROM kai.source_derived_measurements WHERE source_derived_measurement_id = $1::uuid", [P.claims.people.measurementId]);
      const dimensions = {
        entity: { estimate: "\"different people\" from \"a rough tally of session lists and referral appointments, not a distinct-person calculation\"", measurement: "distinct roster-linked participant identifiers (exact match to the register)", equivalent: false },
        period: { estimate: "FY 2024-25 (stated)", measurement: `${people.definition.period.period_start} to ${people.definition.period.period_end} by day`, equivalent: "not established (the estimate gives no dates)" },
        programmes: { estimate: "direct CC or RA service", measurement: "CC and RA groups (field_3)", equivalent: "plausibly the same, not established" },
        eligibility: { estimate: "repeat attendance, overlap, cancellation codes and the roster join not checked (source caveat)", measurement: "completed status, in period, roster match, duplicates counted once", equivalent: false },
      };
      assert.match(estimate, /rough tally/);
      assert.match(estimate, /not a distinct-person calculation/);
      assert.equal(people.component_counts.distinct_person_count, 67);
      report.comparability = { estimate_excerpt: estimate, estimate_locator: report.cases.C.locator, caveat_statement: caveat.statement, measurement: P.claims.people.statement, dimensions,
        conclusion: "Equivalent scope is not established (entity and eligibility rules differ by the source's own account), so 90 and 67 are not presented as a contradiction or as a discrepancy to resolve; the estimate is kept with its qualifiers and the 67 keeps its linked-source basis." };
    });

    await test("P5: strict P2-06 stays 'not eligible' while the provisional internal admission admits all five claims; no approval exists", async () => {
      for (const [label, claimId] of [["encounters", P.claims.encounters.claimId], ["people", P.claims.people.claimId], ...Object.entries(P.docs).map(([k, d]) => [k, d.claimId])]) {
        const strict = await gkTrace(P, claimId);
        const admission = await diagnose(P, claimId);
        assert.equal(strict.eligible, false, J(strict));
        assert.deepEqual([admission.status, admission.provisional], [200, { admitted: true, blocker_codes: [], source_role: null }], `${label}: ${J(admission)}`);
        assert.equal(admission.frontend, "admitted");
        report.admission[label] = { strict_eligible: strict.eligible, strict_blockers: strict.blockerCodes, provisional: admission.provisional };
      }
      P.approvalsBefore = await counts(P.organizationId);
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
    const revealRow = (row) => page.evaluate(`(() => { const el = document.querySelector(${J(row)}); if (el && el.offsetParent === null) { for (let n = el; n && n !== document.body; n = n.parentElement) {
      if (n.hidden && n.dataset.knowledgeStudioReveal) document.querySelector('[data-knowledge-studio-reveal-toggle="' + n.dataset.knowledgeStudioReveal + '"]')?.click(); } } return true; })()`);

    await test("P6 (browser): Evidence names the estimate and the method as what they are; the administrator selects both measurements and the qualified estimate", async () => {
      await openStudio("Evidence");
      const bundleRequest = page.requests().find((r) => new URL(r.url).pathname === "/js/bundles/entry.js");
      assert.equal(bundleRequest?.status, 200, "the page ran the built bundle");
      for (const label of ["encounters", "people", "C"]) {
        const claimId = label === "C" ? P.docs.C.claimId : P.claims[label].claimId;
        const row = `[data-client-claim="${claimId}"]`;
        await page.waitFor(async () => (await page.attrOf(row, "data-client-claim-provisional-draft")) === "admitted", `${label}: the server's admission is shown`, { timeout: 30000 });
        await revealRow(row);
        await page.waitFor(() => page.visible(row), `${label} row visible`);
        assert.match(await page.textOf(row), /Usable in a provisional internal draft now/);
        await page.clickVisible(`[data-client-select-claim="${claimId}"]`, `${label}: Use in an internal draft`);
        await page.waitFor(() => page.evaluate(`document.querySelector('[data-client-select-claim="${claimId}"]').checked === true`), `${label} selected`);
      }
      // The labels the page shows for document findings (visible text of the finding badges).
      const labels = await page.evaluate(`[...document.querySelectorAll('[data-finding-type="source_document_statement"]')].filter((el) => el.offsetParent !== null).map((el) => el.innerText.trim())`);
      assert.ok(labels.includes("From a document: the source's estimate (not calculated by KAI)"), J(labels));
      assert.ok(labels.includes("From a document: the source's method or guidance (not a completed step)"), J(labels));
      // The finding that holds the estimate's claim row shows its statement and its label.
      const cFinding = await page.evaluate(`(() => { let n = document.querySelector('[data-client-claim="${P.docs.C.claimId}"]');
        while (n && !n.querySelector('[data-finding-type]')) n = n.parentElement; return n ? n.innerText : null; })()`);
      assert.match(cFinding, /Source-reported, not independently verified|at least 90 different people/);
      assert.match(cFinding, /From a document: the source's estimate \(not calculated by KAI\)/);
      report.browser.evidence = { document_labels: [...new Set(labels)], selected: ["encounters", "people", "C"] };
      assert.equal(await page.evaluate(`document.querySelector('[data-client-select-claim="${P.docs.B.claimId}"]')?.checked ?? null`) === true, false, "the method note is not selected");
    });

    await test("P7 (browser): Drafts -> Generate internal evidence summary; the provider receives exactly the three claims with their meanings and the document instruction", async () => {
      await page.clickTab("Drafts");
      await page.idle();
      await page.waitFor(async () => Boolean(await page.textOf("[data-client-draft-selected-claims]")), "the selected findings");
      assert.equal((await page.textOf("[data-client-draft-selected-claims]")).split("\n").filter(Boolean).length, 3);
      const calls = modelCalls.length;
      const mark = page.mark();
      await page.clickButton("Generate internal evidence summary");
      await page.waitFor(() => page.visible("[data-client-generated-draft]"), "the created draft", { timeout: 60000 });
      await page.idle();
      const posted = page.requestsSince(mark).find((r) => r.method === "POST");
      assert.deepEqual([new URL(posted.url).pathname, posted.status], [createEvidenceSummaryPath(P.organizationId), 201]);
      const sent = JSON.parse(posted.postData);
      const expectedIds = [P.claims.encounters.claimId, P.claims.people.claimId, P.docs.C.claimId].sort();
      assert.deepEqual([...sent.claim_ids].sort(), expectedIds);
      P.draftId = (await page.responseBody(posted)).data.generatedContentDraftId;
      const providerCalls = modelCalls.slice(calls);
      assert.equal(providerCalls.length, 1);
      const call = providerCalls[0];
      assert.deepEqual(call.claims.map((c) => c.claimId).sort(), expectedIds);
      const c = call.claims.find((x) => x.claimId === P.docs.C.claimId);
      assert.equal(c.claimStatement, P.docs.C.statement, "the model receives the persisted claim");
      assert.equal(c.evidenceItemId, P.docs.C.evidenceItemId);
      assert.equal(c.sourceVersionId, P.review.sourceVersionId, "the PDF version");
      for (const code of ["document.source_reported_not_verified", "document.source_estimate", "document.contains_uncertainty"]) assert.ok(c.limitationCodes.includes(code), `${code}: ${J(c.limitationCodes)}`);
      assert.ok(c.limitationCodes.includes("claim_review_unresolved") || c.limitationCodes.includes("evidence_review_unresolved"), "the open review travels too");
      for (const label of ["encounters", "people"]) {
        const m = call.claims.find((x) => x.claimId === P.claims[label].claimId);
        assert.ok(m.limitationCodes.includes("derived.cross_source_linked"));
        assert.ok(!m.limitationCodes.some((code) => code.startsWith("document.")), "a measurement is not given document meaning");
      }
      assert.match(call.system, /document\.source_estimate figure is the source's own estimate/);
      assert.doesNotMatch(call.serialized, RAW_IDENTIFIER);
      report.provider.positive = { calls: 1, claims: call.claims.map((x) => ({ claim_id: x.claimId, evidence_item_id: x.evidenceItemId, source_version_id: x.sourceVersionId, limitation_codes: x.limitationCodes, statement: x.claimStatement })),
        document_instruction_present: true };
      report.browser.generation = { request: [new URL(posted.url).pathname, posted.status], claim_ids: sent.claim_ids, draft_id: P.draftId };
      recordRow("P positive", { claims: "190 + 67 + C estimate", operation: "generate internal evidence summary (browser)", http: posted.status, provider_invoked: true, draft: "saved", provisional_admitted: true });
    });

    await test("P8: the persisted draft is a draft, cites the PDF version for the estimate and both versions for the measurements, and records no approval", async () => {
      const [draft] = await query(`SELECT d.draft_status, d.review_status, d.requested_audience FROM kai.generated_content_drafts d WHERE d.generated_content_draft_id = $1::uuid`, [P.draftId]);
      assert.deepEqual(draft, { draft_status: "draft", review_status: "needs_gk_review", requested_audience: "internal" }, "the model's 'approved' / 'released' changed nothing");
      const blocks = await query(`SELECT b.ordinal, b.text, c.claim_id::text, c.evidence_item_id::text FROM kai.generated_content_blocks b
        JOIN kai.generated_content_citations c ON c.generated_content_block_id = b.generated_content_block_id WHERE b.generated_content_draft_id = $1::uuid ORDER BY b.ordinal`, [P.draftId]);
      const cBlock = blocks.find((b) => b.claim_id === P.docs.C.claimId);
      assert.equal(cBlock.evidence_item_id, P.docs.C.evidenceItemId);
      assert.match(cBlock.text, /^Source-reported, not independently verified \(page 2, blocks 3-5\): "/);
      assert.match(cBlock.text, /at least 90 different people/);
      assert.match(cBlock.text, /rough tally/);
      for (const block of blocks) {
        assert.doesNotMatch(block.text, /\b217 (?:completed|eligible|contacts|people)/i);
        assert.doesNotMatch(block.text, /\b(approved|released)\b/i);
        assert.doesNotMatch(block.text, /KAI (?:calculated|established|verified)[^.]*\b90\b/i);
      }
      assert.match(blocks.find((b) => b.claim_id === P.claims.encounters.claimId).text, /\b190\b/);
      assert.match(blocks.find((b) => b.claim_id === P.claims.people.claimId).text, /\b67\b/);
      const now = await counts(P.organizationId);
      assert.deepEqual(now, { ...P.approvalsBefore, drafts: P.approvalsBefore.drafts + 1 }, "only the draft was written");
      report.drafts.P = { persisted: draft, blocks: blocks.map((b) => ({ claim_id: b.claim_id, evidence_item_id: b.evidence_item_id, text: b.text })) };
    });

    await test("P9 (browser): the administrator opens the saved draft and its report; the estimate is labelled a source estimate, not an observation or a KAI result", async () => {
      await page.waitFor(() => page.visible(`[data-client-internal-draft-detail="${P.draftId}"]`), "the saved draft opened from the server", { timeout: 30000 });
      const detailGet = page.requests().filter((r) => r.method === "GET" && new URL(r.url).pathname === clientInternalDraftPath(P.organizationId, P.projectId, P.draftId)).at(-1);
      assert.equal(detailGet?.status, 200);
      for (const claimId of [P.claims.encounters.claimId, P.claims.people.claimId, P.docs.C.claimId]) {
        assert.ok(await page.textOf(`[data-client-internal-draft-detail="${P.draftId}"] [data-client-internal-draft-citation="${claimId}"]`), `${claimId} cited`);
      }
      const mark = page.mark();
      await page.clickVisible(`[data-client-open-internal-report="${P.draftId}"]`, "Open report");
      await page.waitFor(() => page.visible("[data-client-internal-report-markdown]"), "the internal report", { timeout: 30000 });
      await page.idle();
      const markdownGet = page.requestsSince(mark).find((r) => new URL(r.url).pathname === clientInternalReportMarkdownPath(P.organizationId, P.projectId, P.draftId));
      assert.equal(markdownGet?.status, 200);
      const markdown = await page.textOf("[data-client-internal-report-markdown]");
      assert.match(markdown, /Status:\s*Provisional internal draft\.|\*\*Status:\*\* Provisional internal draft\./);
      assert.match(markdown, /Source-reported preliminary estimate \(not calculated or verified by KAI\)/);
      assert.doesNotMatch(markdown, /Source-reported observation \(qualitative\):\*?\*? the source records that "Prepared before/, "the estimate is not called an observation");
      assert.match(markdown, /not comparable with a KAI measurement unless the same people, period, programmes and eligibility rules are established/);
      assert.match(markdown, /document\.source_estimate/);
      for (const sv of [P.events.sourceVersionId, P.roster.sourceVersionId, P.review.sourceVersionId]) assert.ok(markdown.includes(sv), `the report cites version ${sv}`);
      assert.match(markdown, /\b190\b/);
      assert.match(markdown, /\b67\b/);
      assert.match(markdown, new RegExp(`${PERIOD.start}[\\s\\S]*${PERIOD.end}`));
      assert.doesNotMatch(markdown, /\b217 (?:completed|eligible|contacts|people)/i);
      assert.doesNotMatch(markdown, RAW_IDENTIFIER);
      assert.match(markdown, /Review for final use complete: no \(provisional finding\)/);
      report.browser.saved_draft = { detail_get: detailGet.status, markdown_get: markdownGet.status,
        estimate_lines: markdown.split("\n").filter((line) => /estimate/i.test(line)).slice(0, 6) };
      assert.deepEqual(page.exceptions, [], "no page exception");
    });

    // ---- Validator through the real route (API; stub responses chosen) ----
    await test("V: through the real generation route, a qualified attribution of the estimate is saved; an estimate as KAI's result or guidance as a completed step is detected and never saved, and the draft is restated instead of failing", async () => {
      const C = P.docs.C;
      const B = P.docs.B;
      const A = P.docs.A;
      const attempts = {
        estimate_as_kai_result: { ids: [C.claimId], text: { [C.claimId]: "KAI established that at least 90 distinct people were served in FY 2024-25." } },
        estimate_unattributed: { ids: [C.claimId], text: { [C.claimId]: "At least 90 different people received a direct CC or RA service in FY 2024-25." } },
        estimate_qualifier_dropped: { ids: [C.claimId], text: { [C.claimId]: "The management review reports that 90 different people received a direct CC or RA service in FY 2024-25." } },
        estimate_replaces_measurement: { ids: [P.claims.people.claimId, C.claimId], text: { [C.claimId]: "The organization reached at least 90 distinct people, as the review's preliminary estimate shows." } },
        guidance_as_completed: { ids: [P.claims.people.claimId, B.claimId], text: { [B.claimId]: "Participants appearing in both CC and RA were deduplicated for the organization-wide reach figure." } },
        guidance_as_kai_step: { ids: [B.claimId], text: { [B.claimId]: "KAI deduplicated participants for the organization-wide reach figure, as the review requires." } },
        context_as_verified: { ids: [A.claimId], text: { [A.claimId]: "KAI verified that overlapping CC and RA attendance was legitimate." } },
      };
      report.validator.refused = {};
      // Owner direction 2026-11-10: prohibited wording is detected by
      // VAL-GEN-004 and never saved, and it no longer fails the request: the
      // refused block is restated from the cited claim's own governed text.
      for (const [label, attempt] of Object.entries(attempts)) {
        respond = (claim) => attempt.text[claim.claimId] ?? null;
        const result = await generate(P, attempt.ids);
        respond = null;
        assert.deepEqual([result.status, result.providerCalls, result.draftsWritten], [201, 1, 1], `${label}: ${J(result.body)}`);
        const [draft] = await query("SELECT validator_results FROM kai.generated_content_drafts WHERE generated_content_draft_id = $1::uuid", [result.draftId]);
        const fallback = draft.validator_results.find((item) => item.validator_key === "KAI-GEN-WORDING-FALLBACK-001");
        assert.ok(fallback, `${label}: ${J(draft.validator_results)}`);
        assert.ok(fallback.evidence.refused_validator_keys.includes("VAL-GEN-004"), `${label}: ${J(fallback.evidence)}`);
        assert.ok(fallback.evidence.refused_classes.some((k) => k.startsWith("document_")), `${label}: ${J(fallback.evidence)}`);
        const saved = await query(`SELECT b.text, c.claim_id::text FROM kai.generated_content_blocks b JOIN kai.generated_content_citations c ON c.generated_content_block_id = b.generated_content_block_id
          WHERE b.generated_content_draft_id = $1::uuid ORDER BY b.ordinal`, [result.draftId]);
        for (const text of Object.values(attempt.text)) assert.ok(!saved.some((row) => row.text.includes(text)), `${label}: the prohibited wording is not saved`);
        for (const claimId of Object.keys(attempt.text)) {
          const persistedClaim = Object.values(P.docs).find((doc) => doc.claimId === claimId);
          assert.ok(saved.some((row) => row.claim_id === claimId && row.text === persistedClaim.statement), `${label}: restated as the source-reported claim`);
        }
        const reads = await clientReads(P, result.draftId);
        assert.equal(reads.markdown, 200);
        assert.match(reads.markdownText, /Restated passages:\*\* some generated wording did not pass these checks/);
        report.validator.refused[label] = { http: result.status, provider_calls: result.providerCalls, drafts_written: result.draftsWritten,
          detected: fallback.evidence.refused_validator_keys, classes: fallback.evidence.refused_classes, replaced_blocks: fallback.evidence.replaced_model_block_ordinals, saved: saved.map((row) => row.text.slice(0, 90)) };
        recordRow("V prohibited wording", { claims: label, operation: "generate internal evidence summary", http: result.status, provider_invoked: true, draft: "saved (refused wording restated)", provisional_admitted: true,
          blocker: fallback.evidence.refused_classes.join(",") });
      }
      const permittedText = {
        [C.claimId]: "The management review reports a preliminary estimate that at least 90 different people received a direct CC or RA service in FY 2024-25; the review says it came from a rough tally, not a distinct-person calculation, and it remains unverified.",
        [B.claimId]: "The management review states that a participant who appears in both activity counts must be deduplicated for an organisation-wide reach figure.",
        [A.claimId]: "The programme notes state that some participants used both CC and RA and several attended more than once, and that both patterns are legitimate.",
      };
      respond = (claim) => permittedText[claim.claimId] ?? null;
      const permitted = await generate(P, [P.claims.people.claimId, C.claimId, B.claimId, A.claimId]);
      respond = null;
      assert.deepEqual([permitted.status, permitted.providerCalls, permitted.draftsWritten], [201, 1, 1], J(permitted.body));
      const saved = await query(`SELECT b.text, c.claim_id::text FROM kai.generated_content_blocks b JOIN kai.generated_content_citations c ON c.generated_content_block_id = b.generated_content_block_id
        WHERE b.generated_content_draft_id = $1::uuid`, [permitted.draftId]);
      assert.equal(saved.find((b) => b.claim_id === C.claimId).text, permittedText[C.claimId]);
      const reads = await clientReads(P, permitted.draftId);
      assert.deepEqual([reads.listed, reads.detail, reads.markdown], [true, 200, 200]);
      assert.match(reads.markdownText, /Source-reported method or guidance \(not evidence that it was carried out\)/);
      assert.match(reads.markdownText, /does not show that the step was carried out/);
      report.validator.permitted = { http: permitted.status, provider_calls: permitted.providerCalls, draft_id: permitted.draftId, blocks: saved };
      recordRow("V permitted output", { claims: "67 + A + B + C (qualified)", operation: "generate internal evidence summary", http: permitted.status, provider_invoked: true, draft: "saved", provisional_admitted: true });
    });

    // ---- D: document AI processing withdrawn ------------------------------
    await test("D: the review PDF's AI processing is withdrawn; a draft with its estimate is refused before the provider; the 190/67 measurements stay admitted and draft alone", async () => {
      const D = await buildMeasured(ORGS.D);
      D.review = await uploadAndPromote(D, FILES.review);
      await extract(D, D.review);
      D.docs = { C: await proposeCase(D, "C") };
      await reviewPermissionsAgain(D, D.review, { reviewed_llm_processing_allowed: false });
      const docAdmission = await diagnose(D, D.docs.C.claimId);
      assert.deepEqual(docAdmission.provisional?.admitted, false, J(docAdmission));
      assert.ok(docAdmission.provisional.blocker_codes.includes("ai_processing_not_permitted"), J(docAdmission));
      assert.equal(docAdmission.frontend, "refused");
      assert.match(docAdmission.frontendMessage, /processing permissions do not allow AI processing/);
      for (const label of ["encounters", "people"]) {
        assert.deepEqual((await diagnose(D, D.claims[label].claimId)).provisional, { admitted: true, blocker_codes: [], source_role: null }, `${label} stays admitted`);
      }
      const mixed = await generate(D, [D.claims.encounters.claimId, D.claims.people.claimId, D.docs.C.claimId]);
      assert.deepEqual([mixed.status, mixed.blockers[0], mixed.providerCalls, mixed.draftsWritten], [422, "ai_processing_not_permitted", 0, 0], J(mixed.body));
      // The customer sees the server's reason and fix, never "Request failed KAI validation."
      assert.doesNotMatch(mixed.customerMessage, /^Request failed/);
      assert.match(mixed.customerMessage, /AI processing/i);
      const measuredOnly = await generate(D, [D.claims.encounters.claimId, D.claims.people.claimId]);
      assert.deepEqual([measuredOnly.status, measuredOnly.providerCalls, measuredOnly.draftsWritten], [201, 1, 1], J(measuredOnly.body));
      assert.ok(!measuredOnly.sent[0].claims.some((c) => c.claimId === D.docs.C.claimId));
      report.refusals = { D: { document_admission: docAdmission, mixed: { http: mixed.status, blockers: mixed.blockers, source_role: mixed.sourceRole, provider_calls: mixed.providerCalls, drafts_written: mixed.draftsWritten, customer_message: mixed.customerMessage },
        measured_only: { http: measuredOnly.status, provider_calls: measuredOnly.providerCalls, drafts_written: measuredOnly.draftsWritten } } };
      recordRow("D document AI withdrawn", { claims: "190 + 67 + C", operation: "generate internal evidence summary", http: mixed.status, provider_invoked: false, draft: "refused", provisional_admitted: false, blocker: mixed.blockers.join(",") });
      recordRow("D document AI withdrawn", { claims: "190 + 67", operation: "generate internal evidence summary", http: measuredOnly.status, provider_invoked: true, draft: "saved", provisional_admitted: true });
    });

    // ---- R: roster AI processing withdrawn --------------------------------
    await test("R: the roster's AI processing is withdrawn; the cross-source claims are refused (reference); the separately permitted estimate is not falsely refused", async () => {
      const R = await buildMeasured(ORGS.R);
      R.review = await uploadAndPromote(R, FILES.review);
      await extract(R, R.review);
      R.docs = { C: await proposeCase(R, "C") };
      await reviewPermissionsAgain(R, R.roster, { reviewed_llm_processing_allowed: false });
      const peopleAdmission = await diagnose(R, R.claims.people.claimId);
      assert.deepEqual(peopleAdmission.provisional, { admitted: false, blocker_codes: ["ai_processing_not_permitted"], source_role: "reference" }, J(peopleAdmission));
      assert.deepEqual((await diagnose(R, R.docs.C.claimId)).provisional, { admitted: true, blocker_codes: [], source_role: null });
      const mixed = await generate(R, [R.claims.encounters.claimId, R.claims.people.claimId, R.docs.C.claimId]);
      assert.deepEqual([mixed.status, mixed.blockers[0], mixed.sourceRole, mixed.providerCalls, mixed.draftsWritten], [422, "ai_processing_not_permitted", "reference", 0, 0], J(mixed.body));
      const docOnly = await generate(R, [R.docs.C.claimId]);
      assert.deepEqual([docOnly.status, docOnly.providerCalls, docOnly.sentClaimIds, docOnly.draftsWritten], [201, 1, [R.docs.C.claimId], 1], J(docOnly.body));
      const measured = await generate(R, [R.claims.encounters.claimId, R.claims.people.claimId]);
      assert.deepEqual([measured.status, measured.sourceRole, measured.providerCalls], [422, "reference", 0]);
      report.refusals.R = { people_admission: peopleAdmission, mixed: { http: mixed.status, blockers: mixed.blockers, source_role: mixed.sourceRole, provider_calls: mixed.providerCalls },
        document_only: { http: docOnly.status, provider_calls: docOnly.providerCalls }, measured_only: { http: measured.status, source_role: measured.sourceRole, provider_calls: measured.providerCalls } };
      recordRow("R roster AI withdrawn", { claims: "190 + 67 + C", operation: "generate internal evidence summary", http: mixed.status, provider_invoked: false, draft: "refused", provisional_admitted: false, blocker: "ai_processing_not_permitted (reference)" });
      recordRow("R roster AI withdrawn", { claims: "C only", operation: "generate internal evidence summary", http: docOnly.status, provider_invoked: true, draft: "saved", provisional_admitted: true });
      recordRow("R roster AI withdrawn", { claims: "190 + 67", operation: "generate internal evidence summary", http: measured.status, provider_invoked: false, draft: "refused", provisional_admitted: false });
    });

    await test("agreement: for every admission-governed generation attempt the server's admission predicted whether the provider was called", () => {
      const generations = MATRIX.filter((row) => typeof row.provisional_admitted === "boolean");
      assert.ok(generations.length >= 6);
      for (const row of generations) assert.equal(row.provider_invoked, row.provisional_admitted, J(row));
    });
  } finally {
    if (REPORT_PATH) writeFileSync(REPORT_PATH, `${J(report, null, 2)}\n`);
    await page.close().catch(() => {});
    await browser.close();
    restoreRuntime();
    await new Promise((resolve) => server.close(resolve));
    await seedPool.end();
    await ambientPool.end();
  }
}
