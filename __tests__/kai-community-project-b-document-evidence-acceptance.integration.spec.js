import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { inflateRawSync } from "node:zlib";

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
    sessionId,
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
  // Scenario O interpretation tests (owner direction 2026-11-12, "Close the
  // remaining impact-interpretation integrity gap"): a test may set
  // `assessmentRespond(requestBody)` to return independently authored,
  // model-style assessment blocks (never a copy of plainReading). The exact
  // text returned is recorded with the call.
  let assessmentRespond = null;
  // Scenario J ("Use this assessment", owner direction 2026-11-20): a report
  // request carrying the saved assessment. The simulated provider writes the
  // way the adaptation instruction asks, and no more: one opening sentence
  // for the purpose, then the assessment's own passages carried forward, each
  // citing what that passage cites (one passage per measured finding, as the
  // assessment's findings are written; summary, next-step and multi-finding
  // passages are left to the report's own structure). Copied, never invented.
  const ADAPTATION_OPENINGS = Object.freeze({
    internal_planning: "For the organization's own planning, this summary carries forward what the organization's saved assessment found.",
    board_update: "For the board: this update carries forward what the organization's saved assessment found, with each figure's sources and limitations.",
    funder_report: "For a funder the organization reports to: this report carries forward what the organization's saved assessment found, with each figure's sources and limitations.",
    annual_report: "For the annual report: this section carries forward what the organization's saved assessment found.",
  });
  const isMeasuredClaim = (claim) => (claim?.limitationCodes || []).some((code) => /^(?:derived|measurement)\./.test(code));
  const defaultAdaptation = (requestBody) => {
    const byId = new Map(requestBody.claims.map((claim) => [claim.claimId, claim]));
    const cite = (ids) => ids.map((claimId) => ({ claimId, evidenceItemId: byId.get(claimId).evidenceItemId }));
    const opening = requestBody.claims.find((claim) => !isMeasuredClaim(claim)) || requestBody.claims[0];
    const passages = requestBody.adaptation.sourceAssessment.sections
      .filter((section) => !["executive_snapshot", "next_steps"].includes(section.key))
      .flatMap((section) => section.blocks)
      .filter((block) => block.claimIds.filter((claimId) => isMeasuredClaim(byId.get(claimId))).length <= 1);
    return [{ text: ADAPTATION_OPENINGS[requestBody.adaptation.purpose], citations: cite([opening.claimId]) },
      ...passages.map((block) => ({ text: block.text, citations: cite(block.claimIds) }))];
  };
  messagesPrototype.create = async function deterministicCreate(payload) {
    const requestBody = JSON.parse(payload.messages[0].content);
    modelCalls.push({ claims: requestBody.claims, requestedAudience: requestBody.requestedAudience ?? null, assessment: requestBody.assessment ?? null, correction: requestBody.correction ?? null,
      adaptation: requestBody.adaptation ?? null, contentType: requestBody.contentType ?? null, system: payload.system, serialized: J(payload) });
    if (requestBody.adaptation) {
      const blocks = defaultAdaptation(requestBody);
      modelCalls.at(-1).responseBlocks = blocks;
      return { content: [{ type: "text", text: J({ blocks }) }] };
    }
    if (requestBody.assessment && assessmentRespond) {
      const blocks = assessmentRespond(requestBody);
      modelCalls.at(-1).responseBlocks = blocks;
      return { content: [{ type: "text", text: J({ blocks }) }] };
    }
    // A Free Impact Assessment request (scenario O): sections, written the way
    // the prompt asks - each finding from KAI's plainReading where it has one,
    // the document statements as the source states them. No intelligence: the
    // text is copied, never paraphrased.
    if (requestBody.assessment) {
      const cite = (claim) => [{ claimId: claim.claimId, evidenceItemId: claim.evidenceItemId }];
      const documents = requestBody.claims.filter((claim) => claim.limitationCodes.some((code) => code.startsWith("document.")));
      const findings = requestBody.claims.filter((claim) => !documents.includes(claim)).slice(0, 9);
      const blocks = [
        { section: "executive_snapshot", text: "This assessment brings together the people the programme reached and the participant ratings the organization recorded at baseline and follow-up.", citations: cite(requestBody.claims[0]) },
        ...findings.map((claim) => ({ section: "evidence_findings", text: claim.plainReading || claim.claimStatement, citations: cite(claim) })),
        documents.length > 0
          ? { section: "impact_stories", text: documents.map((claim) => claim.claimStatement).join(" "), citations: documents.flatMap(cite) }
          : { section: "impact_stories", text: "No participant account is stated beyond the cited findings.", citations: cite(requestBody.claims[0]) },
      ];
      return { content: [{ type: "text", text: J({ blocks }) }] };
    }
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
    createEvidenceSummaryPath, createFreeImpactAssessmentPath, errorText, evidenceExtractionPath, sourceCandidateDecisionPath,
    assessmentAdaptationPath, clientWorkingReportRevisionPath, organizationAccessCapabilitiesPath,
  } = await import("../frontend/impactEvidenceLibraryLogic.js");
  const { claimUseDiagnosis, claimDraftAdmission, provisionalDraftRefusalMessage } = await import("../frontend/knowledgeStudio/clientEvidenceWorkflowLogic.js");
  const { confirmUploadPath, createBatchPath, fileReservationsPath, requestUploadUrlPath } = await import("../frontend/kaiWebIntakeLogic.js");
  const {
    crossSourceMeasurementsPath, crossSourceReconciliationJobPath, derivedMeasurementBasisPath, derivedMeasurementInterpretationPath,
    pairedOutcomeMeasurementsPath, tabularMeasurementPath,
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
    // Outcome scenario O (owner direction 2026-11-12): the original assessment workbook.
    workbook: fileOf("workbook", "04_Connection_Assessments.xlsx", ".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
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
    workbook: { ...ABSENT, reviewed_personal_data_status: "present" },
  });

  // --- organizations (one per scenario) --------------------------------------
  const ORGS = Object.fromEntries(["P", "D", "R", "O"].map((key, index) => [key, {
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
  // The real application page for scenario J: views/impact-library.ejs (site
  // header, Bootstrap 5.3.5 from its CDN with its SRI hash, fonts,
  // /css/style.css, /css/gk-design-tokens.css, inline styles) with the same
  // built bundle, rendered as the four-view direct acceptance renders it.
  const ejs = (await import("ejs")).default;
  const viewsDir = new URL("../views/", import.meta.url).pathname;
  app.get("/impact-library-app", async (_req, res) => {
    res.send(await ejs.renderFile(join(viewsDir, "impact-library.ejs"), { csrfToken: "", assetTag: "", user: null, currentPage: "impact-library" }));
  });
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
      expected_updated_at: new Date(sensitivity.updated_at).toISOString(), review_queue_item_id: sensitivity.review_queue_item_id, decision: "reviewed", reviewed_snapshot: file.permissions || DECISIONS[file.key] });
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
    await test("0: the original upload files match the package checksum manifest; nothing from the answer-key folder is a source; the tested bundle is the built one", async () => {
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

    await test("P5: all five source-backed claims are internally usable without review approval", async () => {
      for (const [label, claimId] of [["encounters", P.claims.encounters.claimId], ["people", P.claims.people.claimId], ...Object.entries(P.docs).map(([k, d]) => [k, d.claimId])]) {
        const strict = await gkTrace(P, claimId);
        const admission = await diagnose(P, claimId);
        assert.equal(strict.eligible, true, J(strict));
        assert.deepEqual(strict.blockerCodes, []);
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
        assert.match(await page.textOf(row), /Ready to use in your report\./);
        assert.doesNotMatch(await page.textOf(row), /Before final use|no completed review|never for funder/);
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
      assert.equal(c.limitationCodes.some((code) => ["claim_review_unresolved", "evidence_review_unresolved"].includes(code)), false, "missing review is not a reporting limitation");
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
      assert.match(markdown, /\*\*Status:\*\* Working report\./);
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
      assert.doesNotMatch(markdown, /Review for final use complete|not approved for release/);
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
    await test("D: the review PDF's AI processing is withdrawn; a draft selecting its estimate leaves it out before the provider and discloses it; the 190/67 measurements draft; the estimate alone is refused", async () => {
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
      // Owner direction 2026-11-11 (amends the B1A-02 whole-request rule for
      // provisional internal drafts): the prohibited PDF claim is left out
      // before the provider, disclosed, and the draft uses the 190/67 claims.
      const mixed = await generate(D, [D.claims.encounters.claimId, D.claims.people.claimId, D.docs.C.claimId]);
      assert.deepEqual([mixed.status, mixed.providerCalls, mixed.draftsWritten], [201, 1, 1], J(mixed.body));
      assert.deepEqual(mixed.sentClaimIds, [D.claims.encounters.claimId, D.claims.people.claimId].sort(), "only the permitted claims reach the provider");
      assert.doesNotMatch(J(mixed.sent), /at least 90|rough tally|management review/i, "no PDF content reaches the provider");
      assert.deepEqual(mixed.body.data.permissionExcludedClaims.map((item) => [item.claimId, item.blockingReason]), [[D.docs.C.claimId, "ai_processing_not_permitted"]]);
      const mixedSaved = await query(`SELECT b.text, c.claim_id::text FROM kai.generated_content_blocks b JOIN kai.generated_content_citations c ON c.generated_content_block_id = b.generated_content_block_id
        WHERE b.generated_content_draft_id = $1::uuid ORDER BY b.ordinal`, [mixed.draftId]);
      assert.ok(!mixedSaved.some((row) => row.claim_id === D.docs.C.claimId), "the left-out claim is never cited");
      assert.ok(!mixedSaved.some((row) => /at least 90|rough tally/.test(row.text)), "nothing from the left-out claim is asserted");
      assert.ok(mixedSaved.some((row) => /Selection note: one selected finding was not sent to the AI model and is not part of this draft/.test(row.text)), "the exclusion is disclosed in the saved draft");
      const [mixedDraft] = await query("SELECT validator_results, review_status FROM kai.generated_content_drafts WHERE generated_content_draft_id = $1::uuid", [mixed.draftId]);
      assert.deepEqual(mixedDraft.validator_results.find((item) => item.validator_key === "KAI-GEN-PERMISSION-EXCLUSION-001").evidence.excluded_claims.map((item) => item.claimId), [D.docs.C.claimId]);
      assert.equal(mixedDraft.review_status, "needs_gk_review", "still provisional; no review manufactured");
      const mixedReads = await clientReads(D, mixed.draftId);
      assert.deepEqual([mixedReads.detail, mixedReads.markdown], [200, 200]);
      assert.match(mixedReads.markdownText, /Selection note: one selected finding was not sent to the AI model/);
      // Every selected claim prohibited: the specific refusal and no provider call.
      const estimateOnly = await generate(D, [D.docs.C.claimId]);
      assert.deepEqual([estimateOnly.status, estimateOnly.blockers[0], estimateOnly.providerCalls, estimateOnly.draftsWritten], [422, "ai_processing_not_permitted", 0, 0], J(estimateOnly.body));
      // The customer sees the server's reason and fix, never "Request failed KAI validation."
      assert.doesNotMatch(estimateOnly.customerMessage, /^Request failed/);
      assert.match(estimateOnly.customerMessage, /AI processing/i);
      const measuredOnly = await generate(D, [D.claims.encounters.claimId, D.claims.people.claimId]);
      assert.deepEqual([measuredOnly.status, measuredOnly.providerCalls, measuredOnly.draftsWritten], [201, 1, 1], J(measuredOnly.body));
      assert.ok(!measuredOnly.sent[0].claims.some((c) => c.claimId === D.docs.C.claimId));
      report.refusals = { D: { document_admission: docAdmission, mixed: { http: mixed.status, sent_claim_ids: mixed.sentClaimIds, provider_calls: mixed.providerCalls, drafts_written: mixed.draftsWritten, permission_excluded: mixed.body.data.permissionExcludedClaims, saved: mixedSaved.map((row) => row.text.slice(0, 160)) },
        estimate_only: { http: estimateOnly.status, blockers: estimateOnly.blockers, provider_calls: estimateOnly.providerCalls, customer_message: estimateOnly.customerMessage },
        measured_only: { http: measuredOnly.status, provider_calls: measuredOnly.providerCalls, drafts_written: measuredOnly.draftsWritten } } };
      recordRow("D document AI withdrawn", { claims: "190 + 67 + C", operation: "generate internal evidence summary", http: mixed.status, provider_invoked: true, draft: "saved without C (disclosed)", provisional_admitted: true, blocker: "C left out: ai_processing_not_permitted" });
      recordRow("D document AI withdrawn", { claims: "C only", operation: "generate internal evidence summary", http: estimateOnly.status, provider_invoked: false, draft: "refused", provisional_admitted: false, blocker: estimateOnly.blockers.join(",") });
      recordRow("D document AI withdrawn", { claims: "190 + 67", operation: "generate internal evidence summary", http: measuredOnly.status, provider_invoked: true, draft: "saved", provisional_admitted: true });
    });

    // ---- R: roster AI processing withdrawn --------------------------------
    await test("R: the roster's AI processing is withdrawn; the cross-source claims are left out (reference) and disclosed; the separately permitted estimate still drafts; the roster claims alone are refused", async () => {
      const R = await buildMeasured(ORGS.R);
      R.review = await uploadAndPromote(R, FILES.review);
      await extract(R, R.review);
      R.docs = { C: await proposeCase(R, "C") };
      await reviewPermissionsAgain(R, R.roster, { reviewed_llm_processing_allowed: false });
      const peopleAdmission = await diagnose(R, R.claims.people.claimId);
      assert.deepEqual(peopleAdmission.provisional, { admitted: false, blocker_codes: ["ai_processing_not_permitted"], source_role: "reference" }, J(peopleAdmission));
      assert.deepEqual((await diagnose(R, R.docs.C.claimId)).provisional, { admitted: true, blocker_codes: [], source_role: null });
      const mixed = await generate(R, [R.claims.encounters.claimId, R.claims.people.claimId, R.docs.C.claimId]);
      assert.deepEqual([mixed.status, mixed.providerCalls, mixed.sentClaimIds, mixed.draftsWritten], [201, 1, [R.docs.C.claimId], 1], J(mixed.body));
      assert.deepEqual(mixed.body.data.permissionExcludedClaims.map((item) => [item.claimId, item.blockingReason, item.sourceRole]).sort(),
        [[R.claims.encounters.claimId, "ai_processing_not_permitted", "reference"], [R.claims.people.claimId, "ai_processing_not_permitted", "reference"]].sort());
      assert.doesNotMatch(J(mixed.sent), /\b190\b|\b67\b|register participant/, "no roster-dependent measurement reaches the provider");
      const rSaved = await query(`SELECT b.text, c.claim_id::text FROM kai.generated_content_blocks b JOIN kai.generated_content_citations c ON c.generated_content_block_id = b.generated_content_block_id
        WHERE b.generated_content_draft_id = $1::uuid`, [mixed.draftId]);
      assert.ok(rSaved.every((row) => row.claim_id === R.docs.C.claimId), "only the permitted document is cited");
      assert.ok(rSaved.some((row) => /Selection note: some selected findings were not sent to the AI model and are not part of this draft/.test(row.text)));
      const docOnly = await generate(R, [R.docs.C.claimId]);
      assert.deepEqual([docOnly.status, docOnly.providerCalls, docOnly.sentClaimIds, docOnly.draftsWritten], [201, 1, [R.docs.C.claimId], 1], J(docOnly.body));
      const measured = await generate(R, [R.claims.encounters.claimId, R.claims.people.claimId]);
      assert.deepEqual([measured.status, measured.sourceRole, measured.providerCalls], [422, "reference", 0]);
      report.refusals.R = { people_admission: peopleAdmission, mixed: { http: mixed.status, sent_claim_ids: mixed.sentClaimIds, permission_excluded: mixed.body.data.permissionExcludedClaims, provider_calls: mixed.providerCalls },
        document_only: { http: docOnly.status, provider_calls: docOnly.providerCalls }, measured_only: { http: measured.status, source_role: measured.sourceRole, provider_calls: measured.providerCalls } };
      recordRow("R roster AI withdrawn", { claims: "190 + 67 + C", operation: "generate internal evidence summary", http: mixed.status, provider_invoked: true, draft: "saved from C only (190/67 left out, disclosed)", provisional_admitted: true, blocker: "190/67 left out: ai_processing_not_permitted (reference)" });
      recordRow("R roster AI withdrawn", { claims: "C only", operation: "generate internal evidence summary", http: docOnly.status, provider_invoked: true, draft: "saved", provisional_admitted: true });
      recordRow("R roster AI withdrawn", { claims: "190 + 67", operation: "generate internal evidence summary", http: measured.status, provider_invoked: false, draft: "refused", provisional_admitted: false });
    });

    // ---- Outcome scenario O (owner direction 2026-11-12) --------------------
    // The same Project B, with its original assessment workbook: what changed
    // for participants, measured by the existing paired-outcome and tabular
    // methods, interpreted with the meaning the organization's own brief gives,
    // and assessed beside the established reach.
    const O = ORGS.O;
    report.outcomes = {};
    const ASSESSMENTS = worksheetRows(FILES.workbook.bytes, 1);
    const FOLLOWUPS = worksheetRows(FILES.workbook.bytes, 2);
    const EXPECTED_OUTCOMES = {
      connection: independentPairs(ASSESSMENTS, "community_connection_score_1_to_5"),
      navigation: independentPairs(ASSESSMENTS, "resource_navigation_score_1_to_5"),
    };
    const EXPECTED_RATES = {
      response: independentRate(FOLLOWUPS, { condition: ["response_status", "answered"], population: ["contact_attempted", "yes"] }),
      joined: independentRate(FOLLOWUPS, { condition: ["self_reported_next_step", "joined_community_activity"], population: ["response_status", "answered"] }),
      support: independentRate(FOLLOWUPS, { condition: ["self_reported_next_step", "accessed_local_support"], population: ["response_status", "answered"] }),
    };
    // The organization's meaning, from its own project brief (01_Connection_Project_Brief.md,
    // section 2), recorded by its administrator through the supported route. The
    // brief gives community connection's scale and direction; for resource
    // navigation it gives what the question asks but not its anchors or which end
    // is better, so no direction is recorded for it.
    const OUTCOME_MEANINGS = {
      connection: { indicator_label: "Community-connection confidence", score_direction: "higher_is_better", evidence_basis: "self_reported",
        meaning_text: "From the project brief: the participant's community-connection confidence on a five-point self-report scale (1 = very low, 5 = very high); a higher follow-up score means the person reported more confidence" },
      navigation: { indicator_label: "Resource-navigation confidence", score_direction: "not_established", evidence_basis: "self_reported",
        meaning_text: "From the project brief: a five-point self-report question asking how ready the respondent feels to find relevant assistance" },
    };

    await test("O1 (fixture, API): the original assessment workbook is uploaded, profiled and promoted beside the reach sources; the established 190 contacts / 67 people are unchanged", async () => {
      await buildMeasured(O);
      O.workbook = await uploadAndPromote(O, FILES.workbook);
      O.review = await uploadAndPromote(O, FILES.review);
      await extract(O, O.review);
      O.docs = { C: await proposeCase(O, "C") };
      assert.deepEqual([O.cross.encounters.measured_value, O.cross.people.measured_value], [EXPECTED.eligible, EXPECTED.people]);
      const basis = await O.api("GET", derivedMeasurementBasisPath(O.organizationId, O.workbook.sourceVersionId, "sheet_1"));
      assert.equal(basis.status, 200, J(basis.body));
      assert.doesNotMatch(J(basis.body.data), RAW_IDENTIFIER, "no participant identifier is exposed by the basis");
      report.outcomes.sources = { workbook_source_version: O.workbook.sourceVersionId, review_source_version: O.review.sourceVersionId,
        independent: { outcomes: EXPECTED_OUTCOMES, rates: EXPECTED_RATES } };
    });

    await test("O2: the existing paired-outcome method calculates both self-ratings exactly as the brief's pairing rule gives them, with exclusions and lineage", async () => {
      const recorded = await O.api("POST", pairedOutcomeMeasurementsPath(O.organizationId, O.workbook.sourceVersionId, "sheet_1"), {});
      assert.equal(recorded.status, 200, J(recorded.body));
      const rows = await query(`SELECT source_derived_measurement_id::text, source_version_id::text, worksheet_key, calculation_method, definition, field_keys,
          numerator::int, denominator::int, percentage::text, component_counts, exclusions FROM kai.source_derived_measurements
         WHERE organization_id = $1::uuid AND source_version_id = $2::uuid AND measurement_family = 'paired_outcome_change'`, [O.organizationId, O.workbook.sourceVersionId]);
      assert.equal(rows.length, 2, J(rows.map((row) => row.definition)));
      O.outcomes = {};
      for (const [key, expected] of Object.entries(EXPECTED_OUTCOMES)) {
        const row = rows.find((candidate) => candidate.definition.outcome_column === expected.column);
        assert.ok(row, `${key}: measured from column ${expected.column}`);
        const c = row.component_counts;
        assert.deepEqual([row.denominator, row.numerator, c.unchanged_count, c.decreased_count, row.percentage, c.participant_count, c.excluded_participant_count],
          [expected.pairs, expected.higher, expected.same, expected.lower, expected.percentage, expected.participants, expected.excluded], `${key}: ${J(row.component_counts)}`);
        assert.deepEqual([row.calculation_method, row.worksheet_key, row.source_version_id], ["p1_xlsx_paired_baseline_followup_numeric_change_v1", "sheet_1", O.workbook.sourceVersionId]);
        assert.ok(row.definition.instrument_version_field_key, `${key}: pairs require the same tool version`);
        const [evidence] = await query(`SELECT e.evidence_item_id::text, e.source_version_id::text, e.evidence_type, l.locator_type, l.coordinates FROM kai.evidence_derived_measurements d
            JOIN kai.evidence_items e ON e.evidence_item_id = d.evidence_item_id JOIN kai.source_locators l ON l.source_locator_id = e.source_locator_id
           WHERE d.source_derived_measurement_id = $1::uuid AND d.interpretation_id IS NULL`, [row.source_derived_measurement_id]);
        assert.deepEqual([evidence.evidence_type, evidence.source_version_id, evidence.locator_type, evidence.coordinates.sheet_key], ["source_derived_measurement", O.workbook.sourceVersionId, "source_derived_measurement_fields", "sheet_1"]);
        O.outcomes[key] = { measurementId: row.source_derived_measurement_id, row,
          exclusions: Object.fromEntries((row.exclusions.participants || []).map((entry) => [entry.reason, entry.participant_count])) };
        assert.equal(Object.values(O.outcomes[key].exclusions).reduce((a, b) => a + b, 0), expected.excluded, `${key}: every excluded participant has a recorded reason`);
      }
      report.outcomes.paired = Object.fromEntries(Object.entries(O.outcomes).map(([key, entry]) => [key, { column: entry.row.definition.outcome_column, pairs: entry.row.denominator,
        higher: entry.row.numerator, same: entry.row.component_counts.unchanged_count, lower: entry.row.component_counts.decreased_count, percentage: entry.row.percentage,
        participants: entry.row.component_counts.participant_count, exclusions: entry.exclusions, measurement_id: entry.measurementId }]));
    });

    await test("O3: the organization's meaning from its brief is recorded; follow-up rates are measured; every outcome claim traces to the workbook version and is admitted provisionally", async () => {
      for (const key of ["connection", "navigation"]) {
        const stated = await O.api("POST", derivedMeasurementInterpretationPath(O.organizationId, O.outcomes[key].measurementId), OUTCOME_MEANINGS[key]);
        assert.equal(stated.status, 200, J(stated.body));
        const proposed = await O.api("POST", claimProposalPath(O.organizationId, stated.body.data.evidenceItem.evidence_item_id), {});
        assert.ok([200, 201].includes(proposed.status), J(proposed.body));
        Object.assign(O.outcomes[key], { claimId: proposed.body.data.claim.claim_id, evidenceItemId: stated.body.data.evidenceItem.evidence_item_id, statement: proposed.body.data.claim.statement });
      }
      assert.match(O.outcomes.connection.statement, /^Community-connection confidence \(meaning stated by the organization; values self-reported\): .* the organization states higher is better\./);
      assert.match(O.outcomes.navigation.statement, /whether higher is better is not established/);
      // Follow-up results (self-reported next steps; the response rate is the organization's record).
      const followups = await O.api("GET", derivedMeasurementBasisPath(O.organizationId, O.workbook.sourceVersionId, "sheet_2"));
      assert.equal(followups.status, 200, J(followups.body));
      const fields = followups.body.data.tabular.fields;
      const header = FOLLOWUPS[0];
      const fieldFor = (name) => fields.find((field) => field.column_position === Object.keys(header).indexOf(columnOf(header, name)) + 1);
      const valueOf = (name, label) => {
        const field = fieldFor(name);
        const value = field?.values?.find((candidate) => candidate.label === label);
        assert.ok(value, `${name} lists ${label}`);
        return { kind: "category", field_key: field.field_key, value_key: value.value_key };
      };
      const RATES = {
        response: { definition: { operation: "rate", conditions: [valueOf("response_status", "answered")], population: [valueOf("contact_attempted", "yes")] },
          interpretation: { indicator_label: "Follow-up response rate", meaning_text: "Attempted follow-up contacts that were answered", evidence_basis: "organization_record" } },
        joined: { definition: { operation: "rate", conditions: [valueOf("self_reported_next_step", "joined_community_activity")], population: [valueOf("response_status", "answered")] },
          interpretation: { indicator_label: "Joined a community activity (self-reported)", meaning_text: "Answered follow-ups in which the participant reported joining a community activity; not independently verified", evidence_basis: "self_reported" } },
        support: { definition: { operation: "rate", conditions: [valueOf("self_reported_next_step", "accessed_local_support")], population: [valueOf("response_status", "answered")] },
          interpretation: { indicator_label: "Accessed local support (self-reported)", meaning_text: "Answered follow-ups in which the participant reported accessing local support; not independently verified", evidence_basis: "self_reported" } },
      };
      O.rates = {};
      for (const [key, body] of Object.entries(RATES)) {
        const recorded = await O.api("POST", tabularMeasurementPath(O.organizationId, O.workbook.sourceVersionId, "sheet_2"), body);
        assert.equal(recorded.status, 200, `${key}: ${J(recorded.body)}`);
        const { measurement, evidenceItem } = recorded.body.data;
        assert.deepEqual([measurement.numerator, measurement.denominator, String(measurement.percentage)], [EXPECTED_RATES[key].numerator, EXPECTED_RATES[key].denominator, EXPECTED_RATES[key].percentage], key);
        const proposed = await O.api("POST", claimProposalPath(O.organizationId, evidenceItem.evidence_item_id), {});
        assert.ok([200, 201].includes(proposed.status), J(proposed.body));
        O.rates[key] = { claimId: proposed.body.data.claim.claim_id, evidenceItemId: evidenceItem.evidence_item_id, measurementId: measurement.source_derived_measurement_id };
      }
      // Lineage: every outcome and follow-up claim -> evidence -> the workbook source version.
      const outcomeClaims = [...Object.values(O.outcomes), ...Object.values(O.rates)].map((entry) => entry.claimId);
      const lineage = await query(`SELECT c.claim_id::text, e.evidence_item_id::text, e.source_version_id::text, e.evidence_type FROM kai.claims c
          JOIN kai.evidence_items e ON e.evidence_item_id = c.evidence_item_id WHERE c.claim_id = ANY($1::uuid[])`, [outcomeClaims]);
      assert.equal(lineage.length, outcomeClaims.length);
      for (const row of lineage) assert.deepEqual([row.source_version_id, row.evidence_type], [O.workbook.sourceVersionId, "source_derived_measurement"], J(row));
      for (const claimId of [O.claims.encounters.claimId, O.claims.people.claimId, ...outcomeClaims, O.docs.C.claimId]) {
        assert.equal((await diagnose(O, claimId)).provisional?.admitted, true, `${claimId}: admitted to a provisional internal draft`);
      }
      report.outcomes.claims = { connection: O.outcomes.connection.statement, navigation: O.outcomes.navigation.statement, lineage,
        rates: Object.fromEntries(Object.entries(O.rates).map(([key, entry]) => [key, { claim_id: entry.claimId, ...EXPECTED_RATES[key] }])) };
    });

    await test("O4 (browser): the administrator selects reach, outcomes, follow-up results and the qualified estimate, generates the Free Impact Assessment, reads it and its report, and reopens it after a reload", async () => {
      const pageO = await openPage(browser, { baseUrl, legacyUserId: O.adminUserId });
      const openStudioO = async (view) => {
        await pageO.goto("/impact-library");
        await pageO.clickNav("Knowledge Studio");
        await pageO.waitFor(() => pageO.visible("#gk-shell-project-select"), "the Project selector");
        await pageO.idle();
        await pageO.selectProject(O.projectId);
        await pageO.idle();
        await pageO.clickTab(view);
        await pageO.idle();
      };
      const selected = [O.claims.encounters.claimId, O.claims.people.claimId, O.outcomes.connection.claimId, O.outcomes.navigation.claimId,
        O.rates.response.claimId, O.rates.joined.claimId, O.rates.support.claimId, O.docs.C.claimId];
      const approvalsBefore = await counts(O.organizationId);
      // The provider interprets both outcomes in its own words (owner direction
      // 2026-11-12), never by copying plainReading. Its first answer overstates
      // the unchanged share; given the server's one correction it answers
      // accurately. Other findings and the document account are written as before.
      const cc = EXPECTED_OUTCOMES.connection;
      const ra = EXPECTED_OUTCOMES.navigation;
      assert.deepEqual([cc.pairs, cc.higher, cc.same, cc.lower, ra.pairs, ra.higher, ra.same, ra.lower], [36, 15, 18, 3, 37, 15, 17, 5], "the model wording below is authored for this split");
      const CC_OWN = `Community-connection confidence: participants rated themselves on the brief's five-point self-report scale (1 = very low, 5 = very high). Of the ${cc.pairs} comparable participants, ${cc.higher} (${cc.percentage}%) gave a higher rating at follow-up, ${cc.same} the same rating and ${cc.lower} a lower rating.`;
      const CC_FALSE = "Most comparable participants did not report a change.";
      const CC_ACCURATE = [
        "Exactly half of the 36 comparable participants had unchanged Community-connection confidence scores.",
        "More participants reported higher scores than lower scores, but fewer than half reported higher scores.",
        "A majority, 21 of 36, did not report an increase in Community-connection confidence.",
        "This is some progress for the participants who moved, not an overall favourable change, and without a comparison group it does not show what the programme contributed.",
      ];
      const RA_OWN = `Resource-navigation confidence was also self-rated at both points. Of the ${ra.pairs} comparable participants, ${ra.higher} (${ra.percentage}%) gave a higher rating at follow-up, ${ra.same} the same rating and ${ra.lower} a lower rating. The largest Resource-navigation group was unchanged: 17 of 37, fewer than half of comparable participants. The organization has not yet said whether a higher rating is better, so this is a numerical change, not progress or decline.`;
      assessmentRespond = (requestBody) => {
        const citeOne = (claim) => [{ claimId: claim.claimId, evidenceItemId: claim.evidenceItemId }];
        const documents = requestBody.claims.filter((claim) => claim.limitationCodes.some((code) => code.startsWith("document.")));
        const findings = requestBody.claims.filter((claim) => !documents.includes(claim));
        const own = (claim) => (claim.claimId === O.outcomes.connection.claimId ? `${CC_OWN} ${requestBody.correction ? CC_ACCURATE.join(" ") : CC_FALSE}`
          : claim.claimId === O.outcomes.navigation.claimId ? RA_OWN : claim.plainReading || claim.claimStatement);
        return [
          { section: "executive_snapshot", text: "This assessment brings together the people the programme reached and the participant ratings the organization recorded at baseline and follow-up.", citations: citeOne(requestBody.claims[0]) },
          ...findings.map((claim) => ({ section: "evidence_findings", text: own(claim), citations: citeOne(claim) })),
          { section: "impact_stories", text: documents.map((claim) => claim.claimStatement).join(" "), citations: documents.flatMap(citeOne) },
        ];
      };
      try {
        await openStudioO("Evidence");
        for (const claimId of selected) {
          const row = `[data-client-claim="${claimId}"]`;
          await pageO.waitFor(async () => (await pageO.attrOf(row, "data-client-claim-provisional-draft")) === "admitted", `${claimId}: admitted`, { timeout: 30000 });
          await pageO.clickVisible(`[data-client-select-claim="${claimId}"]`, `${claimId}: Use in an internal draft`);
          await pageO.waitFor(() => pageO.evaluate(`document.querySelector('[data-client-select-claim="${claimId}"]').checked === true`), `${claimId} selected`);
        }
        await pageO.clickTab("Drafts");
        await pageO.idle();
        const calls = modelCalls.length;
        const mark = pageO.mark();
        await pageO.clickButton("Generate Free Impact Assessment");
        await pageO.waitFor(() => pageO.requestsSince(mark).some((r) => r.method === "POST" && r.done), "the generation request", { timeout: 60000 });
        await pageO.idle();
        const posted = pageO.requestsSince(mark).find((r) => r.method === "POST");
        assert.deepEqual([new URL(posted.url).pathname, posted.status], [`${orgPath(O.organizationId)}/generated-content-drafts/free-impact-assessment`, 201]);
        assert.deepEqual([...JSON.parse(posted.postData).claim_ids].sort(), [...selected].sort(), "exactly the visible selection");
        const draftId = (await pageO.responseBody(posted)).data.generatedContentDraftId;

        // The provider's first wording was refused for its interpretation and
        // corrected once; the false sentence was named, never saved.
        const generationCalls = modelCalls.slice(calls);
        assert.equal(generationCalls.length, 2, "one bounded correction");
        assert.equal(generationCalls[0].correction, null);
        assert.ok(J(generationCalls[1].correction).includes("outcome_interpretation"), J(generationCalls[1].correction));
        report.outcomes.browserCorrection = { first_attempt: generationCalls[0].responseBlocks.map((block) => `[${block.section}] ${block.text}`), correction: generationCalls[1].correction,
          second_attempt: generationCalls[1].responseBlocks.map((block) => `[${block.section}] ${block.text}`) };
        // What the provider received: the permitted measurements, their meanings and limitations; no identifier or raw row.
        const call = generationCalls.at(-1);
        assert.ok(call.assessment, "a Free Impact Assessment request");
        assert.deepEqual(call.claims.map((claim) => claim.claimId).sort(), [...selected].sort());
        const sent = (claimId) => call.claims.find((claim) => claim.claimId === claimId);
        assert.match(sent(O.outcomes.connection.claimId).plainReading, /five-point self-report scale \(1 = very low, 5 = very high\)/);
        assert.match(sent(O.outcomes.connection.claimId).plainReading, /The organization states that a higher value is better/);
        assert.match(sent(O.outcomes.navigation.claimId).plainReading, /Whether a higher value is better has not been stated/);
        assert.ok(sent(O.outcomes.connection.claimId).limitationCodes.includes("derived.self_reported"));
        assert.ok(sent(O.docs.C.claimId).limitationCodes.includes("document.source_estimate"));
        assert.doesNotMatch(call.serialized, RAW_IDENTIFIER, "no participant or event identifier reaches the model");

        // The saved assessment, opened from the server by its own id.
        await pageO.waitFor(() => pageO.visible(`[data-client-internal-draft-detail="${draftId}"]`), "the saved assessment opened", { timeout: 30000 });
        const detail = await pageO.textOf(`[data-client-internal-draft-detail="${draftId}"]`);
        for (const claimId of selected) assert.ok(await pageO.textOf(`[data-client-internal-draft-detail="${draftId}"] [data-client-internal-draft-citation="${claimId}"]`), `${claimId} cited`);
        // Who we reached.
        assert.match(detail, new RegExp(`${EXPECTED.people} distinct people on the participant register received at least one completed service`));
        assert.match(detail, new RegExp(`${EXPECTED.eligible} completed service encounters`));
        // What changed, in the organization's terms.
        // The provider's own accurate interpretation is what the customer reads.
        assert.match(detail, /Community-connection confidence: .*five-point self-report scale \(1 = very low, 5 = very high\)/);
        assert.ok(detail.includes(CC_OWN), "community connection, as calculated, in the model's words");
        for (const sentence of CC_ACCURATE) assert.ok(detail.includes(sentence), sentence);
        assert.ok(!detail.includes(CC_FALSE), "the refused reading is not saved");
        assert.ok(detail.includes(RA_OWN), "resource navigation, as calculated, with its direction unresolved");
        assert.match(detail, /Clarification needed: confirm whether a higher Resource-navigation confidence value is better\./);
        const majority = cc.higher * 2 > cc.pairs;
        if (cc.same * 2 <= cc.pairs) {
          assert.doesNotMatch(detail, /\bmost\b[^.\n]*(?:same value|no change|not report a change)/i, "the unchanged group is not called most");
        }
        // Each follow-up observation keeps its own respondent denominator.
        for (const [label, rate] of [["Follow-up response rate", EXPECTED_RATES.response], ["Accessed local support \\(self-reported\\)", EXPECTED_RATES.support]]) {
          assert.match(detail, new RegExp(`${label}: ${rate.numerator} of ${rate.denominator} \\(`));
        }
        assert.match(detail, /What the results suggest:/);
        assert.match(detail, majority ? /Working well: Community-connection confidence/ : /Some progress: Community-connection confidence/);
        if (!majority) assert.doesNotMatch(detail, /Working well: Community-connection confidence/, "a minority result is not presented as working well");
        assert.match(detail, /Proposed change: Record, on each outcome measure that does not yet state it, whether a higher value is better/);
        assert.match(detail, majority ? /Proposed change: Build on the outcome that is moving in the right direction/ : /Proposed change: Ask participants at the follow-up rating what would help them move further/);
        // Follow-up results stay self-reported; the estimate stays a qualified source estimate.
        assert.match(detail, new RegExp(`Joined a community activity \\(self-reported\\): ${EXPECTED_RATES.joined.numerator} of ${EXPECTED_RATES.joined.denominator}`));
        assert.match(detail, /not independently verified/);
        assert.match(detail, /Source-reported, not independently verified \(page \d+[^)]*\): ".*at least 90 different people/);
        assert.doesNotMatch(detail, /KAI (?:calculated|established|verified)[^.]*\b90\b/i);
        // Readable: each section title once, disclosures behind their toggle, no internal keys or identifiers.
        for (const title of ["Executive Impact Snapshot", "What Your Evidence Tells Us", "Impact Stories", "Gaps and Opportunities", "Your Next Steps"]) {
          assert.equal(detail.split(`\n${title}\n`).length - 1, 1, `${title} appears once`);
        }
        assert.doesNotMatch(detail, /Measurement disclosure for/, "disclosures are behind 'Limitations of these figures'");
        assert.ok(await pageO.evaluate(`document.querySelectorAll('[data-client-internal-draft-detail="${draftId}"] [data-client-internal-draft-disclosure]').length > 0`));
        assert.doesNotMatch(detail, /\bfield_\d+\b|\bsheet_\d+\b|\[\[assessment:/);
        assert.doesNotMatch(detail, RAW_IDENTIFIER);

        // Its internal report, through the visible Open report control.
        const reportMark = pageO.mark();
        await pageO.clickVisible(`[data-client-open-internal-report="${draftId}"]`, "Open report");
        await pageO.waitFor(() => pageO.visible("[data-client-internal-report-markdown]"), "the internal report", { timeout: 30000 });
        await pageO.idle();
        assert.equal(pageO.requestsSince(reportMark).find((r) => new URL(r.url).pathname === clientInternalReportMarkdownPath(O.organizationId, O.projectId, draftId))?.status, 200);
        const markdown = await pageO.textOf("[data-client-internal-report-markdown]");
        assert.match(markdown, /\*\*Status:\*\* Working report\./);
        assert.ok(markdown.indexOf("Impact assessment") >= 0 && markdown.indexOf("Impact assessment") < markdown.indexOf("Supporting evidence and method"), "the assessment leads the report");
        assert.ok(markdown.includes(`${cc.higher} (${cc.percentage}%) had a higher value at follow-up`));
        if (cc.same * 2 <= cc.pairs) assert.doesNotMatch(markdown, /\bmost\b[^.\n]*(?:same value|no change|not report a change)/i, "the report does not call the unchanged group most");
        // The report's conclusion agrees with the assessment: favourable only for a majority in the better direction.
        assert.match(markdown, majority
          ? /[Ff]or Community-connection confidence, [^\n]*on that basis this is a favourable observed change\./
          : new RegExp(`[Ff]or Community-connection confidence, [^\\n]*on that basis this is some progress rather than an overall favourable change: more participants moved in the better direction than the worse, but ${cc.higher * 2 === cc.pairs ? "exactly" : "fewer than"} half of the comparable participants did so\\.`));
        if (!majority) assert.doesNotMatch(markdown, /modestly favourable|Working well: Community-connection/);
        // Each qualification is attached to the outcome it concerns (owner
        // direction 2026-11-12): only Resource-navigation confidence lacks a
        // stated direction, so the closing caveat names it, and community
        // connection's stated direction is not covered by it.
        const conclusion = markdown.slice(markdown.indexOf("## Conclusion"), markdown.indexOf("## References"));
        assert.doesNotMatch(conclusion, /the beneficial direction of the measured change is not established/);
        assert.match(conclusion, /[Ii]n the baseline and follow-up comparison for Resource-navigation confidence, [^\n]*Whether a higher value is better has not been established for Resource-navigation confidence, so this is an observed numerical change/);
        assert.match(conclusion, /They do not establish that the programme caused any change: no comparison with people who did not take part is cited, and whether a higher value is better has not been established for Resource-navigation confidence \[CIT-\d+\] \(the organization has stated it for the other measured outcome\)\./);
        assert.doesNotMatch(markdown, /\[\[assessment:/);

        // Reload the page and reopen the same saved assessment.
        await openStudioO("Drafts");
        await pageO.clickVisible(`[data-client-internal-draft="${draftId}"] button`, "Read the saved assessment");
        await pageO.waitFor(() => pageO.visible(`[data-client-internal-draft-detail="${draftId}"]`), "the saved assessment reopened", { timeout: 30000 });
        assert.equal(await pageO.textOf(`[data-client-internal-draft-detail="${draftId}"]`), detail, "the reopened assessment is the same saved content");

        // No review, release or other authority was manufactured.
        const [saved] = await query("SELECT draft_status, review_status FROM kai.generated_content_drafts WHERE generated_content_draft_id = $1::uuid", [draftId]);
        assert.deepEqual([saved.draft_status, saved.review_status], ["draft", "needs_gk_review"]);
        assert.deepEqual(await counts(O.organizationId), { ...approvalsBefore, drafts: approvalsBefore.drafts + 1 }, "only the draft was written");
        assert.deepEqual(pageO.exceptions, []);
        report.outcomes.browser = { draft_id: draftId, selected, generation: [new URL(posted.url).pathname, posted.status], detail_characters: detail.length };
        if (REPORT_PATH) {
          writeFileSync(REPORT_PATH.replace(/\.json$/, "") + ".outcome-assessment.txt", detail);
          writeFileSync(REPORT_PATH.replace(/\.json$/, "") + ".outcome-internal-report.md", markdown);
        }
      } finally {
        assessmentRespond = null;
        await pageO.close().catch(() => {});
      }
    });

    // O5 (owner direction 2026-11-12, "Close the remaining impact-interpretation
    // integrity gap"): the provider writes its own interpretation of the same two
    // outcome measurements - never a copy of plainReading - and the real route,
    // validators, correction, restatement, composition and persistence decide
    // what is saved. Each case's sentence is placed in the block that cites the
    // outcome it concerns; the provider repeats it on the correction attempt (a
    // model that does not fix it), so the saved result shows the fallback.
    await test("O5 (API): independently worded provider interpretations: false readings of the outcome results never reach the saved assessment or report; accurate ones are kept", async () => {
      const cc = EXPECTED_OUTCOMES.connection;
      const ra = EXPECTED_OUTCOMES.navigation;
      // The case sentences are authored for the workbook's own split (O2 recomputes it).
      assert.deepEqual([cc.pairs, cc.higher, cc.same, cc.lower], [36, 15, 18, 3]);
      assert.deepEqual([ra.pairs, ra.higher, ra.same, ra.lower], [37, 15, 17, 5]);
      const CC = O.outcomes.connection;
      const RA = O.outcomes.navigation;
      const cite = (...entries) => entries.map((entry) => ({ claimId: entry.claimId, evidenceItemId: entry.evidenceItemId }));
      // Model-style findings for each outcome, in the provider's own words.
      const ccFacts = `Community-connection confidence was self-rated on the brief's five-point scale at baseline and follow-up. Of the ${cc.pairs} comparable participants, ${cc.higher} (${cc.percentage}%) rated themselves higher at follow-up, ${cc.same} gave the same rating and ${cc.lower} rated themselves lower.`;
      const raFacts = `Resource-navigation confidence was also self-rated at both points. Of the ${ra.pairs} comparable participants, ${ra.higher} (${ra.percentage}%) gave a higher rating at follow-up, ${ra.same} the same rating and ${ra.lower} a lower rating; the organization has not yet said whether a higher rating is better.`;
      const CASES = [
        { key: "F1", target: "connection", expect: "refused", sentence: "Most comparable participants did not report a change." },
        { key: "F2", target: "connection", expect: "refused", sentence: "A majority of participants improved their Community-connection confidence." },
        { key: "F3", target: "connection", expect: "refused", sentence: "The programme produced an overall favourable improvement in Community-connection confidence." },
        { key: "F4", target: "navigation", expect: "refused", sentence: "Resource-navigation confidence improved for participants." },
        { key: "F5", target: "snapshot", expect: "refused", sentence: "Both measured outcomes show that the programme improved participant outcomes." },
        { key: "A1", target: "connection", expect: "kept", sentence: "Exactly half of the 36 comparable participants had unchanged Community-connection confidence scores." },
        { key: "A2", target: "connection", expect: "kept", sentence: "More participants reported higher scores than lower scores, but fewer than half reported higher scores." },
        { key: "A3", target: "connection", expect: "kept", sentence: "A majority, 21 of 36, did not report an increase in Community-connection confidence." },
        { key: "A4", target: "navigation", expect: "kept", sentence: "The largest Resource-navigation group was unchanged: 17 of 37, fewer than half of comparable participants." },
      ];
      const SNAPSHOT = "This assessment covers two participant self-ratings recorded at baseline and follow-up.";
      const selected = [CC.claimId, RA.claimId];
      const blocksOf = (sql, draftId) => query(sql, [draftId]);
      report.outcomes.interpretation = {};
      const failures = [];
      try {
        for (const testCase of CASES) {
          const add = (target, text) => (testCase.target === target ? `${text} ${testCase.sentence}` : text);
          assessmentRespond = () => [
            { section: "executive_snapshot", text: add("snapshot", SNAPSHOT), citations: cite(CC, RA) },
            { section: "evidence_findings", text: add("connection", ccFacts), citations: cite(CC) },
            { section: "evidence_findings", text: add("navigation", raFacts), citations: cite(RA) },
            { section: "impact_stories", text: "No participant account is stated beyond the cited findings.", citations: cite(CC) },
          ];
          const calls = modelCalls.length;
          const created = await O.api("POST", createFreeImpactAssessmentPath(O.organizationId), { claim_ids: selected, idempotency_key: `o5-${testCase.key}-${randomUUID()}`, engagement_id: O.projectId });
          const sent = modelCalls.slice(calls);
          assert.equal(created.status, 201, `${testCase.key}: ${J(created.body)}`);
          const draftId = created.body.data.generatedContentDraftId;
          const [{ validator_results: results }] = await query("SELECT validator_results FROM kai.generated_content_drafts WHERE generated_content_draft_id = $1::uuid", [draftId]);
          const saved = await blocksOf(`SELECT b.ordinal, b.text, array_agg(c.claim_id::text ORDER BY c.claim_id) AS claim_ids FROM kai.generated_content_blocks b
            JOIN kai.generated_content_citations c ON c.generated_content_block_id = b.generated_content_block_id WHERE b.generated_content_draft_id = $1::uuid GROUP BY b.ordinal, b.text ORDER BY b.ordinal`, draftId);
          const savedText = saved.map((block) => block.text).join("\n");
          const reads = await clientReads(O, draftId);
          const detail = await O.api("GET", clientInternalDraftPath(O.organizationId, O.projectId, draftId));
          const detailText = J(detail.body);
          const [status] = await query("SELECT draft_status, review_status FROM kai.generated_content_drafts WHERE generated_content_draft_id = $1::uuid", [draftId]);
          const entry = {
            target: testCase.target, sentence: testCase.sentence, expected: testCase.expect,
            provider_calls: sent.length,
            provider_text: sent.map((call) => call.responseBlocks?.map((block) => `[${block.section}] ${block.text}`)),
            correction: sent.map((call) => call.correction).filter(Boolean),
            fallback: (results || []).filter((result) => ["KAI-GEN-WORDING-FALLBACK-001", "VAL-GEN-ASSESSMENT-001"].includes(result.validator_key)).map((result) => ({ key: result.validator_key, evidence: result.evidence })),
            saved_blocks: saved.map((block) => ({ ordinal: block.ordinal, claims: block.claim_ids.map((id) => (id === CC.claimId ? "CC" : id === RA.claimId ? "RA" : id)), text: block.text })),
            report_markdown_status: reads.markdown, draft: status,
          };
          report.outcomes.interpretation[testCase.key] = entry;
          if (REPORT_PATH) writeFileSync(REPORT_PATH.replace(/\.json$/, "") + `.o5-${testCase.key}.md`, reads.markdownText ?? "");
          entry.saved_contains_sentence = savedText.includes(testCase.sentence);
          entry.report_contains_sentence = (reads.markdownText || "").includes(testCase.sentence);
          try {
          assert.deepEqual([status.draft_status, status.review_status], ["draft", "needs_gk_review"], testCase.key);
          assert.equal(reads.markdown, 200, testCase.key);
          if (testCase.expect === "refused") {
            assert.ok(!savedText.includes(testCase.sentence), `${testCase.key}: the false reading is not saved: ${J(entry)}`);
            assert.ok(!detailText.includes(testCase.sentence), `${testCase.key}: not shown to the customer`);
            assert.ok(!(reads.markdownText || "").includes(testCase.sentence), `${testCase.key}: not in the report`);
            assert.equal(sent.length, 2, `${testCase.key}: one bounded correction was asked for`);
            assert.ok(J(sent[1].correction).includes("outcome_interpretation"), `${testCase.key}: the correction names the refused interpretation: ${J(sent[1].correction)}`);
            // The useful, accurate reading survives the fallback: each outcome's
            // finding is still stated with its counts, unchanged share and direction status.
            assert.ok(savedText.includes(`Exactly half of the comparable participants, ${cc.same} of ${cc.pairs}, had the same value at follow-up.`) || savedText.includes(ccFacts), `${testCase.key}: CC finding kept`);
            assert.ok(savedText.includes("Whether a higher value is better has not been stated") || savedText.includes(raFacts), `${testCase.key}: RA direction status kept`);
            assert.ok(savedText.includes(`${cc.higher} (${cc.percentage}%)`) && savedText.includes(`${ra.higher} (${ra.percentage}%)`), `${testCase.key}: both results kept`);
          } else {
            assert.ok(savedText.includes(testCase.sentence), `${testCase.key}: the accurate reading is kept: ${J(entry)}`);
            assert.ok((reads.markdownText || "").includes(testCase.sentence), `${testCase.key}: and reaches the report`);
            assert.equal(sent.length, 1, `${testCase.key}: no correction was needed`);
          }
          } catch (error) {
            failures.push(`${testCase.key}: ${error.message.slice(0, 300)}`);
          }
        }
      } finally {
        assessmentRespond = null;
      }
      // Every case is run and recorded before any is reported.
      assert.deepEqual(failures, [], J(Object.fromEntries(Object.entries(report.outcomes.interpretation).map(([key, entry]) => [key, { expected: entry.expected, saved: entry.saved_contains_sentence, report: entry.report_contains_sentence, provider_calls: entry.provider_calls }]))));
    });

    await test("reporting-period note (HTTP, PostgreSQL, browser): the owner's exact statement goes from line 11 to a reusable report with zero evidence or claim reviews", async () => {
      const excerpt = "Staff also entered some March preparation work into a file used for the April-to-March review, and a few spring records belong to the following fiscal year.";
      const bytes = Buffer.from(`${"\n".repeat(10)}${excerpt}\n`);
      const source = await uploadAndPromote(P, { key: "period_note", name: "05_operations_and_interpretation_notes.txt",
        extension: ".txt", mime: "text/plain", bytes, checksum: sha256(bytes), permissions: DECISIONS.notes });
      await extract(P, source);
      const evidence = (await documentRows(P, source.sourceVersionId)).find((row) => row.statement.includes(excerpt));
      assert.ok(evidence, "the source statement is extracted from the actual uploaded bytes");
      const proposed = await P.api("POST", claimProposalPath(P.organizationId, evidence.evidence_item_id), {});
      assert.ok([200, 201].includes(proposed.status), J(proposed.body));
      const claimId = proposed.body.data.claim.claim_id;
      const diagnosis = await diagnose(P, claimId);
      assert.deepEqual([diagnosis.strictEligible, diagnosis.provisional?.admitted], [true, true]);
      const decisions = async () => (await query(`SELECT
        (SELECT count(*) FROM kai.claim_review_decisions WHERE claim_id = $1::uuid)::int AS claim_reviews,
        (SELECT count(*) FROM kai.evidence_review_decisions WHERE evidence_item_id = $2::uuid)::int AS evidence_reviews`, [claimId, evidence.evidence_item_id]))[0];
      assert.deepEqual(await decisions(), { claim_reviews: 0, evidence_reviews: 0 });
      await openStudio("Evidence");
      const row = `[data-client-claim="${claimId}"]`;
      await page.waitFor(async () => /Ready to use in your report\./.test((await page.textOf(row)) || ""), "the reporting-period finding is ready without review");
      const shown = await page.textOf(row);
      assert.doesNotMatch(shown, /Before final use|no completed review|never for funder|needs_gk_review|Support strength/);
      await page.clickVisible(`[data-client-select-claim="${claimId}"]`, "Use the reporting-period note");
      await page.clickTab("Drafts");
      const mark = page.mark();
      await page.clickButton("Generate internal evidence summary");
      await page.waitFor(() => page.visible("[data-client-generated-draft]"), "a report from the reporting-period note", { timeout: 60000 });
      await page.idle();
      const post = page.requestsSince(mark).find((request) => request.method === "POST" && new URL(request.url).pathname === createEvidenceSummaryPath(P.organizationId));
      assert.equal(post?.status, 201);
      assert.deepEqual(JSON.parse(post.postData).claim_ids, [claimId]);
      const draftId = (await page.responseBody(post)).data.generatedContentDraftId;
      const readInBrowser = async () => {
        await openStudio("Drafts");
        await page.clickVisible(`[data-client-internal-draft="${draftId}"] button`, "Read the reporting-period report");
        await page.waitFor(() => page.visible(`[data-client-open-internal-report="${draftId}"]`), "report available without release approval");
        await page.clickVisible(`[data-client-open-internal-report="${draftId}"]`, "Open report");
        await page.waitFor(() => page.visible("[data-client-internal-report-markdown]"), "the reporting-period report opens");
        return page.textOf("[data-client-internal-report-markdown]");
      };
      const markdown = await readInBrowser();
      assert.ok(markdown.includes(excerpt));
      assert.ok(markdown.includes(claimId) && markdown.includes(source.sourceVersionId));
      assert.doesNotMatch(markdown, /Review for final use complete|not approved for release|no completed review/);
      assert.equal(await readInBrowser(), markdown, "reload reopens the same saved report");
      assert.deepEqual(await decisions(), { claim_reviews: 0, evidence_reviews: 0 });
      report.browser.reporting_period_note = { claim_id: claimId, source_version_id: source.sourceVersionId, generated_draft_id: draftId,
        generation_status: post.status, review_decisions: await decisions(), reopened_identical: true };
      if (REPORT_PATH) writeFileSync(REPORT_PATH.replace(/\.json$/, "") + ".reporting-period-note.md", markdown);
    });

    await test("assessment document guidance (browser, HTTP, PostgreSQL): nested source quotes in findings block seven save and reopen without review decisions", async () => {
      const excerpt = 'Records marked "confirmed" should be reconciled before the annual review is completed.';
      const bytes = Buffer.from(`${"\n".repeat(10)}${excerpt}\n`);
      const source = await uploadAndPromote(P, { key: "quoted_guidance", name: "annual_review_guidance.txt",
        extension: ".txt", mime: "text/plain", bytes, checksum: sha256(bytes), permissions: DECISIONS.notes });
      await extract(P, source);
      const evidence = (await documentRows(P, source.sourceVersionId)).find((row) => row.statement.includes(excerpt));
      assert.ok(evidence);
      const proposed = await P.api("POST", claimProposalPath(P.organizationId, evidence.evidence_item_id), {});
      assert.ok([200, 201].includes(proposed.status), J(proposed.body));
      const claimId = proposed.body.data.claim.claim_id;
      const decisions = async () => (await query(`SELECT
        (SELECT count(*) FROM kai.claim_review_decisions WHERE claim_id = $1::uuid)::int AS claim_reviews,
        (SELECT count(*) FROM kai.evidence_review_decisions WHERE evidence_item_id = $2::uuid)::int AS evidence_reviews`, [claimId, evidence.evidence_item_id]))[0];
      assert.deepEqual(await decisions(), { claim_reviews: 0, evidence_reviews: 0 });
      // The supplied response puts the intact source quotation in precisely
      // the reported findings block. External prose generation is simulated;
      // composition, validation, SQL writes and subsequent reads are real.
      assessmentRespond = (body) => {
        const claim = body.claims.find((item) => item.claimId === claimId);
        assert.ok(claim.limitationCodes.includes("document.method_or_instruction"));
        const citations = [{ claimId, evidenceItemId: claim.evidenceItemId }];
        return [
          { section: "executive_snapshot", text: "The document supplies guidance for preparing the annual review.", citations },
          ...Array.from({ length: 6 }, (_, index) => ({ section: "evidence_findings",
            text: index === 5 ? claim.claimStatement : "The source describes a proposed step for preparing the annual review.", citations })),
          { section: "impact_stories", text: "No participant account is stated beyond the cited findings.", citations },
        ];
      };
      const callCount = modelCalls.length;
      try {
        await openStudio("Evidence");
        await page.clickVisible(`[data-client-select-claim="${claimId}"]`, "Use the document guidance");
        await page.clickTab("Drafts");
        const mark = page.mark();
        await page.clickButton("Generate Free Impact Assessment");
        await page.waitFor(() => page.visible("[data-client-generated-draft]"), "the guidance assessment is saved", { timeout: 60000 });
        await page.idle();
        const posted = page.requestsSince(mark).find((request) => request.method === "POST"
          && new URL(request.url).pathname === `${orgPath(P.organizationId)}/generated-content-drafts/free-impact-assessment`);
        assert.equal(posted?.status, 201, J(posted));
        assert.deepEqual(JSON.parse(posted.postData).claim_ids, [claimId]);
        const draftId = (await page.responseBody(posted)).data.generatedContentDraftId;
        const saved = await query("SELECT ordinal, text FROM kai.generated_content_blocks WHERE generated_content_draft_id = $1::uuid ORDER BY ordinal", [draftId]);
        assert.ok(saved.find((block) => block.ordinal === 7)?.text.includes(excerpt), J(saved));
        assert.equal(modelCalls.length - callCount, 1, "an exact quotation requires no model correction");
        const readReport = async () => {
          await openStudio("Drafts");
          await page.clickVisible(`[data-client-internal-draft="${draftId}"] button`, "Read the saved guidance assessment");
          await page.waitFor(() => page.visible(`[data-client-open-internal-report="${draftId}"]`), "the report is available");
          await page.clickVisible(`[data-client-open-internal-report="${draftId}"]`, "Open report");
          await page.waitFor(() => page.visible("[data-client-internal-report-markdown]"), "the guidance report opens");
          return page.textOf("[data-client-internal-report-markdown]");
        };
        const markdown = await readReport();
        assert.ok(markdown.includes(excerpt));
        assert.match(markdown, /Source-reported method or guidance/);
        assert.match(markdown, /does not show that the step was carried out/);
        assert.doesNotMatch(markdown, /KAI confirmed and reconciled/);
        assert.equal(await readReport(), markdown, "reload opens the identical saved report");
        assert.deepEqual(await decisions(), { claim_reviews: 0, evidence_reviews: 0 });
        report.browser.quoted_guidance_assessment = { generation_status: posted.status, draft_id: draftId,
          finding_ordinal: 7, model_calls: modelCalls.length - callCount, review_decisions: await decisions(), reopened_identical: true };
      } finally {
        assessmentRespond = null;
      }
    });

    // ---- J: "Use this assessment" -> purpose report -> revision -> download (owner direction 2026-11-20) ----
    // The organization's saved Free Impact Assessment from O4 is the source.
    // Real: every route, service, repository, validator and SQL write on this
    // cluster; the built bundle in Chrome. Simulated: the session login,
    // object storage, malware scan and the model provider (deterministic; it
    // carries the saved passages forward and never invents text).
    const WR = { reports: {}, negatives: {}, persistence: {} };
    report.workingReports = WR;
    const ARTIFACTS = process.env.KAI_WORKING_REPORT_ARTIFACTS || null;
    if (ARTIFACTS) mkdirSync(ARTIFACTS, { recursive: true });
    const savedBlocks = async (draftId) => query(`SELECT b.ordinal, b.text,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('claimId', c.claim_id::text, 'evidenceItemId', c.evidence_item_id::text) ORDER BY c.claim_id, c.evidence_item_id)
           FROM kai.generated_content_citations c WHERE c.generated_content_block_id = b.generated_content_block_id), '[]'::jsonb) AS citations
       FROM kai.generated_content_blocks b WHERE b.organization_id = $1::uuid AND b.generated_content_draft_id = $2::uuid ORDER BY b.ordinal`, [O.organizationId, draftId]);
    const draftRow = async (draftId) => (await query(`SELECT d.content_type, d.requested_audience, d.draft_status, d.review_status, d.created_by_type,
        d.validator_results, r.engagement_id::text AS engagement_id, r.idempotency_key
       FROM kai.generated_content_drafts d JOIN kai.generation_runs r ON r.generation_run_id = d.generation_run_id AND r.organization_id = d.organization_id
      WHERE d.organization_id = $1::uuid AND d.generated_content_draft_id = $2::uuid`, [O.organizationId, draftId]))[0];
    const lineageOfRow = (row) => (row?.validator_results || []).find((result) => result.validator_key === "KAI-REPORT-LINEAGE-001")?.evidence ?? null;
    // The test's own fingerprint of saved content (independent of KAI's).
    const fingerprint = (blocks) => sha256(J(blocks.map((block) => [block.ordinal, block.text, block.citations.map((c) => `${c.claimId}:${c.evidenceItemId}`).sort()])));
    const WITHOUT_TAILS = (text) => text.replace(/\s*Measurement disclosure for [\s\S]*$/, "").replace(/\s*Selection note: [\s\S]*$/, "").trim();
    const bodyOf = (text) => text.replace(/^\[\[assessment:[a-z_]+\]\]\n/, "");
    const workingCounts = async () => ({ ...(await counts(O.organizationId)), ...(await query(`SELECT
        (SELECT count(*) FROM kai.limitation_snapshots WHERE organization_id = $1::uuid)::int AS limitation_snapshots,
        (SELECT count(*) FROM kai.export_manifests WHERE organization_id = $1::uuid)::int AS manifests,
        (SELECT count(*) FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'export_review')::int AS export_reviews,
        (SELECT count(*) FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'generated_content_review' AND queue_status <> 'open')::int AS draft_reviews_started,
        (SELECT count(*) FROM kai.client_followup_items WHERE organization_id = $1::uuid)::int AS client_followups`, [O.organizationId]))[0] });
    const assessmentId = () => report.outcomes.browser.draft_id;
    let assessmentBefore = null;
    let approvalsBefore = null;
    let pageJ = null;
    // Scenario J runs on the real application page (Bootstrap and site styles).
    const J_PAGE = "/impact-library-app";
    const openStudioJ = async (view) => {
      await pageJ.goto(J_PAGE);
      await pageJ.clickNav("Knowledge Studio");
      await pageJ.waitFor(() => pageJ.visible("#gk-shell-project-select"), "the Project selector");
      await pageJ.idle();
      await pageJ.selectProject(O.projectId);
      await pageJ.idle();
      await pageJ.clickTab(view);
      await pageJ.idle();
    };
    const openSaved = async (draftId, label) => {
      await openStudioJ("Drafts");
      await pageJ.clickVisible(`[data-client-internal-draft-open="${draftId}"]`, `Open ${label}`);
      await pageJ.waitFor(() => pageJ.visible(`[data-client-internal-draft-detail="${draftId}"]`), `${label} opened`, { timeout: 30000 });
      await pageJ.idle();
    };
    // The shown report and the downloaded file, through the visible controls.
    const openAndDownload = async (draftId, label) => {
      const mark = pageJ.mark();
      await pageJ.clickVisible(`[data-client-open-internal-report="${draftId}"]`, `Open ${label} report`);
      await pageJ.waitFor(() => pageJ.visible("[data-client-internal-report-markdown]"), `${label} report shown`, { timeout: 30000 });
      await pageJ.idle();
      assert.deepEqual(pageJ.requestsSince(mark).filter((r) => r.method !== "GET"), [], "opening a report writes nothing");
      const shown = await pageJ.textOf("[data-client-internal-report-markdown]");
      const href = await pageJ.attrOf(`[data-client-download-internal-report="${draftId}"]`, "href");
      assert.equal(href, clientInternalReportMarkdownPath(O.organizationId, O.projectId, draftId));
      const downloaded = await pageJ.evaluate(`(async () => { const r = await fetch(${J(href)}, { credentials: "same-origin" });
        return { status: r.status, disposition: r.headers.get("content-disposition"), body: await r.text() }; })()`);
      assert.equal(downloaded.status, 200);
      assert.match(downloaded.disposition || "", /attachment/);
      assert.equal(downloaded.body.trimEnd(), shown.trimEnd(), `${label}: the download is the report shown`);
      return downloaded.body;
    };
    const setTextarea = (selector, value) => pageJ.evaluate(`(() => {
      const el = document.querySelector(${J(selector)});
      if (!el || el.offsetParent === null || el.disabled) return false;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(el, ${J(value)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
    // Layout at a width: the panel fits its column and every control is inside the viewport.
    const fits = (selector) => pageJ.evaluate(`(() => {
      const el = document.querySelector(${J(selector)});
      if (!el) return { found: false };
      const controls = [...el.querySelectorAll("button, input, textarea, label")].filter((c) => c.offsetParent !== null);
      return { found: true, panelScroll: el.scrollWidth, panelClient: el.clientWidth, innerWidth: window.innerWidth,
        outside: controls.filter((c) => { const r = c.getBoundingClientRect(); return r.right > window.innerWidth + 1 || r.left < -1; }).length };
    })()`);
    // The real page has a fixed site header and (on phones) a fixed bottom tab
    // bar; the app shell scrolls inside its own area. A capture keeps the page
    // at the top and scrolls the shell's area so the region starts just below
    // its visible top ("top"), or a small control sits in the middle ("center").
    const screenshot = async (name, selector, align = "top") => {
      if (!ARTIFACTS) return;
      if (selector) {
        await pageJ.evaluate(`(() => {
          const el = document.querySelector(${J(selector)});
          if (!el) return false;
          window.scrollTo(0, 0);
          let area = el.parentElement;
          while (area && area !== document.body) {
            if (/(auto|scroll)/.test(getComputedStyle(area).overflowY) && area.scrollHeight > area.clientHeight + 1) break;
            area = area.parentElement;
          }
          if (!area || area === document.body) { el.scrollIntoView({ behavior: "instant", block: "center" }); return true; }
          const a = area.getBoundingClientRect();
          const r = el.getBoundingClientRect();
          area.scrollTop += ${J(align)} === "center" ? (r.top - a.top) - (Math.min(a.height, window.innerHeight - a.top) - r.height) / 2 : (r.top - a.top) - 12;
          return true;
        })()`);
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
      const { data } = await browser.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, pageJ.sessionId);
      writeFileSync(join(ARTIFACTS, `${name}.png`), Buffer.from(data, "base64"));
    };

    // --- Real-page helpers (owner task 2026-11-21: styling, exact downloads, context switches) ---
    const DESKTOP_J = Object.freeze({ width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    const PHONE_J = Object.freeze({ width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    const viewportJ = async (metrics) => {
      await browser.send("Page.bringToFront", {}, pageJ.sessionId);
      await browser.send("Emulation.setDeviceMetricsOverride", metrics, pageJ.sessionId);
      await new Promise((resolve) => setTimeout(resolve, 300));
    };
    // A real mouse click at the centre of a visible, enabled control that
    // nothing covers (hit-tested at that point), as a person clicks it.
    const realClick = async (selector, description) => {
      await pageJ.waitFor(() => pageJ.evaluate(`(() => { const el = document.querySelector(${J(selector)});
        return Boolean(el && el.offsetParent !== null && !el.disabled && !el.closest("[hidden]")); })()`), description, { timeout: 30000 });
      await browser.send("Page.bringToFront", {}, pageJ.sessionId);
      const point = await pageJ.evaluate(`(() => {
        const el = document.querySelector(${J(selector)});
        el.scrollIntoView({ behavior: "instant", block: "center", inline: "nearest" });
        const r = el.getBoundingClientRect();
        const x = r.x + Math.min(r.width / 2, 20), y = r.y + r.height / 2;
        const target = document.elementFromPoint(x, y);
        const hit = el === target || el.contains(target) || Boolean(target?.closest("label")?.contains(el));
        return hit ? { x, y } : { blockedBy: target ? target.outerHTML.slice(0, 200) : "nothing at that point" };
      })()`);
      if (point.blockedBy !== undefined) throw new Error(`${description}: not clickable, covered by ${point.blockedBy}`);
      for (const type of ["mousePressed", "mouseReleased"]) {
        await browser.send("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: "left", clickCount: 1 }, pageJ.sessionId);
      }
    };
    const checked = (selector) => pageJ.evaluate(`Boolean(document.querySelector(${J(selector)})?.checked)`);
    // Hold a real server response (CDP Fetch at the response stage) so the
    // administrator can act before it arrives; release delivers it unchanged.
    const held = [];
    const holdListener = (message) => {
      if (message.sessionId === pageJ.sessionId && message.method === "Fetch.requestPaused") held.push(message.params);
    };
    const holdResponses = async (urlPattern) => {
      held.length = 0;
      browser.listeners.add(holdListener);
      await browser.send("Fetch.enable", { patterns: [{ urlPattern, requestStage: "Response" }] }, pageJ.sessionId);
    };
    const releaseHeld = async () => {
      for (const params of held.splice(0)) await browser.send("Fetch.continueRequest", { requestId: params.requestId }, pageJ.sessionId);
      await browser.send("Fetch.disable", {}, pageJ.sessionId);
      browser.listeners.delete(holdListener);
    };
    // The real stylesheet stack, as the browser applied it.
    const styleAudit = () => pageJ.evaluate(`(() => {
      const sheets = [...document.styleSheets];
      const bootstrap = sheets.find((s) => (s.href || "").includes("bootstrap@5.3.5/dist/css/bootstrap.min.css"));
      let rules = 0; try { rules = bootstrap ? bootstrap.cssRules.length : 0; } catch { rules = -1; }
      const probe = document.createElement("button"); probe.className = "btn btn-primary"; document.body.appendChild(probe);
      const btnPrimaryBackground = getComputedStyle(probe).backgroundColor; probe.remove();
      return { bootstrapSheet: Boolean(bootstrap), bootstrapRules: rules, btnPrimaryBackground,
        appCss: sheets.some((s) => (s.href || "").endsWith("/css/style.css")), tokensCss: sheets.some((s) => (s.href || "").endsWith("/css/gk-design-tokens.css")),
        siteHeader: Boolean(document.querySelector("header, nav")), bodyFont: getComputedStyle(document.body).fontFamily.slice(0, 80) };
    })()`);
    // Layout of one region: page-level horizontal overflow, controls outside the
    // screen, and controls another element covers at their own centre.
    const layoutAudit = (selector) => pageJ.evaluate(`(() => {
      const root = document.querySelector(${J(selector)});
      if (!root) return { found: false };
      const doc = document.documentElement;
      const controls = [...root.querySelectorAll("button, a[href], input, select, textarea, summary")]
        .filter((el) => el.offsetParent !== null && !el.closest("[hidden]") && !el.closest("details:not([open]) > :not(summary)"));
      const outside = [];
      const covered = [];
      for (const el of controls) {
        el.scrollIntoView({ behavior: "instant", block: "center", inline: "nearest" });
        const r = el.getBoundingClientRect();
        if (r.right > window.innerWidth + 1 || r.left < -1 || r.width === 0 || r.height === 0) { outside.push(el.outerHTML.slice(0, 120)); continue; }
        const target = document.elementFromPoint(r.x + Math.min(r.width / 2, 20), r.y + r.height / 2);
        if (!(el === target || el.contains(target) || target?.closest("label")?.contains(el))) covered.push(el.outerHTML.slice(0, 100) + " <- " + (target ? target.outerHTML.slice(0, 100) : "nothing"));
      }
      root.scrollIntoView({ behavior: "instant", block: "start" });
      const clippedText = [...root.querySelectorAll("button, a.btn, label, .alert")].filter((el) => el.offsetParent !== null
        && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "visible").map((el) => el.outerHTML.slice(0, 100));
      return { found: true, innerWidth: window.innerWidth, docScrollWidth: doc.scrollWidth, bodyScrollWidth: document.body.scrollWidth,
        panelScroll: root.scrollWidth, panelClient: root.clientWidth, controls: controls.length, outside, covered, clippedText };
    })()`);
    const assertLayout = (label, layout, width) => {
      assert.ok(layout.found, label);
      assert.equal(layout.innerWidth, width, `${label}: viewport`);
      assert.ok(layout.docScrollWidth <= width + 1 && layout.bodyScrollWidth <= width + 1, `${label}: no page-level horizontal overflow ${J(layout)}`);
      assert.ok(layout.panelScroll <= layout.panelClient + 1, `${label}: the region fits its column ${J(layout)}`);
      assert.deepEqual([layout.outside, layout.covered, layout.clippedText], [[], [], []], `${label}: every control on screen, uncovered and unclipped ${J(layout)}`);
      assert.ok(layout.controls > 0, label);
    };
    // The server-persisted Markdown of a working report: the established
    // serializer over the persisted report model, read directly from
    // PostgreSQL (no route, service or browser).
    const { createPostgresClientInternalReportRepository } = await import("../Backend/kai/dictionary/postgresClientInternalReportRepository.js");
    const { serializeInternalReportToMarkdown } = await import("../Backend/kai/services/kaiInternalReportMarkdownSerializer.js");
    const { savedContentSha256 } = await import("../Backend/kai/services/kaiAssessmentAdaptation.js");
    const persistedMarkdown = async (draftId) => {
      const read = await createPostgresClientInternalReportRepository().readInternalReport({ organizationId: O.organizationId, generatedContentDraftId: draftId });
      assert.equal(read.ok, true, J(read.error));
      assert.equal(read.data.available, true, J({ gk: read.data.getKinderReviewReasons, blocked: read.data.blockedReasons }));
      return serializeInternalReportToMarkdown(read.data);
    };
    // Open the report with its visible control, download it with the link the
    // page offers, and compare the bytes with the server-persisted Markdown.
    const exactDownload = async (draftId, label) => {
      const expected = Buffer.from(await persistedMarkdown(draftId), "utf8");
      const mark = pageJ.mark();
      await realClick(`[data-client-open-internal-report="${draftId}"]`, `Open report (${label})`);
      await pageJ.waitFor(() => pageJ.visible("[data-client-internal-report-markdown]"), `${label}: report shown`, { timeout: 30000 });
      await pageJ.idle();
      assert.deepEqual(pageJ.requestsSince(mark).filter((r) => r.method !== "GET"), [], `${label}: opening writes nothing`);
      const shown = await pageJ.evaluate(`document.querySelector("[data-client-internal-report-markdown]").textContent`);
      const link = `[data-client-download-internal-report="${draftId}"]`;
      const href = await pageJ.attrOf(link, "href");
      assert.equal(href, clientInternalReportMarkdownPath(O.organizationId, O.projectId, draftId), `${label}: the link downloads this saved report`);
      const fetched = await pageJ.evaluate(`(async () => { const r = await fetch(${J(href)}, { credentials: "same-origin" });
        const bytes = new Uint8Array(await r.arrayBuffer()); let binary = ""; for (const b of bytes) binary += String.fromCharCode(b);
        return { status: r.status, type: r.headers.get("content-type"), disposition: r.headers.get("content-disposition"), base64: btoa(binary) }; })()`);
      const downloaded = Buffer.from(fetched.base64, "base64");
      assert.equal(fetched.status, 200, label);
      assert.match(fetched.disposition || "", /attachment/, label);
      assert.ok(downloaded.equals(expected), `${label}: downloaded bytes equal the server-persisted Markdown (${downloaded.length} vs ${expected.length} bytes; first difference at ${[...downloaded].findIndex((b, i) => b !== expected[i])})`);
      assert.equal(shown, expected.toString("utf8"), `${label}: the report shown is the saved Markdown, character for character`);
      // The real download: a person's click on the visible Download link; the
      // file the browser saves is named as the link offers and holds exactly
      // the server-persisted Markdown.
      const offeredName = await pageJ.attrOf(link, "download");
      const saved = await browserDownload(link, `${label}: Download Markdown`);
      assert.equal(saved.suggestedFilename, offeredName, `${label}: the browser saves the file under the name the page shows (${J(saved)})`);
      assert.ok(saved.bytes.equals(expected), `${label}: the saved file is the server-persisted Markdown, byte for byte`);
      return { bytes: downloaded.length, sha256: sha256(downloaded), content_type: fetched.type, disposition: fetched.disposition,
        download_name: offeredName, saved_file_name: saved.suggestedFilename, saved_file_sha256: sha256(saved.bytes), markdown: expected.toString("utf8") };
    };
    // Browser downloads for the page's own browser context, saved to the
    // runner's work directory (removed with it).
    let downloadCount = 0;
    const browserDownload = async (selector, description) => {
      const { targetInfo } = await browser.send("Target.getTargetInfo", {}, pageJ.sessionId);
      downloadCount += 1;
      const dir = join(WORKDIR, "j-downloads", String(downloadCount));
      mkdirSync(dir, { recursive: true });
      await browser.send("Browser.setDownloadBehavior", { behavior: "allow", browserContextId: targetInfo.browserContextId, downloadPath: dir, eventsEnabled: true });
      let begun = null;
      let finished = null;
      const listener = (message) => {
        if (message.method === "Browser.downloadWillBegin" && !begun) begun = message.params;
        if (message.method === "Browser.downloadProgress" && begun && message.params.guid === begun.guid && ["completed", "canceled"].includes(message.params.state)) finished = message.params;
      };
      browser.listeners.add(listener);
      try {
        await realClick(selector, description);
        await pageJ.waitFor(async () => Boolean(finished), `${description}: the browser download`, { timeout: 30000 });
      } finally {
        browser.listeners.delete(listener);
      }
      assert.equal(finished.state, "completed", description);
      return { suggestedFilename: begun.suggestedFilename, bytes: readFileSync(join(dir, begun.suggestedFilename)) };
    };
    // A second Project of organization O (synthetic), for the context switches.
    const SECOND_PROJECT = "7d000000-0000-4000-8000-0000000000b4";
    const adaptViaApi = (body, sourceId = assessmentId(), api = O.api) => api("POST", assessmentAdaptationPath(O.organizationId, sourceId), body);
    const reviseViaApi = (draftId, body, api = O.api) => api("POST", clientWorkingReportRevisionPath(O.organizationId, O.projectId, draftId), body);

    await test("J1 (browser): the saved assessment offers Use this assessment; Funder report is created from the persisted assessment (its saved passages reach the provider) with no reselection of findings", async () => {
      pageJ = await openPage(browser, { baseUrl, legacyUserId: O.adminUserId });
      // Desktop width for the journey (J9 also checks 390 px).
      await browser.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, pageJ.sessionId);
      assessmentBefore = await savedBlocks(assessmentId());
      approvalsBefore = await workingCounts();
      await openSaved(assessmentId(), "the saved assessment");
      // The real application page: Bootstrap 5.3.5 (its SRI hash checked by the
      // browser; rules readable only after the integrity check), the site styles and tokens.
      const styles = await styleAudit();
      assert.equal(styles.bootstrapSheet, true, `the Bootstrap stylesheet is attached ${J(styles)}`);
      assert.ok(styles.bootstrapRules > 100, `the Bootstrap stylesheet loaded ${J(styles)}`);
      assert.equal(styles.btnPrimaryBackground, "rgb(13, 110, 253)", "Bootstrap's .btn-primary applies");
      assert.deepEqual([styles.appCss, styles.tokensCss], [true, true], "the site stylesheets are attached");
      WR.styles = styles;
      assert.ok(await pageJ.visible(`[data-client-use-assessment="${assessmentId()}"]`), "Use this assessment is shown on the saved assessment");
      assert.equal(await pageJ.attrOf(`[data-client-internal-draft-detail-label]`, "data-client-internal-draft-detail-label"), "assessment");
      const detailText = await pageJ.textOf(`[data-client-internal-draft-detail="${assessmentId()}"]`);
      assert.doesNotMatch(detailText, /wait for Get Kinder|Get Kinder has not reviewed|before any funder or public use|provisional internal draft/i);
      await screenshot("use-assessment-1280", `[data-client-use-assessment="${assessmentId()}"]`);
      const calls = modelCalls.length;
      const mark = pageJ.mark();
      await pageJ.clickVisible('[data-client-adaptation-purpose="funder_report"] input', "Funder report");
      await pageJ.clickVisible("[data-client-create-adapted-report]", "Create report");
      await pageJ.waitFor(() => pageJ.requestsSince(mark).some((r) => r.method === "POST" && r.done), "the adaptation request", { timeout: 60000 });
      await pageJ.idle();
      const posted = pageJ.requestsSince(mark).find((r) => r.method === "POST");
      assert.deepEqual([new URL(posted.url).pathname, posted.status], [assessmentAdaptationPath(O.organizationId, assessmentId()), 201]);
      const sentBody = JSON.parse(posted.postData);
      assert.deepEqual(Object.keys(sentBody).sort(), ["engagement_id", "idempotency_key", "purpose"], "the browser sends no claims and no assessment content");
      assert.equal(sentBody.purpose, "funder_report");
      const funderId = (await pageJ.responseBody(posted)).data.generatedContentDraftId;
      WR.reports.funder = { draftId: funderId };
      // Exactly one provider call, carrying the persisted assessment.
      const call = modelCalls.slice(calls);
      assert.equal(call.length, 1);
      assert.equal(call[0].contentType, "evidence_summary");
      assert.equal(call[0].requestedAudience, "funder");
      assert.equal(call[0].adaptation.purpose, "funder_report");
      const sentPassages = call[0].adaptation.sourceAssessment.sections.flatMap((section) => section.blocks.map((block) => ({ section: section.key, ...block })));
      // Every passage sent is a persisted assessment block's own prose, in its section, with that block's citations.
      for (const passage of sentPassages) {
        const saved = assessmentBefore.find((block) => block.text.startsWith(`[[assessment:${passage.section}]]\n`) && WITHOUT_TAILS(bodyOf(block.text)) === passage.text);
        assert.ok(saved, `persisted passage: ${passage.text.slice(0, 80)}`);
        assert.deepEqual([...new Set(saved.citations.map((c) => c.claimId))].sort(), [...passage.claimIds].sort());
      }
      const sentText = sentPassages.map((passage) => passage.text).join("\n");
      assert.match(sentText, /Proposed change: Record, on each outcome measure that does not yet state it, whether a higher value is better/, "the saved recommendations reach the provider");
      assert.match(sentText, /What the results suggest:/, "the saved interpretation reaches the provider");
      assert.ok(sentText.includes("Exactly half of the 36 comparable participants had unchanged Community-connection confidence scores."), "the saved outcome interpretation reaches the provider");
      assert.doesNotMatch(J(call[0].adaptation), /Measurement disclosure for|Selection note:/, "server disclosures and notes are composed again, not resent");
      assert.deepEqual(call[0].claims.map((claim) => claim.claimId).sort(), [...new Set(assessmentBefore.flatMap((block) => block.citations.map((c) => c.claimId)))].sort(),
        "the claims are the assessment's own citations, read from storage");
      assert.doesNotMatch(call[0].serialized, RAW_IDENTIFIER, "no participant identifier reaches the provider");
      WR.provider = { funder: { passages_sent: sentPassages.length, sections: [...new Set(sentPassages.map((p) => p.section))], claims_sent: call[0].claims.length } };

      // The saved report opens, named by its purpose, with its source assessment.
      await pageJ.waitFor(() => pageJ.visible(`[data-client-internal-draft-detail="${funderId}"]`), "the funder report opened", { timeout: 30000 });
      assert.equal(await pageJ.attrOf("[data-client-report-lineage]", "data-client-report-purpose"), "funder_report");
      assert.equal(await pageJ.attrOf("[data-client-open-source-assessment]", "data-client-open-source-assessment"), assessmentId());
      const detail = await pageJ.textOf(`[data-client-internal-draft-detail="${funderId}"]`);
      assert.match(detail, /^Funder report/);
      assert.match(detail, /Prepared from your saved Free Impact Assessment\./);
      assert.match(detail, /Working report: KAI has not sent or released it outside your organization\./);
      assert.doesNotMatch(detail, /Get Kinder has not reviewed|wait for Get Kinder|Not approved for funder or public use/);
      assert.ok(detail.includes(ADAPTATION_OPENINGS.funder_report));
      assert.ok(detail.includes("Proposed change: Record, on each outcome measure that does not yet state it, whether a higher value is better"), "the saved recommendation is in the report");
      assert.ok(detail.includes("Exactly half of the 36 comparable participants had unchanged Community-connection confidence scores."), "the saved interpretation is in the report");
      assert.match(detail, new RegExp(`${EXPECTED.people} distinct people on the participant register`), "the calculated reach is carried with its population");
      assert.deepEqual(pageJ.exceptions, []);
    });

    await test("J2 (PostgreSQL): the funder report is its own saved draft with a durable relationship to the unchanged assessment; citations, values and limitations are preserved", async () => {
      const funderId = WR.reports.funder.draftId;
      const row = await draftRow(funderId);
      assert.deepEqual([row.content_type, row.requested_audience, row.draft_status, row.review_status, row.created_by_type, row.engagement_id],
        ["evidence_summary", "funder", "draft", "needs_gk_review", "system", O.projectId]);
      const lineage = lineageOfRow(row);
      const assessmentRow = await draftRow(assessmentId());
      assert.deepEqual({ ...lineage, source_assessment_content_sha256: undefined }, {
        relationship: "assessment_adaptation", reporting_purpose: "funder_report", version: 1,
        source_assessment_draft_id: assessmentId(), source_assessment_generation_run_id: (await query("SELECT generation_run_id::text FROM kai.generated_content_drafts WHERE generated_content_draft_id = $1::uuid", [assessmentId()]))[0].generation_run_id,
        source_assessment_content_sha256: undefined, parent_draft_id: assessmentId(), root_report_draft_id: null, engagement_id: O.projectId,
        reused_block_ordinals: lineage.reused_block_ordinals, withheld_blocks: [], selected_claim_ids: null, guidance_sha256: null,
      });
      assert.match(lineage.source_assessment_content_sha256, /^[0-9a-f]{64}$/);
      // The recorded fingerprint is the saved assessment's: recomputed here from the SQL-read blocks and citations.
      assert.equal(lineage.source_assessment_content_sha256, savedContentSha256(assessmentBefore), "the lineage fingerprints the assessment actually used");
      assert.equal(lineage.reused_block_ordinals.length, (await savedBlocks(assessmentId())).length, "every saved passage was usable and reused");
      assert.equal(assessmentRow.requested_audience, "internal");
      // The assessment itself is unchanged by being used.
      assert.equal(fingerprint(await savedBlocks(assessmentId())), fingerprint(assessmentBefore), "the saved assessment is not rewritten");
      // Citations: only the assessment's own claim/evidence pairs.
      const blocks = await savedBlocks(funderId);
      const allowed = new Set(assessmentBefore.flatMap((block) => block.citations.map((c) => `${c.claimId}:${c.evidenceItemId}`)));
      assert.ok(blocks.every((block) => block.citations.length > 0 && block.citations.every((c) => allowed.has(`${c.claimId}:${c.evidenceItemId}`))));
      // Each calculated value keeps its basis: the people count and both outcome splits, with their disclosures.
      const text = blocks.map((block) => block.text).join("\n");
      assert.ok(text.includes(`${EXPECTED.people} distinct people`));
      assert.ok(text.includes(`${EXPECTED_OUTCOMES.connection.higher} (${EXPECTED_OUTCOMES.connection.percentage}%)`));
      assert.match(text, /Measurement disclosure for the cited measurement/);
      assert.doesNotMatch(text, /\bapproved\b|\breleased\b|verified by KAI/i, "the provider's approval claims change nothing");
      const validatorKeys = row.validator_results.map((result) => [result.validator_key, result.severity]);
      for (const key of ["VAL-GEN-001", "VAL-GEN-002", "VAL-GEN-003", "VAL-GEN-004", "VAL-GEN-005", "VAL-GEN-008"]) assert.ok(validatorKeys.some(([k, sev]) => k === key && sev === "pass"), key);
      // The generation run records the browser's own idempotency key; the audit names the adaptation.
      const [audit] = await query(`SELECT metadata FROM kai.upload_lifecycle_audit WHERE organization_id = $1::uuid AND operation = 'generated_content_draft_created'
        AND metadata->>'generated_content_draft_id' = $2`, [O.organizationId, funderId]);
      assert.equal(audit.metadata.contract, "kai_assessment_adaptation_v1");
      WR.persistence.funder = { draft_id: funderId, content_type: row.content_type, audience: row.requested_audience, lineage, block_count: blocks.length,
        citations: [...new Set(blocks.flatMap((block) => block.citations.map((c) => c.claimId)))].length, content_fingerprint: fingerprint(blocks),
        assessment_fingerprint_before: fingerprint(assessmentBefore), assessment_fingerprint_after: fingerprint(await savedBlocks(assessmentId())) };
    });

    await test("J3 (browser): the funder report opens and downloads; the download is the report shown; Markdown names its purpose, source assessment and that KAI has not released it", async () => {
      const funderId = WR.reports.funder.draftId;
      await openSaved(funderId, "the funder report");
      const markdown = await openAndDownload(funderId, "funder report");
      assert.match(markdown, /^# Funder Report\n/);
      assert.ok(markdown.includes(`**Reporting purpose:** a funder report, adapted from the organization's saved Free Impact Assessment \`${assessmentId()}\``));
      assert.match(markdown, /\*\*Prepared for:\*\* a funder audience, as the organization's working report\. KAI has not sent or released it outside the organization\./);
      assert.ok(markdown.includes("Proposed change: Record, on each outcome measure that does not yet state it, whether a higher value is better"));
      assert.match(markdown, /## Source permissions and checks/);
      assert.doesNotMatch(markdown, /Authority for internal use|before any funder or public use|internal use only/i);
      WR.reports.funder.markdown_sha256 = sha256(markdown);
      if (ARTIFACTS) writeFileSync(join(ARTIFACTS, "funder-report-v1.md"), markdown);
      // The source assessment opens from the report and is the same saved content.
      await pageJ.clickVisible(`[data-client-open-source-assessment="${assessmentId()}"]`, "Open the assessment");
      await pageJ.waitFor(() => pageJ.visible(`[data-client-internal-draft-detail="${assessmentId()}"]`), "the assessment from the report", { timeout: 30000 });
      assert.ok(await pageJ.visible(`[data-client-use-assessment="${assessmentId()}"]`));
    });

    await test("J4 (browser): the administrator revises the funder report's wording and saves version 2; both versions and the assessment reopen independently; the download is version 2 as saved", async () => {
      const v1 = WR.reports.funder.draftId;
      const v1Before = await savedBlocks(v1);
      await openSaved(v1, "the funder report");
      await pageJ.clickVisible(`[data-client-revise-report="${v1}"]`, "Revise wording");
      await pageJ.waitFor(() => pageJ.visible(`[data-client-revise-editor="${v1}"]`), "the revision editor");
      await screenshot("revise-report-1280", `[data-client-revise-editor="${v1}"]`);
      const REVISED = "For a funder the organization reports to: this report sets out what the organization's saved assessment found about the people it reached and the ratings participants gave, with each figure's sources and limitations.";
      assert.ok(await setTextarea('[data-client-revise-block="1"]', REVISED), "passage 1 is editable");
      assert.ok(await pageJ.visible(`[data-client-revise-protected="2"]`), "a passage's disclosure is shown as kept by KAI, not editable");
      const mark = pageJ.mark();
      await pageJ.clickVisible("[data-client-save-revision]", "Save as version 2");
      await pageJ.waitFor(() => pageJ.requestsSince(mark).some((r) => r.method === "POST" && r.done), "the revision request", { timeout: 30000 });
      await pageJ.idle();
      const posted = pageJ.requestsSince(mark).find((r) => r.method === "POST");
      assert.deepEqual([new URL(posted.url).pathname, posted.status], [clientWorkingReportRevisionPath(O.organizationId, O.projectId, v1), 201]);
      const sent = JSON.parse(posted.postData);
      assert.deepEqual(sent.blocks, [{ ordinal: 1, text: REVISED }], "only the changed passage is sent; citations and disclosures are never sent");
      const v2 = (await pageJ.responseBody(posted)).data.generatedContentDraftId;
      WR.reports.funderV2 = { draftId: v2, idempotencyKey: sent.idempotency_key, revisedText: REVISED };
      await pageJ.waitFor(() => pageJ.visible(`[data-client-internal-draft-detail="${v2}"]`), "version 2 opened", { timeout: 30000 });
      assert.equal(await pageJ.attrOf("[data-client-report-lineage]", "data-client-report-version"), "2");
      assert.match(await pageJ.textOf(`[data-client-internal-draft-detail="${v2}"]`), /^Funder report · version 2/);
      assert.match(await pageJ.textOf("[data-client-report-revision]"), /Version 2, revised by your organization \(passage 1\)\./);
      const v2Markdown = await openAndDownload(v2, "version 2");
      assert.ok(v2Markdown.includes(REVISED));
      assert.ok(v2Markdown.includes(`**Version:** 2, revised by the organization from draft \`${v1}\``));
      if (ARTIFACTS) writeFileSync(join(ARTIFACTS, "funder-report-v2.md"), v2Markdown);
      // PostgreSQL: a new draft; only passage 1's prose differs; every citation and disclosure is the same.
      const v1After = await savedBlocks(v1);
      const v2Blocks = await savedBlocks(v2);
      assert.equal(fingerprint(v1After), fingerprint(v1Before), "version 1 is not rewritten");
      assert.equal(v2Blocks.length, v1Before.length);
      for (const [index, block] of v2Blocks.entries()) {
        assert.deepEqual(block.citations, v1Before[index].citations, `passage ${block.ordinal} keeps its citations`);
        if (block.ordinal === 1) assert.ok(block.text.startsWith(REVISED));
        else assert.equal(block.text, v1Before[index].text, `passage ${block.ordinal} unchanged`);
      }
      const v2Row = await draftRow(v2);
      const lineage = lineageOfRow(v2Row);
      assert.deepEqual([v2Row.content_type, v2Row.requested_audience, v2Row.engagement_id, lineage.relationship, lineage.version, lineage.parent_draft_id, lineage.root_report_draft_id,
        lineage.reporting_purpose, lineage.source_assessment_draft_id, lineage.revised_block_ordinals, lineage.revised_by_type],
      ["evidence_summary", "funder", O.projectId, "organization_revision", 2, v1, v1, "funder_report", assessmentId(), [1], "human"]);
      assert.equal(lineage.parent_content_sha256, savedContentSha256(v1Before), "the lineage fingerprints the version that was revised");
      assert.equal(lineage.source_assessment_content_sha256, savedContentSha256(assessmentBefore), "and still the source assessment's");
      const [audit] = await query(`SELECT metadata FROM kai.upload_lifecycle_audit WHERE organization_id = $1::uuid AND operation = 'generated_content_draft_created'
        AND metadata->>'generated_content_draft_id' = $2`, [O.organizationId, v2]);
      assert.equal(audit.metadata.contract, "kai_working_report_revision_v1");
      // The human who revised it: attributed in the metadata-only audit event
      // (kai.audit_events actor) and the lineage record; the draft row's
      // system-writer field (created_by_type, pinned by the P3-01 CHECK) is not rewritten.
      const [adminKai] = await query("SELECT user_id::text FROM kai.users WHERE legacy_public_userdata_id = $1", [O.adminUserId]);
      const actorEvents = await query(`SELECT actor_user_id::text, actor_type::text, action FROM kai.audit_events
        WHERE organization_id = $1::uuid AND metadata::text LIKE '%' || $2 || '%'`, [O.organizationId, v2]);
      assert.ok(actorEvents.some((event) => event.actor_user_id === adminKai.user_id && event.actor_type === "human"), `the audit event names the administrator: ${J(actorEvents)}`);
      assert.ok(actorEvents.every((event) => event.actor_user_id === adminKai.user_id), `no other actor is recorded for the revision: ${J(actorEvents)}`);
      assert.equal(v2Row.created_by_type, "system", "the system-writer field is unchanged");
      WR.attribution = { audit_events: actorEvents, administrator: adminKai.user_id, lineage_revised_by_type: lineage.revised_by_type, draft_created_by_type: v2Row.created_by_type };
      WR.persistence.revision = { draft_id: v2, lineage, v1_fingerprint_before: fingerprint(v1Before), v1_fingerprint_after: fingerprint(v1After), v2_fingerprint: fingerprint(v2Blocks) };
      // The previous version and the assessment reopen as saved.
      await pageJ.clickVisible(`[data-client-open-previous-version="${v1}"]`, "Open the previous version");
      await pageJ.waitFor(() => pageJ.visible(`[data-client-internal-draft-detail="${v1}"]`), "version 1 reopened", { timeout: 30000 });
      assert.ok(!(await pageJ.textOf(`[data-client-internal-draft-detail="${v1}"]`)).includes(REVISED));
      const v1Markdown = await openAndDownload(v1, "version 1 again");
      assert.equal(sha256(v1Markdown), WR.reports.funder.markdown_sha256, "version 1's report is unchanged");
      assert.deepEqual(pageJ.exceptions, []);
    });

    await test("J5 (HTTP): a revision may not change what a figure describes, add unsupported numbers, causes or quotations, or repeat nothing; replay is idempotent and a conflicting retry fails", async () => {
      const v2 = WR.reports.funderV2.draftId;
      const blocks = await savedBlocks(v2);
      const prose = (block) => block.text.replace(/\s*(?:Measurement disclosure for |Selection note: |Reuse note: )[\s\S]*$/, "").trim();
      const people = blocks.find((block) => block.text.includes(`${EXPECTED.people} distinct people`));
      assert.ok(people, "a passage states the people reached");
      const before = await counts(O.organizationId);
      const attempt = async (label, edits, key = `revise-negative-${randomUUID()}`) => {
        const response = await reviseViaApi(v2, { idempotency_key: key, blocks: edits });
        WR.negatives[label] = { status: response.status, blockers: (response.body?.blockers || []).map((b) => [b.validator_key, b.blocking_reason, b.evidence?.block_ordinals ?? null]) };
        return response;
      };
      const household = await attempt("figure_unit_changed", [{ ordinal: people.ordinal, text: prose(people).replace(`${EXPECTED.people} distinct people`, `${EXPECTED.people} households`) }]);
      assert.equal(household.status, 422, J(household.body));
      assert.ok(household.body.blockers.some((b) => b.blocking_reason === "revision_figure_context_changed" && J(b.evidence.block_ordinals) === J([people.ordinal])), J(household.body.blockers));
      const unsupported = await attempt("unsupported_number", [{ ordinal: 1, text: `${prose(blocks[0])} The programme also trained 999 volunteers.` }]);
      assert.equal(unsupported.status, 422);
      assert.ok(unsupported.body.blockers.some((b) => b.validator_key === "VAL-GEN-004" && (b.evidence.assertion_classes || []).includes("numeric_literal")), J(unsupported.body.blockers));
      const causal = await attempt("causal_claim", [{ ordinal: 1, text: `${prose(blocks[0])} Confidence rose because of the programme.` }]);
      assert.equal(causal.status, 422);
      assert.ok(causal.body.blockers.some((b) => b.validator_key === "VAL-GEN-004"), J(causal.body.blockers));
      const quotation = await attempt("invented_quotation", [{ ordinal: 1, text: `${prose(blocks[0])} One participant said "this changed my whole life".` }]);
      assert.equal(quotation.status, 422);
      assert.ok(quotation.body.blockers.some((b) => b.validator_key === "VAL-GEN-010"), J(quotation.body.blockers));
      const unchanged = await attempt("unchanged", [{ ordinal: 1, text: prose(blocks[0]) }]);
      assert.deepEqual([unchanged.status, unchanged.body.blockers[0].blocking_reason], [422, "revision_unchanged"]);
      assert.deepEqual(await counts(O.organizationId), before, "no refused revision wrote anything");
      // Idempotent replay of the browser's own request; a different text under the same key is refused.
      const replay = await reviseViaApi(WR.reports.funder.draftId, { idempotency_key: WR.reports.funderV2.idempotencyKey,
        blocks: [{ ordinal: 1, text: prose(blocks[0]) }] });
      assert.deepEqual([replay.status, replay.body.data?.generatedContentDraftId, replay.body.data?.replayed], [201, v2, true], J(replay.body));
      const conflict = await reviseViaApi(WR.reports.funder.draftId, { idempotency_key: WR.reports.funderV2.idempotencyKey, blocks: [{ ordinal: 1, text: "A different wording." }] });
      assert.deepEqual([conflict.status, conflict.body.error?.code], [409, "duplicate_conflict"]);
      assert.deepEqual(await counts(O.organizationId), before, "replay and conflict wrote nothing");
      WR.negatives.replay = { status: replay.status, same_draft: replay.body.data.generatedContentDraftId === v2 };
      WR.negatives.conflicting_retry = { status: conflict.status, code: conflict.body.error.code };
    });

    await test("J6 (browser + HTTP): the same assessment adapts into a board report (browser, with guidance) and annual-report content (selected findings); each is its own saved report with its purpose, generator and audience", async () => {
      const calls = modelCalls.length;
      await openSaved(assessmentId(), "the saved assessment");
      await pageJ.clickVisible('[data-client-adaptation-purpose="board_update"] input', "Board report");
      await pageJ.clickVisible("[data-client-adaptation-guidance-toggle]", "Add guidance");
      assert.ok(await setTextarea("[data-client-adaptation-guidance]", "Lead with the follow-up ratings for the board's programme committee."));
      const mark = pageJ.mark();
      await pageJ.clickVisible("[data-client-create-adapted-report]", "Create report");
      await pageJ.waitFor(() => pageJ.requestsSince(mark).some((r) => r.method === "POST" && r.done), "the board adaptation", { timeout: 60000 });
      await pageJ.idle();
      const posted = pageJ.requestsSince(mark).find((r) => r.method === "POST");
      assert.equal(posted.status, 201, J(await pageJ.responseBody(posted)));
      const boardId = (await pageJ.responseBody(posted)).data.generatedContentDraftId;
      await pageJ.waitFor(() => pageJ.visible(`[data-client-internal-draft-detail="${boardId}"]`), "the board report opened", { timeout: 30000 });
      assert.match(await pageJ.textOf(`[data-client-internal-draft-detail="${boardId}"]`), /^Board report/);
      const boardMarkdown = await openAndDownload(boardId, "board report");
      assert.match(boardMarkdown, /^# Board Update\n/);
      if (ARTIFACTS) writeFileSync(join(ARTIFACTS, "board-report.md"), boardMarkdown);
      const boardCall = modelCalls.slice(calls)[0];
      assert.deepEqual([boardCall.contentType, boardCall.requestedAudience, boardCall.adaptation.purpose, boardCall.adaptation.guidance],
        ["board_update", "internal", "board_update", "Lead with the follow-up ratings for the board's programme committee."]);
      // Annual-report content from two selected findings (API, the same route the browser uses).
      const selected = [O.outcomes.connection.claimId, O.docs.C.claimId].sort();
      const annual = await adaptViaApi({ engagement_id: O.projectId, purpose: "annual_report", idempotency_key: `annual-${randomUUID()}`, claim_ids: selected });
      assert.equal(annual.status, 201, J({ body: annual.body, provider: modelCalls.at(-1)?.responseBlocks?.map((b, i) => `${i + 1}: ${b.text.slice(0, 400)}`) }));
      const annualId = annual.body.data.generatedContentDraftId;
      const annualCall = modelCalls.at(-1);
      assert.deepEqual([annualCall.contentType, annualCall.requestedAudience], ["annual_report_section", "public"]);
      assert.deepEqual(annualCall.claims.map((claim) => claim.claimId).sort(), selected, "only the selected findings reach the provider");
      const annualReads = await clientReads(O, annualId);
      assert.deepEqual([annualReads.listed, annualReads.detail, annualReads.markdown], [true, 200, 200]);
      assert.match(annualReads.markdownText, /^# Annual Report Section\n/);
      if (ARTIFACTS) writeFileSync(join(ARTIFACTS, "annual-report-content.md"), annualReads.markdownText);
      for (const [label, draftId, contentType, audience, purpose] of [["board", boardId, "board_update", "internal", "board_update"], ["annual", annualId, "annual_report_section", "public", "annual_report"]]) {
        const row = await draftRow(draftId);
        const lineage = lineageOfRow(row);
        assert.deepEqual([row.content_type, row.requested_audience, lineage.relationship, lineage.reporting_purpose, lineage.source_assessment_draft_id, lineage.version],
          [contentType, audience, "assessment_adaptation", purpose, assessmentId(), 1], label);
        WR.persistence[label] = { draft_id: draftId, content_type: row.content_type, audience: row.requested_audience, lineage };
      }
      const annualLineage = lineageOfRow(await draftRow(annualId));
      assert.deepEqual(annualLineage.selected_claim_ids, selected);
      assert.ok(annualLineage.withheld_blocks.length > 0 && annualLineage.withheld_blocks.every((block) => block.reason === "cites_finding_not_selected"));
      assert.match(lineageOfRow(await draftRow(boardId)).guidance_sha256, /^[0-9a-f]{64}$/);
      assert.match((await savedBlocks(annualId)).map((block) => block.text).join("\n"), /Reuse note: some content of the source assessment was not reused/);
      assert.equal(fingerprint(await savedBlocks(assessmentId())), fingerprint(assessmentBefore), "still the same saved assessment");
      WR.reports.board = { draftId: boardId };
      WR.reports.annual = { draftId: annualId };
    });

    await test("J7 (HTTP): adaptation is idempotent, refuses conflicting retries, other organizations, Projects, roles and non-assessments, and never sends a prohibited source's content", async () => {
      const key = `adapt-replay-${randomUUID()}`;
      const first = await adaptViaApi({ engagement_id: O.projectId, purpose: "internal_planning", idempotency_key: key });
      assert.equal(first.status, 201, J({ body: first.body, provider: modelCalls.at(-1)?.responseBlocks?.map((b, i) => `${i + 1}: ${b.text.slice(0, 400)}`) }));
      const calls = modelCalls.length;
      const drafts = (await counts(O.organizationId)).drafts;
      const replay = await adaptViaApi({ engagement_id: O.projectId, purpose: "internal_planning", idempotency_key: key });
      assert.deepEqual([replay.status, replay.body.data.generatedContentDraftId, replay.body.data.replayed], [201, first.body.data.generatedContentDraftId, true]);
      assert.equal(modelCalls.length, calls, "a replay never calls the provider");
      const conflict = await adaptViaApi({ engagement_id: O.projectId, purpose: "funder_report", idempotency_key: key });
      assert.deepEqual([conflict.status, conflict.body.error?.code], [409, "duplicate_conflict"]);
      // Another organization's administrator, another Project, a contributor, a non-assessment.
      const otherOrg = await adaptViaApi({ engagement_id: O.projectId, purpose: "funder_report", idempotency_key: `adapt-other-${randomUUID()}` }, assessmentId(), ORGS.D.api);
      assert.equal(otherOrg.status, 403, J(otherOrg.body));
      const otherProject = await adaptViaApi({ engagement_id: ORGS.P.projectId, purpose: "funder_report", idempotency_key: `adapt-project-${randomUUID()}` });
      assert.ok([403, 404].includes(otherProject.status), J(otherProject.body));
      const contributorLegacy = 2999;
      await query("INSERT INTO public.userdata (id) VALUES ($1) ON CONFLICT DO NOTHING", [contributorLegacy]);
      const contributor = await findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: contributorLegacy, email: `user${contributorLegacy}@package4.test` });
      await query("INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status) VALUES ($1::uuid, $2::uuid, 'client_contributor', 'active') ON CONFLICT DO NOTHING", [O.organizationId, contributor.user_id]);
      const contributorApi = client(baseUrl, contributorLegacy);
      const byContributor = await adaptViaApi({ engagement_id: O.projectId, purpose: "funder_report", idempotency_key: `adapt-contributor-${randomUUID()}` }, assessmentId(), contributorApi);
      assert.equal(byContributor.status, 403, J(byContributor.body));
      const contributorRevision = await reviseViaApi(WR.reports.funder.draftId, { idempotency_key: `revise-contributor-${randomUUID()}`, blocks: [{ ordinal: 1, text: "A contributor's wording." }] }, contributorApi);
      assert.equal(contributorRevision.status, 403, J(contributorRevision.body));
      const otherOrgRevision = await reviseViaApi(WR.reports.funder.draftId, { idempotency_key: `revise-other-${randomUUID()}`, blocks: [{ ordinal: 1, text: "Another organization's wording." }] }, ORGS.D.api);
      assert.equal(otherOrgRevision.status, 403, J(otherOrgRevision.body));
      const notAssessment = await adaptViaApi({ engagement_id: O.projectId, purpose: "board_update", idempotency_key: `adapt-not-assessment-${randomUUID()}` }, WR.reports.funder.draftId);
      assert.deepEqual([notAssessment.status, notAssessment.body.blockers?.[0]?.blocking_reason], [422, "source_is_not_a_free_impact_assessment"]);
      // No session at all: both new routes refuse before any service runs.
      const anonymous = async (path, body) => {
        const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: J(body) });
        return response.status;
      };
      const anonymousAdapt = await anonymous(assessmentAdaptationPath(O.organizationId, assessmentId()), { engagement_id: O.projectId, purpose: "funder_report", idempotency_key: `adapt-anon-${randomUUID()}` });
      const anonymousRevise = await anonymous(clientWorkingReportRevisionPath(O.organizationId, O.projectId, WR.reports.funder.draftId), { idempotency_key: `revise-anon-${randomUUID()}`, blocks: [{ ordinal: 1, text: "Anonymous wording." }] });
      assert.deepEqual([anonymousAdapt, anonymousRevise], [401, 401]);
      assert.equal((await counts(O.organizationId)).drafts, drafts, "no refused request wrote a draft");
      WR.negatives.unauthenticated = { adapt: anonymousAdapt, revise: anonymousRevise };
      WR.negatives.adaptation = { replay: replay.status, conflict: conflict.status, other_organization: otherOrg.status, other_project: otherProject.status,
        contributor: byContributor.status, contributor_revision: contributorRevision.status, other_organization_revision: otherOrgRevision.status, not_assessment: notAssessment.status };

      // The review PDF's AI processing is withdrawn: its finding never reaches the provider; the rest of the assessment is reused and the omission is recorded.
      await reviewPermissionsAgain(O, O.review, { reviewed_llm_processing_allowed: false });
      try {
        const callsBefore = modelCalls.length;
        const withdrawn = await adaptViaApi({ engagement_id: O.projectId, purpose: "funder_report", idempotency_key: `adapt-withdrawn-${randomUUID()}` });
        assert.equal(withdrawn.status, 201, J(withdrawn.body));
        const sent = modelCalls.slice(callsBefore);
        assert.equal(sent.length, 1);
        assert.ok(!sent[0].claims.some((claim) => claim.claimId === O.docs.C.claimId), "the prohibited finding never reaches the provider");
        assert.doesNotMatch(sent[0].serialized, /at least 90|rough tally|management review/i, "no PDF content reaches the provider");
        const lineage = lineageOfRow(await draftRow(withdrawn.body.data.generatedContentDraftId));
        assert.ok(lineage.withheld_blocks.some((block) => block.section_key === "impact_stories" && block.reason === "cites_finding_not_currently_usable"), J(lineage.withheld_blocks));
        assert.deepEqual(withdrawn.body.data.permissionExcludedClaims.map((item) => item.claimId), [O.docs.C.claimId]);
        const savedText = (await savedBlocks(withdrawn.body.data.generatedContentDraftId)).map((block) => block.text).join("\n");
        assert.match(savedText, /Selection note: one selected finding was not sent to the AI model/);
        assert.match(savedText, /Reuse note:/);
        assert.doesNotMatch(savedText, /at least 90/);
        WR.negatives.ai_withdrawn = { status: withdrawn.status, withheld_blocks: lineage.withheld_blocks, permission_excluded: withdrawn.body.data.permissionExcludedClaims };
      } finally {
        await reviewPermissionsAgain(O, O.review, { reviewed_llm_processing_allowed: true });
      }
    });

    await test("J8 (browser + PostgreSQL): when a cited source is replaced, the saved report stays readable as saved (with its context) and downloads as saved; it cannot be revised as current; restoring the source restores current use", async () => {
      const v1 = WR.reports.funder.draftId;
      const savedBefore = await savedBlocks(v1);
      await query("UPDATE kai.source_versions SET is_current = false WHERE organization_id = $1::uuid AND source_version_id = $2::uuid", [O.organizationId, O.review.sourceVersionId]);
      try {
        await openSaved(v1, "the funder report after its source changed");
        assert.equal(await pageJ.attrOf("[data-client-report-historical]", "data-client-report-historical"), "source_changed_since_saved");
        assert.ok(!(await pageJ.visible(`[data-client-revise-report="${v1}"]`)), "a changed-source report is not offered for revision");
        const href = await pageJ.attrOf(`[data-client-download-saved-version="${v1}"]`, "href");
        const downloaded = await pageJ.evaluate(`(async () => { const r = await fetch(${J(href)}, { credentials: "same-origin" }); return { status: r.status, body: await r.text() }; })()`);
        assert.equal(downloaded.status, 200);
        assert.match(downloaded.body, /^# Funder Report \(saved version\)\n/);
        for (const block of savedBefore) assert.ok(downloaded.body.includes(block.text.trim().slice(0, 120)), `saved passage ${block.ordinal} as saved`);
        const revise = await reviseViaApi(v1, { idempotency_key: `revise-stale-${randomUUID()}`, blocks: [{ ordinal: 1, text: "New wording while a source changed." }] });
        assert.ok([409, 422].includes(revise.status), J(revise.body));
        if (ARTIFACTS) writeFileSync(join(ARTIFACTS, "funder-report-saved-version.md"), downloaded.body);
        WR.negatives.changed_source = { detail_historical: true, download: downloaded.status, revise: revise.status };
      } finally {
        await query("UPDATE kai.source_versions SET is_current = true WHERE organization_id = $1::uuid AND source_version_id = $2::uuid", [O.organizationId, O.review.sourceVersionId]);
      }
      assert.equal(fingerprint(await savedBlocks(v1)), fingerprint(savedBefore), "the saved report was never rewritten");
      const restored = await clientReads(O, v1);
      assert.deepEqual([restored.detail, restored.markdown], [200, 200]);
    });

    await test("J9 (390 px): Use this assessment and the revision editor fit a phone-width screen; every control is reachable", async () => {
      // Opened at desktop width, then shown at 390 px (the reader re-lays out in place).
      const phone = () => browser.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false }, pageJ.sessionId);
      const desktop = () => browser.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, pageJ.sessionId);
      WR.layout = {};
      await openSaved(assessmentId(), "the assessment");
      WR.layout.use_assessment_1280 = await fits(`[data-client-use-assessment="${assessmentId()}"]`);
      await phone();
      try {
        await new Promise((resolve) => setTimeout(resolve, 300));
        const panel = await fits(`[data-client-use-assessment="${assessmentId()}"]`);
        assert.ok(panel.found && panel.innerWidth <= 400 && panel.panelScroll <= panel.panelClient + 1 && panel.outside === 0, J(panel));
        await screenshot("use-assessment-390", `[data-client-use-assessment="${assessmentId()}"]`);
        WR.layout.use_assessment_390 = panel;
      } finally {
        await desktop();
      }
      await openSaved(WR.reports.funderV2.draftId, "version 2");
      await pageJ.clickVisible(`[data-client-revise-report="${WR.reports.funderV2.draftId}"]`, "Revise wording");
      await pageJ.waitFor(() => pageJ.visible(`[data-client-revise-editor="${WR.reports.funderV2.draftId}"]`), "the editor");
      WR.layout.revise_editor_1280 = await fits(`[data-client-revise-editor="${WR.reports.funderV2.draftId}"]`);
      await phone();
      try {
        await new Promise((resolve) => setTimeout(resolve, 300));
        const editor = await fits(`[data-client-revise-editor="${WR.reports.funderV2.draftId}"]`);
        assert.ok(editor.found && editor.innerWidth <= 400 && editor.panelScroll <= editor.panelClient + 1 && editor.outside === 0, J(editor));
        await screenshot("revise-report-390", `[data-client-revise-editor="${WR.reports.funderV2.draftId}"]`);
        WR.layout.revise_editor_390 = editor;
      } finally {
        await desktop();
      }
      for (const [label, value] of Object.entries(WR.layout)) {
        assert.ok(value.found && value.outside === 0 && value.panelScroll <= value.panelClient + 1, `${label}: ${J(value)}`);
        assert.equal(value.innerWidth, label.endsWith("_390") ? 390 : 1280, label);
      }
    });

    // ---- J11-J13 (owner task 2026-11-21): the real application page at 1280 and
    // 390 px, exact downloads, and late responses after a Project switch ----
    WR.added = [];
    // Unescape the serializer's Markdown escapes so saved prose can be found as text.
    const plainMarkdown = (markdown) => markdown.replace(/\\([\\`*_{}\[\]()#+\-.!|>])/g, "$1");

    await test("J11 (browser, real application page with Bootstrap 5.3.5 and the site styles, 1280 and 390 px): the saved assessment, Use this assessment with all four purposes, report creation, source-assessment and previous-version navigation, revision fields with save, cancel, loading and messages, and open/download are visible, usable and inside the screen", async () => {
      WR.styled = { layout: {}, screenshots: [], created: {} };
      // The ordinary nonprofit administrator's projected capabilities (the same
      // read the interface uses): working reports, adaptation and revision yes;
      // the readiness assessment / data-gap memo, GK review and release no.
      const capabilities = await O.api("GET", organizationAccessCapabilitiesPath(O.organizationId));
      assert.equal(capabilities.status, 200, J(capabilities.body));
      const ops = capabilities.body.data.workflowOperations;
      WR.capabilities = Object.fromEntries(["generateDrafts", "adaptAssessments", "reviseWorkingReports", "readInternalDrafts", "generateAllDraftTypes",
        "reviewGeneratedDrafts", "releaseInternalReports", "recordEvidenceReview", "recordClaimReview"].map((key) => [key, ops[key]]));
      assert.deepEqual([ops.generateDrafts, ops.adaptAssessments, ops.reviseWorkingReports, ops.readInternalDrafts], [true, true, true, true], J(WR.capabilities));
      assert.deepEqual([ops.generateAllDraftTypes, ops.reviewGeneratedDrafts], [false, false], J(WR.capabilities));
      assert.equal(capabilities.body.data.internalKnowledgeWorkspace === true, false, "the client Knowledge Studio, not Get Kinder's workspace");
      const shot = async (name, selector, align = "top") => { await screenshot(name, selector, align); WR.styled.screenshots.push(`${name}.png`); };
      const audit = async (label, selector, width) => {
        const layout = await layoutAudit(selector);
        WR.styled.layout[label] = layout;
        assertLayout(label, layout, width);
      };
      const metricsOf = (width) => (width === 1280 ? DESKTOP_J : PHONE_J);
      const openAt = async (draftId, label, width) => {
        // Navigate at desktop width (the shell's navigation), then show the opened report at the width under test.
        await viewportJ(DESKTOP_J);
        await openSaved(draftId, label);
        await viewportJ(metricsOf(width));
        await pageJ.waitFor(() => pageJ.visible(`[data-client-internal-draft-detail="${draftId}"]`), `${label} at ${width}`);
      };
      const createFromAssessment = async (purpose, width) => {
        await openAt(assessmentId(), "the saved assessment", width);
        await realClick(`[data-client-adaptation-purpose="${purpose}"] input`, `purpose ${purpose}`);
        assert.equal(await checked(`[data-client-adaptation-purpose="${purpose}"] input`), true, purpose);
        const mark = pageJ.mark();
        await holdResponses(`*/generated-content-drafts/${assessmentId()}/assessment-adaptations`);
        try {
          await realClick("[data-client-create-adapted-report]", "Create report");
          await pageJ.waitFor(async () => held.length === 1, `${purpose}: the adaptation response`, { timeout: 60000 });
          // The loading state is shown and readable while the server works.
          assert.equal(await pageJ.evaluate(`document.querySelector("[data-client-create-adapted-report]").innerText.trim()`), "Creating report...");
          assert.equal(await pageJ.evaluate(`document.querySelector("[data-client-create-adapted-report]").disabled`), true);
          await shot(`styled-creating-${purpose}-${width}`, "[data-client-create-adapted-report]", "center");
        } finally {
          await releaseHeld();
        }
        await pageJ.waitFor(() => pageJ.requestsSince(mark).some((r) => r.method === "POST" && r.done), `${purpose}: the adaptation request`, { timeout: 60000 });
        await pageJ.idle();
        const posted = pageJ.requestsSince(mark).find((r) => r.method === "POST");
        assert.deepEqual([new URL(posted.url).pathname, posted.status], [assessmentAdaptationPath(O.organizationId, assessmentId()), 201], J(await pageJ.responseBody(posted)));
        const sentBody = JSON.parse(posted.postData);
        assert.deepEqual([Object.keys(sentBody).sort(), sentBody.purpose, sentBody.engagement_id], [["engagement_id", "idempotency_key", "purpose"], purpose, O.projectId]);
        const draftId = (await pageJ.responseBody(posted)).data.generatedContentDraftId;
        WR.added.push(draftId);
        await pageJ.waitFor(() => pageJ.visible(`[data-client-internal-draft-detail="${draftId}"]`), `the ${purpose} report opened`, { timeout: 30000 });
        assert.equal(await pageJ.attrOf("[data-client-report-lineage]", "data-client-report-purpose"), purpose);
        const row = await draftRow(draftId);
        const lineage = lineageOfRow(row);
        assert.deepEqual([row.engagement_id, lineage.relationship, lineage.reporting_purpose, lineage.source_assessment_draft_id, lineage.source_assessment_content_sha256],
          [O.projectId, "assessment_adaptation", purpose, assessmentId(), savedContentSha256(assessmentBefore)], purpose);
        WR.styled.created[purpose] = { draft_id: draftId, width, content_type: row.content_type, audience: row.requested_audience };
        return draftId;
      };
      const reviseNegatives = async (draftId, width) => {
        const editor = `[data-client-revise-editor="${draftId}"]`;
        await realClick(`[data-client-revise-report="${draftId}"]`, "Revise wording");
        await pageJ.waitFor(() => pageJ.visible(editor), "the revision editor");
        await audit(`revise_editor_${width}`, editor, width);
        await shot(`styled-revise-editor-${width}`, editor);
        const before = await savedBlocks(draftId);
        // Save with nothing changed: the message says so; nothing is sent.
        let mark = pageJ.mark();
        await realClick("[data-client-save-revision]", "Save (unchanged)");
        await pageJ.waitFor(() => pageJ.visible("[data-client-revision-error]"), "the unchanged message");
        assert.equal(await pageJ.textOf("[data-client-revision-error]"), "Nothing was changed, so no new version was saved.");
        assert.deepEqual(pageJ.requestsSince(mark).filter((r) => r.method === "POST"), [], "nothing is sent");
        await shot(`styled-revise-unchanged-${width}`, "[data-client-revision-error]", "center");
        // A figure whose describing words change: the server refuses it and the message names the passage.
        const people = before.find((block) => block.text.includes(`${EXPECTED.people} distinct people`));
        assert.ok(people, "a passage states the people reached");
        const current = await pageJ.evaluate(`document.querySelector('[data-client-revise-block="${people.ordinal}"]').value`);
        assert.ok(current.includes(`${EXPECTED.people} distinct people`), "the editable prose carries the figure");
        assert.ok(await setTextarea(`[data-client-revise-block="${people.ordinal}"]`, current.replace(`${EXPECTED.people} distinct people`, `${EXPECTED.people} households`)));
        mark = pageJ.mark();
        await realClick("[data-client-save-revision]", "Save (figure changed)");
        await pageJ.waitFor(() => pageJ.requestsSince(mark).some((r) => r.method === "POST" && r.done), "the refused revision", { timeout: 30000 });
        await pageJ.waitFor(async () => /A figure no longer keeps the words that describe it/.test((await pageJ.textOf("[data-client-revision-error]")) || ""), "the figure message");
        assert.equal(pageJ.requestsSince(mark).find((r) => r.method === "POST").status, 422);
        assert.match(await pageJ.textOf("[data-client-revision-error]"), new RegExp(`^Not saved\\. .*\\(passage ${people.ordinal}\\)`));
        await audit(`revise_error_${width}`, editor, width);
        await shot(`styled-revise-error-${width}`, "[data-client-revision-error]", "center");
        // Cancel closes the editor and saves nothing.
        await realClick("[data-client-cancel-revision]", "Cancel");
        await pageJ.waitFor(async () => !(await pageJ.visible(editor)), "the editor closed");
        assert.ok(await pageJ.visible(`[data-client-revise-report="${draftId}"]`), "Revise wording is offered again");
        assert.equal(fingerprint(await savedBlocks(draftId)), fingerprint(before), "nothing was saved");
      };
      const openAndDownloadAt = async (draftId, label, width) => {
        const download = await exactDownload(draftId, `${label} at ${width}`);
        await audit(`${label}_${width}`, `[data-client-internal-draft-detail="${draftId}"]`, width);
        await shot(`styled-${label}-actions-${width}`, `[data-client-download-internal-report="${draftId}"]`, "center");
        await shot(`styled-${label}-open-${width}`, "[data-client-internal-report-markdown]");
        await shot(`styled-${label}-${width}`, `[data-client-internal-draft-detail="${draftId}"]`);
        WR.styled[`${label}_${width}_download`] = { bytes: download.bytes, sha256: download.sha256, content_type: download.content_type, download_name: download.download_name };
      };

      for (const width of [1280, 390]) {
        // The saved assessment opens - navigated entirely at this width (shell
        // navigation, Project selector, Drafts, Open assessment); Use this
        // assessment offers every purpose, each selectable.
        await viewportJ(metricsOf(width));
        await openSaved(assessmentId(), `the saved assessment (navigated at ${width})`);
        assert.equal(await pageJ.evaluate("window.innerWidth"), width);
        const panel = `[data-client-use-assessment="${assessmentId()}"]`;
        for (const option of ["internal_planning", "board_update", "funder_report", "annual_report"]) {
          await realClick(`[data-client-adaptation-purpose="${option}"] input`, `purpose ${option} at ${width}`);
          assert.equal(await checked(`[data-client-adaptation-purpose="${option}"] input`), true, `${option} selectable at ${width}`);
        }
        await realClick("[data-client-adaptation-guidance-toggle]", "Add guidance (optional)");
        await pageJ.waitFor(() => pageJ.visible("[data-client-adaptation-guidance]"), "the guidance field");
        await audit(`use_assessment_${width}`, panel, width);
        await shot(`styled-use-assessment-${width}`, panel);
        await realClick("[data-client-adaptation-guidance-toggle]", "Hide guidance");
        await audit(`assessment_${width}`, `[data-client-internal-draft-detail="${assessmentId()}"]`, width);
        await shot(`styled-assessment-${width}`, `[data-client-internal-draft-detail="${assessmentId()}"]`);
        await openAndDownloadAt(assessmentId(), "assessment", width);
      }

      // 1280: internal planning from the assessment; its source assessment opens from it.
      const planning = await createFromAssessment("internal_planning", 1280);
      await audit("internal_planning_report_1280", `[data-client-internal-draft-detail="${planning}"]`, 1280);
      await openAndDownloadAt(planning, "internal-planning", 1280);
      await realClick(`[data-client-open-source-assessment="${assessmentId()}"]`, "Open the assessment");
      await pageJ.waitFor(() => pageJ.visible(`[data-client-internal-draft-detail="${assessmentId()}"]`), "the assessment from the planning report", { timeout: 30000 });
      // 390: a funder report and annual-report content from the assessment.
      const funder390 = await createFromAssessment("funder_report", 390);
      await audit("funder_report_390", `[data-client-internal-draft-detail="${funder390}"]`, 390);
      await openAndDownloadAt(funder390, "funder-report", 390);
      await realClick(`[data-client-open-source-assessment="${assessmentId()}"]`, "Open the assessment (390)");
      await pageJ.waitFor(() => pageJ.visible(`[data-client-internal-draft-detail="${assessmentId()}"]`), "the assessment from the funder report", { timeout: 30000 });
      const annual390 = await createFromAssessment("annual_report", 390);
      await openAndDownloadAt(annual390, "annual-report", 390);

      // Revision at each width on version 2: unchanged and figure messages, cancel; then previous-version and source navigation.
      const v1 = WR.reports.funder.draftId;
      const v2 = WR.reports.funderV2.draftId;
      for (const width of [1280, 390]) {
        await openAt(v2, "version 2", width);
        await reviseNegatives(v2, width);
        await realClick(`[data-client-open-previous-version="${v1}"]`, `Open the previous version (${width})`);
        await pageJ.waitFor(() => pageJ.visible(`[data-client-internal-draft-detail="${v1}"]`), `version 1 from version 2 at ${width}`, { timeout: 30000 });
        await shot(`styled-previous-version-${width}`, `[data-client-internal-draft-detail="${v1}"]`);
        await realClick(`[data-client-open-source-assessment="${assessmentId()}"]`, `Open the assessment from version 1 (${width})`);
        await pageJ.waitFor(() => pageJ.visible(`[data-client-internal-draft-detail="${assessmentId()}"]`), `the assessment from version 1 at ${width}`, { timeout: 30000 });
      }
      // 390: a valid revision is saved as version 3 (the Saving... state shown while the server works).
      await openAt(v2, "version 2", 390);
      await realClick(`[data-client-revise-report="${v2}"]`, "Revise wording (390)");
      await pageJ.waitFor(() => pageJ.visible(`[data-client-revise-editor="${v2}"]`), "the editor (390)");
      const REVISED_390 = "For a funder the organization reports to: this version summarises what the saved assessment found about the people the organization reached and the ratings participants gave, with each figure's sources and limitations.";
      assert.ok(await setTextarea('[data-client-revise-block="1"]', REVISED_390));
      const mark = pageJ.mark();
      await holdResponses(`*/client-internal-drafts/${v2}/revisions`);
      try {
        await realClick("[data-client-save-revision]", "Save as version 3");
        await pageJ.waitFor(async () => held.length === 1, "the revision response", { timeout: 60000 });
        assert.equal(await pageJ.evaluate(`document.querySelector("[data-client-save-revision]").innerText.trim()`), "Saving...");
        assert.deepEqual(await pageJ.evaluate(`[document.querySelector("[data-client-save-revision]").disabled, document.querySelector("[data-client-cancel-revision]").disabled]`), [true, true]);
        await shot("styled-revise-saving-390", "[data-client-save-revision]", "center");
      } finally {
        await releaseHeld();
      }
      await pageJ.waitFor(() => pageJ.requestsSince(mark).some((r) => r.method === "POST" && r.done), "the revision request", { timeout: 60000 });
      await pageJ.idle();
      const posted = pageJ.requestsSince(mark).find((r) => r.method === "POST");
      assert.equal(posted.status, 201, J(await pageJ.responseBody(posted)));
      assert.deepEqual(JSON.parse(posted.postData).blocks, [{ ordinal: 1, text: REVISED_390 }]);
      const v3 = (await pageJ.responseBody(posted)).data.generatedContentDraftId;
      WR.added.push(v3);
      WR.reports.funderV3 = { draftId: v3, revisedText: REVISED_390 };
      await pageJ.waitFor(() => pageJ.visible(`[data-client-internal-draft-detail="${v3}"]`), "version 3 opened", { timeout: 30000 });
      assert.equal(await pageJ.attrOf("[data-client-report-lineage]", "data-client-report-version"), "3");
      const v3Lineage = lineageOfRow(await draftRow(v3));
      assert.deepEqual([v3Lineage.relationship, v3Lineage.version, v3Lineage.parent_draft_id, v3Lineage.root_report_draft_id, v3Lineage.revised_by_type],
        ["organization_revision", 3, v2, v1, "human"]);
      await audit("version_3_390", `[data-client-internal-draft-detail="${v3}"]`, 390);
      await shot("styled-version-3-390", `[data-client-internal-draft-detail="${v3}"]`);
      await realClick(`[data-client-open-previous-version="${v2}"]`, "Open the previous version (version 2, 390)");
      await pageJ.waitFor(() => pageJ.visible(`[data-client-internal-draft-detail="${v2}"]`), "version 2 from version 3", { timeout: 30000 });
      assert.deepEqual(pageJ.exceptions, [], "no page error on the real page");
      await viewportJ(DESKTOP_J);
    });

    await test("J12 (browser + PostgreSQL): funder report versions 1, 2 and 3 download byte-for-byte as their server-persisted Markdown and as shown, with their own version, purpose, citations and disclosures, and again after a reload", async () => {
      const v1 = WR.reports.funder.draftId;
      const v2 = WR.reports.funderV2.draftId;
      const v3 = WR.reports.funderV3.draftId;
      WR.downloads = {};
      for (const pass of ["first", "after_reload"]) {
        for (const [label, draftId, version] of [["v1", v1, 1], ["v2", v2, 2], ["v3", v3, 3]]) {
          // openSaved navigates to the page again: every pass is a fresh page load.
          await openSaved(draftId, `${label} (${pass})`);
          await viewportJ(DESKTOP_J);
          const shownVersion = await pageJ.attrOf("[data-client-report-lineage]", "data-client-report-version");
          const shownLabel = await pageJ.textOf("[data-client-internal-draft-detail-label]");
          const result = await exactDownload(draftId, `${label} ${pass}`);
          const markdown = result.markdown;
          const plain = plainMarkdown(markdown);
          assert.equal(shownVersion, String(version), `${label}: the version shown`);
          assert.equal(shownLabel, version === 1 ? "Funder report" : `Funder report · version ${version}`);
          assert.match(markdown, /^# Funder Report\n/);
          assert.ok(markdown.includes(`draft \`${draftId}\``), `${label}: the Markdown is this saved draft`);
          assert.ok(markdown.includes(`**Version:** ${version}${version > 1 ? `, revised by the organization from draft \`${version === 2 ? v1 : v2}\`` : ""}`), `${label}: its version line`);
          assert.ok(markdown.includes(`**Reporting purpose:** a funder report, adapted from the organization's saved Free Impact Assessment \`${assessmentId()}\``), `${label}: purpose and source`);
          assert.match(markdown, /KAI has not sent or released it outside the organization\./);
          const blocks = await savedBlocks(draftId);
          for (const claimId of new Set(blocks.flatMap((block) => block.citations.map((citation) => citation.claimId)))) {
            assert.ok(markdown.includes(`\`${claimId}\``), `${label}: cites ${claimId}`);
          }
          for (const block of blocks) {
            const [prose, ...tails] = block.text.split(/\s(?=Measurement disclosure for |Selection note: |Reuse note: )/);
            assert.ok(plain.includes(prose.trim().slice(0, 160)), `${label}: passage ${block.ordinal} as saved`);
            for (const tail of tails) assert.ok(plain.includes(tail.trim().slice(0, 120)), `${label}: passage ${block.ordinal} disclosure as saved`);
          }
          if (version === 2) assert.ok(plain.includes(WR.reports.funderV2.revisedText));
          if (version === 3) assert.ok(plain.includes(WR.reports.funderV3.revisedText));
          if (version === 1) assert.ok(!plain.includes(WR.reports.funderV2.revisedText) && !plain.includes(WR.reports.funderV3.revisedText), "version 1 carries no later wording");
          WR.downloads[`${label}_${pass}`] = { draft_id: draftId, version, bytes: result.bytes, sha256: result.sha256, content_type: result.content_type,
            disposition: result.disposition, download_name: result.download_name };
          if (ARTIFACTS && pass === "after_reload") writeFileSync(join(ARTIFACTS, `funder-report-v${version}.md`), markdown);
        }
      }
      for (const label of ["v1", "v2", "v3"]) assert.equal(WR.downloads[`${label}_after_reload`].sha256, WR.downloads[`${label}_first`].sha256, `${label}: identical after a reload`);
      assert.equal(WR.downloads.v1_first.sha256, WR.reports.funder.markdown_sha256, "version 1 downloads exactly as when it was first saved (J3), after versions 2 and 3");
      assert.equal(new Set(["v1", "v2", "v3"].map((label) => WR.downloads[`${label}_first`].sha256)).size, 3, "each version is its own content");
      // Every reporting purpose created in the interface reopens after a fresh page load as itself and downloads as saved.
      WR.reopened = {};
      for (const [purpose, draftId, label] of [
        ["internal_planning", WR.styled.created.internal_planning.draft_id, "Internal planning report"],
        ["board_update", WR.reports.board.draftId, "Board report"],
        ["funder_report", WR.styled.created.funder_report.draft_id, "Funder report"],
        ["annual_report", WR.styled.created.annual_report.draft_id, "Annual-report content"],
      ]) {
        await openSaved(draftId, `${purpose} (reopened)`);
        assert.equal(await pageJ.textOf("[data-client-internal-draft-detail-label]"), label, purpose);
        assert.equal(await pageJ.attrOf("[data-client-report-lineage]", "data-client-report-purpose"), purpose);
        const result = await exactDownload(draftId, `${purpose} reopened`);
        WR.reopened[purpose] = { draft_id: draftId, label, bytes: result.bytes, sha256: result.sha256 };
      }
    });

    await test("J13 (browser, real page): a revision or adaptation response that arrives after the administrator switched to another Project opens nothing and leaves the new Project's view as it is; each saved report stays in its own Project", async () => {
      await query("INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code, project_metadata) VALUES ($1::uuid, $2::uuid, $3, '{}'::jsonb) ON CONFLICT (engagement_id) DO NOTHING",
        [SECOND_PROJECT, O.organizationId, "Project B O planning (second Project)"]);
      WR.race = {};
      const switchProjectWhileHeld = async (label, pattern, startAction) => {
        const mark = pageJ.mark();
        let releaseMark = null;
        await holdResponses(pattern);
        try {
          await startAction();
          await pageJ.waitFor(async () => held.length === 1, `${label}: the response held`, { timeout: 60000 });
          await pageJ.selectProject(SECOND_PROJECT);
          await pageJ.waitFor(async () => /No internal drafts for this Project yet\./.test((await pageJ.textOf("[data-client-internal-draft-list]")) || ""),
            `${label}: the second Project's reports`, { timeout: 30000 });
          assert.equal(await pageJ.evaluate(`document.querySelector("[data-client-internal-draft-detail]")`), null, `${label}: nothing open before the late response`);
          releaseMark = pageJ.mark();
        } finally {
          await releaseHeld();
        }
        await pageJ.waitFor(() => pageJ.requestsSince(mark).some((r) => r.method === "POST" && r.done), `${label}: the original request completed`, { timeout: 60000 });
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await pageJ.idle();
        const posted = pageJ.requestsSince(mark).find((r) => r.method === "POST");
        const createdId = (await pageJ.responseBody(posted))?.data?.generatedContentDraftId ?? null;
        const after = {
          status: posted.status,
          created_id: createdId,
          selected_project: await pageJ.evaluate(`document.getElementById("gk-shell-project-select").value`),
          open_detail: await pageJ.evaluate(`(() => { const el = document.querySelector("[data-client-internal-draft-detail]"); return el ? el.getAttribute("data-client-internal-draft-detail") : null; })()`),
          list_text: ((await pageJ.textOf("[data-client-internal-draft-list]")) || "").slice(0, 400),
          late_requests: pageJ.requestsSince(releaseMark).filter((r) => (createdId && r.url.includes(createdId)) || r.url.includes(`/engagements/${O.projectId}/`))
            .map((r) => `${r.method} ${new URL(r.url).pathname} ${r.status}`),
          exceptions: [...pageJ.exceptions],
        };
        WR.race[label] = after;
        if (createdId) WR.added.push(createdId);
        return createdId;
      };
      // Both races are recorded before either is judged, so each path's behavior is observed.
      const assertRace = (label) => {
        const after = WR.race[label];
        assert.equal(after.status, 201, `${label}: ${J(after)}`);
        assert.equal(after.selected_project, SECOND_PROJECT, label);
        assert.equal(after.open_detail, null, `${label}: the late response must not open the original Project's report in the second Project: ${J(after)}`);
        assert.match(after.list_text, /No internal drafts for this Project yet\./, `${label}: the second Project's view is unchanged: ${J(after)}`);
        assert.deepEqual(after.late_requests, [], `${label}: the late response requested nothing for the original Project: ${J(after)}`);
        assert.deepEqual(after.exceptions, [], label);
      };

      // Revision of the latest funder version, delayed past a Project switch.
      const v3 = WR.reports.funderV3.draftId;
      await openSaved(v3, "version 3");
      await viewportJ(DESKTOP_J);
      await realClick(`[data-client-revise-report="${v3}"]`, "Revise wording (version 3)");
      await pageJ.waitFor(() => pageJ.visible(`[data-client-revise-editor="${v3}"]`), "the editor (version 3)");
      const RACE_TEXT = "For a funder the organization reports to: this version restates the saved assessment's findings on the people reached and the ratings participants gave, with each figure's sources and limitations.";
      assert.ok(await setTextarea('[data-client-revise-block="1"]', RACE_TEXT));
      const v4 = await switchProjectWhileHeld("revision", `*/client-internal-drafts/${v3}/revisions`, () => realClick("[data-client-save-revision]", "Save as version 4"));

      // Use this assessment, delayed past a Project switch.
      await openSaved(assessmentId(), "the saved assessment");
      await viewportJ(DESKTOP_J);
      await realClick('[data-client-adaptation-purpose="board_update"] input', "Board report");
      const board = await switchProjectWhileHeld("adaptation", `*/generated-content-drafts/${assessmentId()}/assessment-adaptations`,
        () => realClick("[data-client-create-adapted-report]", "Create report"));
      if (ARTIFACTS) writeFileSync(join(ARTIFACTS, "context-switch-race.json"), `${J(WR.race, null, 2)}\n`);
      assertRace("revision");
      assertRace("adaptation");

      // Back in the original Project both saved reports are listed and open as themselves.
      await pageJ.selectProject(O.projectId);
      await pageJ.waitFor(async () => {
        const listed = await pageJ.evaluate(`[...document.querySelectorAll("[data-client-internal-draft]")].map((el) => el.getAttribute("data-client-internal-draft"))`);
        return listed.includes(v4) && listed.includes(board);
      }, "both reports listed in their own Project", { timeout: 30000 });
      await realClick(`[data-client-internal-draft-open="${v4}"]`, "Open version 4");
      await pageJ.waitFor(() => pageJ.visible(`[data-client-internal-draft-detail="${v4}"]`), "version 4 opened in its Project", { timeout: 30000 });
      assert.equal(await pageJ.attrOf("[data-client-report-lineage]", "data-client-report-version"), "4");
      const v4Row = await draftRow(v4);
      const v4Lineage = lineageOfRow(v4Row);
      assert.deepEqual([v4Row.engagement_id, v4Lineage.version, v4Lineage.parent_draft_id, v4Lineage.root_report_draft_id], [O.projectId, 4, v3, WR.reports.funder.draftId]);
      assert.ok((await savedBlocks(v4))[0].text.startsWith(RACE_TEXT));
      const boardRow = await draftRow(board);
      assert.deepEqual([boardRow.engagement_id, boardRow.content_type, lineageOfRow(boardRow).reporting_purpose], [O.projectId, "board_update", "board_update"]);
      // The second Project never lists them; the server refuses them there.
      const secondList = await O.api("GET", clientInternalDraftsPath(O.organizationId, SECOND_PROJECT));
      assert.equal(secondList.status, 200, J(secondList.body));
      assert.deepEqual(secondList.body.data.items, []);
      for (const draftId of [v4, board]) {
        const crossProject = await O.api("GET", clientInternalDraftPath(O.organizationId, SECOND_PROJECT, draftId));
        assert.ok([403, 404].includes(crossProject.status), J(crossProject.body));
      }
      // A missing source assessment is refused and writes nothing.
      const drafts = (await counts(O.organizationId)).drafts;
      const missing = await adaptViaApi({ engagement_id: O.projectId, purpose: "funder_report", idempotency_key: `adapt-missing-${randomUUID()}` }, randomUUID());
      assert.ok([403, 404].includes(missing.status), J(missing.body));
      assert.equal((await counts(O.organizationId)).drafts, drafts, "nothing written for a missing assessment");
      WR.negatives.missing_assessment = missing.status;
      WR.race.back_in_project = { version_4: v4, board_report: board, second_project_list: secondList.body.data.items.length };
    });

    await test("J10: the whole journey - assessment reuse, three purpose reports, a revision, reads and downloads - wrote zero evidence, claim, coverage, follow-up, review, release or export decisions", async () => {
      const after = await workingCounts();
      const { drafts: draftsAfter, ...decisionsAfter } = after;
      const { drafts: draftsBefore, ...decisionsBefore } = approvalsBefore;
      assert.deepEqual(decisionsAfter, decisionsBefore, "no approval of any kind was needed or recorded");
      // The funder report (+ version 2), board, annual, internal planning and the AI-withdrawn funder report,
      // plus J11-J13: internal planning, funder report and annual-report content in the UI, versions 3 and 4, and a board report.
      assert.equal(WR.added.length, 6, J(WR.added));
      assert.equal(draftsAfter - draftsBefore, 6 + WR.added.length);
      WR.approvals = { before: approvalsBefore, after };
      if (ARTIFACTS) {
        writeFileSync(join(ARTIFACTS, "working-report-persistence.json"), `${J({ persistence: WR.persistence, negatives: WR.negatives, provider: WR.provider, approvals: WR.approvals,
          layout: WR.layout, styles: WR.styles, styled: WR.styled, downloads: WR.downloads, race: WR.race, attribution: WR.attribution, added: WR.added,
          capabilities: WR.capabilities, reopened: WR.reopened }, null, 2)}\n`);
      }
      await pageJ.close().catch(() => {});
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

// ---------------------------------------------------------------------------
// Independent recomputation for scenario O (owner direction 2026-11-12): the
// test reads the original workbook itself (ZIP central directory + sheet XML,
// none of KAI's parsing code) and applies the project brief's own pairing
// rule, so no outcome figure is hardcoded and KAI's result is checked against
// the source, not against itself.
// ---------------------------------------------------------------------------

function zipEntryText(buffer, name) {
  let eocd = buffer.length - 22;
  while (eocd >= 0 && buffer.readUInt32LE(eocd) !== 0x06054b50) eocd -= 1;
  let offset = buffer.readUInt32LE(eocd + 16);
  for (let index = 0; index < buffer.readUInt16LE(eocd + 10); index += 1) {
    const method = buffer.readUInt16LE(offset + 10);
    const size = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const local = buffer.readUInt32LE(offset + 42);
    if (buffer.toString("utf8", offset + 46, offset + 46 + nameLength) === name) {
      const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
      const data = buffer.subarray(start, start + size);
      return (method === 8 ? inflateRawSync(data) : data).toString("utf8");
    }
    offset += 46 + nameLength + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
  return null;
}

function worksheetRows(bytes, sheetNumber) {
  const decode = (text) => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  const sharedXml = zipEntryText(bytes, "xl/sharedStrings.xml");
  const shared = sharedXml ? [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => decode([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""))) : [];
  const xml = zipEntryText(bytes, `xl/worksheets/sheet${sheetNumber}.xml`);
  return [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((row) => {
    const cells = {};
    for (const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const column = /r="([A-Z]+)\d+"/.exec(cell[1])[1];
      const type = /t="([^"]+)"/.exec(cell[1])?.[1];
      const inner = cell[2] || "";
      const raw = type === "inlineStr" ? [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("") : /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "";
      cells[column] = type === "s" ? shared[Number(raw)] : decode(raw);
    }
    return cells;
  });
}

function columnOf(header, name) {
  const column = Object.keys(header).find((key) => header[key] === name);
  assert.ok(column, `the workbook has a ${name} column`);
  return column;
}

// The brief: "Scores can be compared only when the same person completed both
// stages using the same tool_version and both values for the particular
// measure are present." Missing values are never zero.
function independentPairs(rows, scoreHeader) {
  const [header, ...data] = rows;
  const [person, stage, version, score] = ["participant_id", "stage", "tool_version", scoreHeader].map((name) => columnOf(header, name));
  const byPerson = new Map();
  for (const row of data) if (row[person]) byPerson.set(row[person], [...(byPerson.get(row[person]) || []), row]);
  let higher = 0; let same = 0; let lower = 0;
  for (const observations of byPerson.values()) {
    const baseline = observations.filter((row) => row[stage] === "baseline");
    const followup = observations.filter((row) => row[stage] === "followup");
    if (baseline.length !== 1 || followup.length !== 1 || baseline[0][version] !== followup[0][version]) continue;
    if (!baseline[0][score] || !followup[0][score]) continue;
    const change = Number(followup[0][score]) - Number(baseline[0][score]);
    if (change > 0) higher += 1; else if (change < 0) lower += 1; else same += 1;
  }
  const pairs = higher + same + lower;
  return { column: score, participants: byPerson.size, pairs, higher, same, lower, excluded: byPerson.size - pairs,
    percentage: (Math.round((higher * 10000) / pairs) / 100).toFixed(2) };
}

function independentRate(rows, { condition, population }) {
  const [header, ...data] = rows;
  const [conditionColumn, populationColumn] = [condition[0], population[0]].map((name) => columnOf(header, name));
  const measured = data.filter((row) => row[populationColumn] === population[1]);
  const numerator = measured.filter((row) => row[conditionColumn] === condition[1]).length;
  return { numerator, denominator: measured.length, percentage: (Math.round((numerator * 10000) / measured.length) / 100).toFixed(2) };
}
