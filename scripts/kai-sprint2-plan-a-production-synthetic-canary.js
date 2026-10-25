#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STATE_ROOT = join(ROOT, ".kai-production-canary", "runs");
const SENTINEL_DATABASE_URL = "postgres://127.0.0.1:9/kai_sentinel";
const DEFAULT_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEFAULT_CDP_ENDPOINT = "http://127.0.0.1:9222";
const API_PREFIX = "/api/kai/sprint2/intake";
export const SYNTHETIC_CSV_PATH = join(ROOT, "scripts", "fixtures", "kai-plan-a-production-synthetic-records.csv");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const STAGES = [
  ["workspace", "Authenticate as the customer administrator; select the existing synthetic organization and engagement."],
  ["upload_processing", "In the customer Files UI, upload the supplied synthetic CSV. Wait for the deployed scan and P1 processing to finish."],
  ["sensitivity_source", "In Data Sources, inspect the source and record the human sensitivity, allowed-use, AI-use, and promotion decisions."],
  ["measurement", "Use Count records and attest the human-defined unit and reporting period; record the measurement through the UI."],
  ["internal_eligibility", "Automatic: the ordinary measured claim is eligible for internal use with no review (owner decision 2026-10-25); the runner verifies it in Impact Facts."],
  ["generation", "Generate an internal Evidence Summary as the customer administrator using the live application."],
  ["download_validation", "Open the draft's internal report and download the Markdown; no factual approval or release step exists for internal use."]
];

// The three source-level coverage limitations are carried, unresolved, into
// every internal report (owner decision 2026-10-25); nobody accepts them.
export const MEASURED_LIMITATION_CODES = [
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
const REQUIRED_LIMITATION_WORDING = [
  /conflicting sources?[^\n]*(unresolved|not yet resolved|limitation)/i,
  /duplicates?[^\n]*(risk flagged|limitation)/i,
  /missingness[^\n]*(risk flagged|limitation)/i,
  /alignment with funder requirements[^\n]*(unresolved|not yet resolved|limitation)/i,
  /small.cell[^\n]*(unresolved|not yet resolved|limitation)/i,
  /time period clarity[^\n]*(risk flagged|limitation)/i,
  /blank records?[^\n]*(excluded|exclude)/i,
  /duplicate records?[^\n]*(included|include)/i,
  /period[^\n]*(human.attested|attested)[^\n]*(not row.verified|not verified against record dates)/i,
  /record meaning[^\n]*(human.defined|human.confirmed)/i,
];

export function countCsvRecords(text) {
  const lines = String(text).replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  const data = lines.slice(1);
  const blank = data.filter((line) => line.trim() === "").length;
  const nonblank = data.filter((line) => line.trim() !== "");
  const occurrences = new Map();
  for (const row of nonblank) occurrences.set(row, (occurrences.get(row) || 0) + 1);
  const duplicateRows = [...occurrences.values()].reduce((sum, count) => sum + (count > 1 ? count : 0), 0);
  return { totalDataRows: data.length, blankDataRows: blank, countedRecords: nonblank.length, duplicateNonblankRowsIncluded: duplicateRows };
}

// The internal report (Backend/kai/services/kaiInternalReportMarkdownSerializer.js).
// Its "does not establish" and conclusion sections deliberately negate
// participants, outcomes and impact, so unsupported findings are looked for
// only in the model-written narrative and the key findings.
function markdownSection(content, heading) {
  return (content.split(`\n## ${heading}\n`)[1] || "").split("\n## ")[0];
}

export function validateMarkdown(markdown, { periodStart, periodEnd, sourceVersionId, claimId, evidenceId } = {}) {
  const content = String(markdown || "");
  const findings = `${markdownSection(content, "Key findings")}\n${markdownSection(content, "Generated narrative")}`;
  const checks = {
    internalReport: /^# Internal (?:Evidence Summary|Impact Narrative)\n/.test(content),
    countFive: /\*\*(?:5|five)\s+programme sessions?\*\*/i.test(markdownSection(content, "Key findings")),
    blankExcluded: /blank record[^\n]*(excluded|exclude)/i.test(content),
    duplicatesIncluded: /duplicate[^\n]*(included|include)/i.test(markdownSection(content, "Duplicate records")),
    sourceRecordUnit: /source records?/i.test(content),
    attestedPeriod: Boolean(periodStart && periodEnd && content.includes(periodStart) && content.includes(periodEnd)),
    sourceVersionCitation: Boolean(sourceVersionId && content.includes(sourceVersionId)),
    claimCitation: Boolean(claimId && content.includes(claimId)),
    evidenceCitation: Boolean(evidenceId && content.includes(evidenceId)),
    // A raw CSV row starts "date,word"; a governed statement may put a comma
    // after the period's end date ("... 2026-09-30, counting ...").
    noRawCsvRows: !/\d{4}-\d{2}-\d{2},[A-Za-z]/.test(content),
    generatedNarrativePresent: markdownSection(content, "Generated narrative").trim().length > 0,
    unsupportedClaimsAbsent: !/\b(?:participants?|outcomes?|attendance rates?|percentages?|caused|resulted in|led to|impact)\b/i.test(findings),
    limitationsPresent: MEASURED_LIMITATION_CODES.every((code, index) => content.includes(code) || REQUIRED_LIMITATION_WORDING[index].test(content))
  };
  return { ok: Object.values(checks).every(Boolean), checks };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) throw new Error(`Unexpected argument: ${argv[i]}`);
    const key = argv[i].slice(2);
    if (["owner-authorized"].includes(key)) args[key] = true;
    else {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
      args[key] = value;
    }
  }
  return args;
}

function safeTarget(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("--url must be the live application URL"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("Refusing URL: provide an HTTPS application origin/path without credentials, query, or fragment");
  return url;
}

function chromePath() {
  const candidate = process.env.KAI_BROWSER_ACCEPTANCE_CHROME || DEFAULT_CHROME;
  if (!existsSync(candidate)) throw new Error(`Chrome not found at ${candidate}; set KAI_BROWSER_ACCEPTANCE_CHROME to the installed Chrome executable`);
  return candidate;
}

async function launchChrome(url, { headless = false } = {}) {
  const chrome = chromePath();
  const profileDir = join(tmpdir(), `kai-production-canary-chrome-${randomUUID()}`);
  await mkdir(profileDir, { recursive: true, mode: 0o700 });
  const flags = [
    ...(headless ? ["--headless=new"] : []), "--remote-debugging-port=0", `--user-data-dir=${profileDir}`,
    "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-background-networking", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage", url.href
  ];
  const child = spawn(chrome, flags, { stdio: ["ignore", "ignore", "pipe"] });
  let chromeError = "";
  child.stderr.on("data", (chunk) => { chromeError = `${chromeError}${chunk}`.slice(-2000); });
  const portFile = join(profileDir, "DevToolsActivePort");
  let activePort;
  for (let i = 0; i < 100; i += 1) {
    if (existsSync(portFile)) { activePort = Number(readFileSync(portFile, "utf8").split("\n")[0]); break; }
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!activePort) {
    child.kill("SIGTERM");
    await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    throw new Error(`Chrome DevTools did not start; no login or canary action was attempted${chromeError ? ` (${chromeError.trim().split("\n").at(-1)})` : ""}`);
  }
  const version = await (await fetch(`http://127.0.0.1:${activePort}/json/version`)).json();
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (!message.id || !pending.has(message.id)) return;
    const task = pending.get(message.id); pending.delete(message.id);
    message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolveSend, reject) => {
    const id = nextId++;
    pending.set(id, { resolve: resolveSend, reject });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);
  if (url.protocol === "https:") {
    await send("Page.navigate", { url: url.href }, sessionId);
    const deadline = Date.now() + 15000;
    let ready = false;
    while (Date.now() < deadline) {
      try { ready = await (async () => { const result = await send("Runtime.evaluate", { expression: "location.origin", returnByValue: true }, sessionId); return result.result.value === url.origin; })(); } catch {}
      if (ready) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    if (!ready) {
      socket.close(); child.kill("SIGTERM");
      await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      throw new Error("Chrome did not reach the selected application origin; no login or canary action was attempted");
    }
  }
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (result.exceptionDetails) throw new Error("Browser page evaluation failed");
    return result.result.value;
  };
  return {
    profileDir, child,
    async navigate(destination) {
      const target = safeTarget(destination);
      if (target.origin !== url.origin) throw new Error("Navigation outside the selected application origin refused");
      await send("Page.navigate", { url: target.href }, sessionId);
    },
    evaluate,
    async probe(path) {
      const apiPath = path.startsWith(`${API_PREFIX}/`) ? path : `${API_PREFIX}${path.startsWith("/") ? path : `/${path}`}`;
      if (!apiPath.startsWith(`${API_PREFIX}/`)) throw new Error("Only the known KAI application API prefix is allowed");
      return evaluate(`(async()=>{const r=await fetch(${JSON.stringify(apiPath)},{credentials:'same-origin',headers:{Accept:'application/json'}});let j=null;try{j=await r.json()}catch{};return {status:r.status,body:j}})()`);
    },
    async probeText(path) {
      const apiPath = path.startsWith(`${API_PREFIX}/`) ? path : `${API_PREFIX}${path.startsWith("/") ? path : `/${path}`}`;
      if (!apiPath.startsWith(`${API_PREFIX}/`)) throw new Error("Only the known KAI application API prefix is allowed");
      return evaluate(`(async()=>{const r=await fetch(${JSON.stringify(apiPath)},{credentials:'same-origin',headers:{Accept:'text/markdown'}});return {status:r.status,disposition:r.headers.get('content-disposition'),text:await r.text()}})()`);
    },
    async close() {
      try { await send("Browser.close"); } catch {}
      socket.close();
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await Promise.race([new Promise((resolveExit) => child.once("exit", resolveExit)), new Promise((resolveTimeout) => setTimeout(resolveTimeout, 3000))]);
      }
      await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  };
}

export function safeCdpEndpoint(value) {
  let endpoint;
  try { endpoint = new URL(value || DEFAULT_CDP_ENDPOINT); } catch { throw new Error("Browser connection must be a local Chrome DevTools URL, such as http://127.0.0.1:9222"); }
  if (!new Set(["http:", "https:"]).has(endpoint.protocol) || !new Set(["127.0.0.1", "localhost", "[::1]"]).has(endpoint.hostname) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error("Refusing browser connection: only a local loopback Chrome DevTools endpoint is allowed");
  }
  endpoint.pathname = endpoint.pathname.replace(/\/$/, "");
  return endpoint;
}

async function attachExistingChrome(url, endpointValue) {
  const endpoint = safeCdpEndpoint(endpointValue || process.env.KAI_BROWSER_CDP_URL);
  let versionResponse;
  let targetsResponse;
  try {
    [versionResponse, targetsResponse] = await Promise.all([
      fetch(new URL(`${endpoint.pathname}/json/version`, endpoint)),
      fetch(new URL(`${endpoint.pathname}/json/list`, endpoint)),
    ]);
  } catch {
    throw new Error(`signed_in_browser_unavailable: cannot reach ${endpoint.origin}; open the browser terminal's signed-in Chrome with remote debugging enabled and set KAI_BROWSER_CDP_URL`);
  }
  if (!versionResponse.ok || !targetsResponse.ok) throw new Error(`signed_in_browser_unavailable: ${endpoint.origin} did not expose Chrome DevTools page targets`);
  const version = await versionResponse.json();
  const targets = await targetsResponse.json();
  const target = (Array.isArray(targets) ? targets : []).find((candidate) => {
    if (candidate.type !== "page" || typeof candidate.url !== "string") return false;
    try {
      const current = new URL(candidate.url);
      return current.origin === url.origin && (url.pathname === "/" || current.pathname === url.pathname);
    } catch { return false; }
  });
  if (!target?.id || !version.webSocketDebuggerUrl) throw new Error(`signed_in_app_tab_not_found: open ${url.origin} in the already signed-in browser, then rerun; no new browser or login window was opened`);

  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (!message.id || !pending.has(message.id)) return;
    const task = pending.get(message.id); pending.delete(message.id);
    message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolveSend, reject) => {
    const id = nextId++;
    pending.set(id, { resolve: resolveSend, reject });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { sessionId } = await send("Target.attachToTarget", { targetId: target.id, flatten: true });
  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (result.exceptionDetails) throw new Error("Browser page evaluation failed");
    return result.result.value;
  };
  const probe = async (path, accept = "application/json") => {
    const apiPath = path.startsWith(`${API_PREFIX}/`) ? path : `${API_PREFIX}${path.startsWith("/") ? path : `/${path}`}`;
    if (!apiPath.startsWith(`${API_PREFIX}/`)) throw new Error("Only the known KAI application API prefix is allowed");
    return evaluate(`(async()=>{const r=await fetch(${JSON.stringify(apiPath)},{credentials:'same-origin',headers:{Accept:${JSON.stringify(accept)}}});if(${JSON.stringify(accept)}==='text/markdown')return {status:r.status,disposition:r.headers.get('content-disposition'),text:await r.text()};let j=null;try{j=await r.json()}catch{};return {status:r.status,body:j}})()`);
  };
  return {
    targetUrl: target.url,
    async navigate(destination) {
      const next = safeTarget(destination);
      if (next.origin !== url.origin) throw new Error("Navigation outside the selected application origin refused");
      await send("Page.navigate", { url: next.href }, sessionId);
    },
    evaluate,
    probe: (path) => probe(path),
    probeText: (path) => probe(path, "text/markdown"),
    async close() {
      try { await send("Target.detachFromTarget", { sessionId }); } catch {}
      socket.close();
    }
  };
}

function cleanResult(result) {
  const status = Number(result?.status || 0);
  const body = result?.body;
  const code = typeof body?.error?.code === "string" ? body.error.code : typeof body?.error_code === "string" ? body.error_code : undefined;
  return { status, ...(code ? { code } : {}), authenticated: status !== 401 && status !== 403 };
}

async function readState(runId) {
  if (!/^[a-f0-9-]{36}$/i.test(runId)) throw new Error("Invalid run ID");
  return JSON.parse(await readFile(join(STATE_ROOT, `${runId}.json`), "utf8"));
}

async function saveState(state) {
  await mkdir(STATE_ROOT, { recursive: true, mode: 0o700 });
  await writeFile(join(STATE_ROOT, `${state.runId}.json`), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

async function promptLine(rl, message) { await rl.question(`\n${message}\nPress Enter when complete (Ctrl+C stops safely): `); }

function dataOf(response) { return response?.body?.data || null; }
function apiCode(response) {
  return response?.body?.error?.code || response?.body?.error_code || `http_${response?.status || 0}`;
}
function uuid(value, label) {
  if (!UUID_RE.test(value || "")) throw new Error(`${label} must be the canonical UUID shown by the application`);
  return value.toLowerCase();
}
function allPipelineStagesComplete(file, keys) {
  const stages = new Map((file?.stages || []).map((stage) => [stage.key, stage]));
  return keys.every((key) => stages.get(key)?.status === "complete");
}
function containsId(value, id) {
  return JSON.stringify(value || {}).includes(id);
}
function isPlainObject(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function failureKind(message) {
  if (/feature_disabled|capability_missing|not_found|not_authorized/i.test(message)) return "UNAVAILABLE_CONFIGURATION_OR_AUTHORITY";
  if (/authentication|http_401|http_403/i.test(message)) return "AUTHENTICATION_REQUIRED";
  if (/not_verified|not_verifiable|stale_or_unverified|assertions_failed/i.test(message)) return "INSUFFICIENT_VERIFICATION_EVIDENCE";
  return "APPLICATION_OR_PRODUCT_FAILURE";
}
export function authenticationBlocker(status) {
  return status === 200 ? null : status === 401 || status === 403 ? `authentication_required:http_${status}` : `authorized_read_unavailable:http_${status}`;
}
export function capabilityBlocker(capabilities) {
  const absent = Object.entries(capabilities || {}).filter(([, allowed]) => allowed !== true).map(([name]) => name);
  return absent.length === 0 ? null : `required_role_capability_missing:${absent.join(",")}`;
}
export function shouldRepeatHumanAction(pendingHumanAction) { return pendingHumanAction !== "awaiting_verification"; }

async function boundedPoll(read, accept, label, { timeoutMs = 120000, initialDelayMs = 500, maxDelayMs = 5000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let delay = initialDelayMs;
  let last;
  while (Date.now() < deadline) {
    last = await read();
    if (accept(last)) return last;
    if (last?.status && ![200, 202, 404].includes(last.status)) throw new Error(`${label}: ${apiCode(last)}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, delay));
    delay = Math.min(maxDelayMs, Math.ceil(delay * 1.5));
  }
  throw new Error(`${label}: bounded wait expired; latest status ${apiCode(last)}`);
}

const WORKFLOW_STAGE_TEXT = [
  ["upload_processing", "In the customer UI, create an intake batch named with this canary ID and upload the supplied synthetic CSV file. Do not re-upload if the row already appears. The runner will verify the exact canary filename, clean security result, P1 processing/profile stages, and the file checksum."],
  ["sensitivity_source", "In Data Sources, inspect the profile and complete the customer sensitivity, allowed-use, AI-use, and promotion decisions. Do not infer absence; record only the findings you can attest. Then provide the promoted current source-version UUID shown by the app."],
  ["measurement", "Use Count records. For this accepted synthetic fixture, define each nonblank data row as one programme session (header/blank excluded; exact duplicate nonblank rows retained). Enter only the synthetic reporting period your organization can genuinely attest; do not infer a period from row dates. Record the definition/measurement and propose the claim through the UI."],
  ["internal_eligibility", "No human action: the runner verifies that the measured claim is eligible for internal use (Impact Facts). Nobody reviews or approves it."],
  ["generation", "As the customer administrator, create the internal Evidence Summary in the UI using the live generation action. Then provide the generated draft UUID shown by the application."],
  ["download_validation", "In \"Your internal drafts\", open the draft and use \"Open report\" / \"Download Markdown\". The runner will fetch the same authorized internal report route and validate its content and attachment response."]
];
// Stages with no human action: the runner only verifies.
const AUTOMATIC_STAGES = new Set([4]);

// Owner decision 2026-10-25: no stage waits for a Get Kinder reviewer.
function stageRole() { return "customer"; }
function stageName(index) { return index === 0 ? "workspace" : WORKFLOW_STAGE_TEXT[index - 1][0]; }

async function interactive(args) {
  const mode = args.mode;
  if (!new Set(["preflight", "execute", "resume"]).has(mode)) throw new Error("Use --mode preflight, --mode execute, or --mode resume");
  if (mode !== "preflight" && args["owner-authorized"] !== true) throw new Error("Execution requires explicit --owner-authorized attestation of separate prior owner authorization");
  const target = safeTarget(args.url);
  const role = args.role || "customer";
  if (!new Set(["customer", "gk"]).has(role)) throw new Error("--role must be customer or gk");
  const csv = readFileSync(SYNTHETIC_CSV_PATH, "utf8");
  const counts = countCsvRecords(csv);
  const expected = { totalDataRows: 6, blankDataRows: 1, countedRecords: 5, duplicateNonblankRowsIncluded: 2 };
  if (JSON.stringify(counts) !== JSON.stringify(expected)) throw new Error(`Synthetic fixture count mismatch: ${JSON.stringify(counts)}`);

  let state;
  if (mode === "resume") {
    if (!args["run-id"]) throw new Error("Resume requires --run-id");
    state = await readState(args["run-id"]);
    if (state.origin !== target.origin) throw new Error("Run URL origin does not match the saved correlation state");
    if (!Number.isInteger(state.stageIndex) || state.stageIndex < 0 || state.stageIndex > STAGES.length || !Array.isArray(state.stages) || state.stages.length !== state.stageIndex || state.stages.some((stage) => stage.status !== "PASS" || stage.evidenceClass !== "TOOL_VERIFIED")) throw new Error("Saved state is inconsistent; refusing to skip or replay a stage");
    uuid(state.organizationId, "saved organization ID");
    uuid(state.engagementId, "saved engagement ID");
    if (state.roleRequired && state.roleRequired !== role) throw new Error(`This run is waiting for the ${state.roleRequired} identity; supplied role ${role} cannot continue`);
  } else if (mode === "execute") {
    if (role !== "customer") throw new Error("Initial execution must start with the customer administrator");
    state = {
      runId: randomUUID(), origin: target.origin, canaryId: `KAI-SYNTH-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`,
      createdAt: new Date().toISOString(), organizationId: uuid(args["organization-id"], "--organization-id"),
      engagementId: uuid(args["engagement-id"], "--engagement-id"), stageIndex: 0, roleRequired: "customer", ids: {}, stages: []
    };
    const fixtureDirectory = join(STATE_ROOT, "fixtures");
    await mkdir(fixtureDirectory, { recursive: true, mode: 0o700 });
    state.fixturePath = join(fixtureDirectory, `${state.canaryId}.csv`);
    await writeFile(state.fixturePath, csv, { mode: 0o600, flag: "wx" });
    await saveState(state);
  } else {
    state = {
      organizationId: args["organization-id"] ? uuid(args["organization-id"], "--organization-id") : null,
      engagementId: args["engagement-id"] ? uuid(args["engagement-id"], "--engagement-id") : null,
    };
  }

  const activeStage = state.stageIndex;
  if (mode !== "preflight" && stageRole(activeStage) !== role) {
    state.roleRequired = stageRole(activeStage);
    state.handoff = { stage: stageName(activeStage), status: "WAITING_FOR_HUMAN", requiredRole: state.roleRequired, updatedAt: new Date().toISOString() };
    await saveState(state);
    console.log(`WAITING_FOR_HUMAN: stage ${stageName(activeStage)} requires the ${state.roleRequired} identity.`);
    console.log(`Resume: DATABASE_URL=${SENTINEL_DATABASE_URL} node scripts/kai-sprint2-plan-a-production-synthetic-canary.js --mode resume --owner-authorized --role ${state.roleRequired} --url ${target.origin} --run-id ${state.runId}`);
    return;
  }
  if (mode !== "preflight" && state.handoff) {
    state.handoff = null;
    await saveState(state);
  }

  const rl = createInterface({ input: stdin, output: stdout });
  let browser;
  try {
    browser = await attachExistingChrome(target, args["browser-cdp-url"]);
    console.log(`Connected to the existing browser tab ${browser.targetUrl}. No new browser, profile, login window, or test account was created.`);
    await promptLine(rl, `Confirm the already signed-in ${role === "gk" ? "GK reviewer" : "customer administrator"} is active in that tab and the existing synthetic organization/engagement ${state.engagementId || "is selected"}; do not inspect any other organization's data.`);
    const organizationList = await browser.probe("/admin/organizations");
    if (organizationList.status !== 200) throw new Error(`${authenticationBlocker(organizationList.status)}:${apiCode(organizationList)}`);

    if (mode === "preflight") {
      let capabilities;
      let roleCapabilities = null;
      let absent = [];
      if (state.organizationId) {
        const capabilitiesResponse = await browser.probe(`/admin/organizations/${state.organizationId}/access-capabilities`);
        capabilities = dataOf(capabilitiesResponse);
        if (capabilitiesResponse.status !== 200 || !isPlainObject(capabilities)) throw new Error(`organization_capabilities:${apiCode(capabilitiesResponse)}`);
        const operationCaps = capabilities.workflowOperations || {};
        roleCapabilities = role === "customer"
          ? { intakeContribution: capabilities.intakeContribution, promoteSource: operationCaps.promoteSource, recordSourceMeasurement: operationCaps.recordSourceMeasurement, generateDrafts: operationCaps.generateDrafts, readInternalDrafts: operationCaps.readInternalDrafts }
          : { evidenceReview: operationCaps.recordEvidenceReview, claimReview: operationCaps.recordClaimReview, coverage: operationCaps.assessEvidenceCoverage };
        absent = Object.entries(roleCapabilities).filter(([, allowed]) => allowed !== true).map(([name]) => name);
      }
      if (state.organizationId && args["engagement-id"]) {
        const engagements = await browser.probe(`/admin/organizations/${state.organizationId}/engagements`);
        if (engagements.status !== 200 || !containsId(dataOf(engagements), uuid(args["engagement-id"], "--engagement-id"))) throw new Error(`engagement_not_authorized_or_not_found:${apiCode(engagements)}`);
      }
      console.log(JSON.stringify({
        mode: "preflight", targetOrigin: target.origin, environment: "application identity not exposed by capability read", browser: "Chrome_CDP_READY", authenticated: true, role,
        selectedOrganization: state.organizationId ? "capability_read_completed" : "not_selected; supply --organization-id to verify",
        roleCapabilities: roleCapabilities || "NOT_CHECKED",
        selectedEngagement: args["engagement-id"] && state.organizationId ? "PASS" : "NOT_CHECKED",
        fixture: counts,
        runtime: { storage: "NOT_CONFIRMED", malwareScanner: "NOT_CONFIRMED", P1Worker: "NOT_CONFIRMED", modelProvider: "NOT_CONFIRMED" },
        blocker: absent.length ? `required_role_capability_missing:${absent.join(",")}` : null
      }, null, 2));
      return;
    }

    const capPath = `/admin/organizations/${state.organizationId}/access-capabilities`;
    const capabilitiesResponse = await browser.probe(capPath);
    const capabilities = dataOf(capabilitiesResponse);
    if (capabilitiesResponse.status !== 200 || !isPlainObject(capabilities)) throw new Error(`organization_capabilities:${apiCode(capabilitiesResponse)}`);
    const operationCaps = capabilities.workflowOperations || {};
    const roleCapabilities = role === "customer"
      ? { intakeContribution: capabilities.intakeContribution, promoteSource: operationCaps.promoteSource, recordSourceMeasurement: operationCaps.recordSourceMeasurement, generateDrafts: operationCaps.generateDrafts, readInternalDrafts: operationCaps.readInternalDrafts }
      : { evidenceReview: operationCaps.recordEvidenceReview, claimReview: operationCaps.recordClaimReview, coverage: operationCaps.assessEvidenceCoverage };
    const blocker = capabilityBlocker(roleCapabilities);
    if (blocker) throw new Error(blocker);

    const pipelinePath = `/admin/organizations/${state.organizationId}/engagements/${state.engagementId}/client-evidence-pipeline`;
    const measurementPath = (sourceVersionId) => `/admin/organizations/${state.organizationId}/source-versions/${sourceVersionId}/record-count-measurement`;
    const impactFactsPath = `/admin/organizations/${state.organizationId}/impact-facts`;
    const claimIsImpactFact = async () => {
      const facts = await browser.probe(impactFactsPath);
      return facts.status === 200 && (dataOf(facts)?.items || []).some((item) => item.claimId === state.ids.claimId);
    };
    const draftPath = (draftId) => `/admin/organizations/${state.organizationId}/engagements/${state.engagementId}/client-internal-drafts/${draftId}`;

    if (mode === "resume" && state.stageIndex > 0) {
      const workspace = await browser.probe(`/admin/organizations/${state.organizationId}/engagements`);
      if (workspace.status !== 200 || !containsId(dataOf(workspace), state.engagementId)) throw new Error(`resume_workspace_recheck_failed:${apiCode(workspace)}`);
    }
    if (mode === "resume" && state.stageIndex >= 2) {
      const pipeline = await browser.probe(pipelinePath);
      const file = (dataOf(pipeline)?.files || []).find((entry) => entry.intakeFileId === state.ids.intakeFileId);
      const source = await browser.probe(measurementPath(state.ids.sourceVersionId));
      const basis = dataOf(source)?.basis;
      if (pipeline.status !== 200 || !allPipelineStagesComplete(file, ["upload", "security_check", "processing", "data_dictionary", "sensitivity_classification", "sensitivity_review", "source_review"]) || source.status !== 200 || dataOf(source)?.sourceVersion?.is_current !== true || basis?.data_record_count !== 6 || basis?.blank_record_count !== 1 || basis?.duplicate_record_count !== 2 || basis?.counted_record_count !== 5) throw new Error("resume_prior_source_state_stale_or_unverified");
    }
    if (mode === "resume" && state.stageIndex >= 4) {
      const recordedResponse = await browser.probe(measurementPath(state.ids.sourceVersionId));
      const recorded = dataOf(recordedResponse)?.recorded;
      if (recordedResponse.status !== 200 || Number(recorded?.measurement?.measured_value) !== 5 || Number(recorded?.measurement?.total_record_count) !== 6 || Number(recorded?.measurement?.blank_record_count) !== 1 || Number(recorded?.measurement?.duplicate_record_count) !== 2 || recorded?.definition?.period_start !== state.attestedPeriod?.start || recorded?.definition?.period_end !== state.attestedPeriod?.end || recorded?.claim?.claim_id !== state.ids.claimId) throw new Error("resume_prior_measurement_or_claim_stale_or_unverified");
    }
    if (mode === "resume" && state.stageIndex >= 5 && !(await claimIsImpactFact())) throw new Error("resume_prior_internal_eligibility_stale_or_unverified");
    if (mode === "resume" && state.stageIndex >= 6) {
      const draftResponse = await browser.probe(draftPath(state.ids.draftId));
      const draft = dataOf(draftResponse);
      const citedClaimIds = new Set((draft?.blocks || []).flatMap((block) => block.supportingClaimIds || []));
      if (draftResponse.status !== 200 || draft.contentType !== "evidence_summary" || draft.audience !== "internal" || draft.citedClaimsCurrentlyEligible !== true || citedClaimIds.size !== 1 || !citedClaimIds.has(state.ids.claimId)) throw new Error("resume_prior_draft_or_citation_stale_or_unverified");
      if (draft.internalReport?.available !== true) throw new Error("resume_prior_internal_report_unavailable");
    }

    while (state.stageIndex < STAGES.length) {
      const index = state.stageIndex;
      const stageId = stageName(index);
      if (stageRole(index) !== role) {
        state.roleRequired = stageRole(index);
        state.handoff = { stage: stageId, status: "WAITING_FOR_HUMAN", requiredRole: state.roleRequired, updatedAt: new Date().toISOString() };
        await saveState(state);
        console.log(`WAITING_FOR_HUMAN: completed stages through ${state.stages.at(-1)?.stage || "workspace"}; next stage ${stageId} requires a separate ${state.roleRequired} login.`);
        console.log(`Resume: DATABASE_URL=${SENTINEL_DATABASE_URL} node scripts/kai-sprint2-plan-a-production-synthetic-canary.js --mode resume --owner-authorized --role ${state.roleRequired} --url ${target.origin} --run-id ${state.runId}`);
        return;
      }

      let result = {};
      if (index === 0) {
        const engagements = await browser.probe(`/admin/organizations/${state.organizationId}/engagements`);
        if (engagements.status !== 200 || !containsId(dataOf(engagements), state.engagementId)) throw new Error(`engagement_not_authorized_or_not_found:${apiCode(engagements)}`);
        result = { organizationCapabilities: "verified", engagement: "verified", role };
      } else {
        const [_, instruction] = WORKFLOW_STAGE_TEXT[index - 1];
        if (AUTOMATIC_STAGES.has(index)) {
          console.log(`\nSTAGE ${index}/${STAGES.length - 1}: ${stageId}\n${instruction}`);
        } else if (shouldRepeatHumanAction(state.pendingHumanAction)) {
          console.log(`\nSTAGE ${index}/${STAGES.length - 1}: ${stageId}\n${instruction}`);
          if (index === 1) console.log(`Select this exact local synthetic CSV in the UI: ${state.fixturePath}`);
          if (index === 3) {
            const periodStart = await rl.question("Human-attested synthetic period start (YYYY-MM-DD): ");
            const periodEnd = await rl.question("Human-attested synthetic period end (YYYY-MM-DD): ");
            if (!validDate(periodStart) || !validDate(periodEnd) || periodStart > periodEnd) throw new Error("A valid genuinely attested synthetic reporting period is required; no measurement was accepted by this runner");
            state.attestedPeriod = { start: periodStart, end: periodEnd, attestedByOperator: true };
          }
          state.pendingHumanAction = "awaiting_verification";
          await saveState(state);
          await promptLine(rl, instruction);
          if (index === 2 && !state.ids.sourceVersionId) state.ids.sourceVersionId = uuid(await rl.question("Promoted current source-version UUID shown by the app: "), "source-version ID");
          if (index === 5 && !state.ids.draftId) state.ids.draftId = uuid(await rl.question("Generated internal draft UUID shown by the app: "), "draft ID");
          await saveState(state);
        } else {
          console.log(`Re-reading ${stageId} after an interrupted handoff. Inspect the UI first; if the action is already complete, do not repeat it. If it was not completed, finish it now.`);
          await promptLine(rl, "Confirm the current UI state and complete only any still-missing human action; then continue for authoritative verification.");
          if (index === 2 && !state.ids.sourceVersionId) state.ids.sourceVersionId = uuid(await rl.question("Promoted current source-version UUID shown by the app: "), "source-version ID");
          if (index === 5 && !state.ids.draftId) state.ids.draftId = uuid(await rl.question("Generated internal draft UUID shown by the app: "), "draft ID");
        }

        if (index === 1) {
          const pipeline = await boundedPoll(
            () => browser.probe(pipelinePath),
            (response) => {
              const files = dataOf(response)?.files || [];
              const file = files.find((entry) => String(entry.safeFilename || "").includes(state.canaryId));
              const failed = (file?.stages || []).find((stage) => ["failed", "blocked", "rejected"].includes(stage.status));
              if (failed) throw new Error(`upload_scan_p1_profile:${failed.key || "processing_stage"}_${failed.status}`);
              return response.status === 200 && file && allPipelineStagesComplete(file, ["upload", "security_check", "processing", "data_dictionary", "sensitivity_classification"]);
            }, "upload_scan_p1_profile",
          );
          const file = dataOf(pipeline).files.find((entry) => String(entry.safeFilename || "").includes(state.canaryId));
          state.ids.intakeFileId = uuid(file.intakeFileId, "intake file ID");
          const detail = await browser.probe(`/admin/files/${state.ids.intakeFileId}`);
          const metadata = dataOf(detail);
          const checksumValues = [];
          const scanStrings = (value, key = "") => {
            if (!value || typeof value !== "object") { if (/checksum|sha256/i.test(key) && typeof value === "string") checksumValues.push(value.toLowerCase()); return; }
            for (const [childKey, child] of Object.entries(value)) scanStrings(child, childKey);
          };
          if (detail.status === 200) scanStrings(metadata);
          const localHash = (await import("node:crypto")).createHash("sha256").update(csv).digest("hex");
          if (!checksumValues.includes(localHash)) throw new Error("uploaded_bytes_checksum_not_verifiable_from_authorized_file_read");
          result = { intakeFileId: state.ids.intakeFileId, P1Stages: "complete", uploadedBytesSha256Matched: true };
        } else if (index === 2) {
          const pipeline = await browser.probe(pipelinePath);
          const file = (dataOf(pipeline)?.files || []).find((entry) => entry.intakeFileId === state.ids.intakeFileId);
          if (pipeline.status !== 200 || !allPipelineStagesComplete(file, ["sensitivity_review", "source_review"])) throw new Error(`sensitivity_or_source_promotion_not_verified:${apiCode(pipeline)}`);
          const basisResponse = await browser.probe(measurementPath(state.ids.sourceVersionId));
          const basis = dataOf(basisResponse)?.basis;
          if (basisResponse.status !== 200 || basis?.measurable !== true || basis.data_record_count !== 6 || basis.blank_record_count !== 1 || basis.duplicate_record_count !== 2 || basis.counted_record_count !== 5 || dataOf(basisResponse)?.sourceVersion?.is_current !== true) throw new Error(`source_version_or_profile_counts_not_current:${apiCode(basisResponse)}`);
          result = { sourceVersionId: state.ids.sourceVersionId, current: true, profileCounts: { total: 6, blank: 1, duplicatesIncluded: 2, counted: 5 } };
        } else if (index === 3) {
          const measurementResponse = await browser.probe(measurementPath(state.ids.sourceVersionId));
          const recorded = dataOf(measurementResponse)?.recorded;
          const measurement = recorded?.measurement;
          const definition = recorded?.definition;
          const claim = recorded?.claim;
          if (measurementResponse.status !== 200 || Number(measurement?.measured_value) !== 5 || Number(measurement?.total_record_count) !== 6 || Number(measurement?.blank_record_count) !== 1 || Number(measurement?.duplicate_record_count) !== 2 || !measurement?.evidence_item_id || definition?.period_start !== state.attestedPeriod?.start || definition?.period_end !== state.attestedPeriod?.end || definition?.counted_unit !== "programme session" || definition?.definition_text !== "Each row records one delivered programme session." || definition?.inclusion_rule !== "Every data row after the header row that has at least one value." || definition?.exclusion_rule !== "The header row and empty rows." || !/(?:5|five) programme sessions?/i.test(String(claim?.statement || "")) || !claim?.claim_id) throw new Error(`measurement_definition_or_claim_not_verified:${apiCode(measurementResponse)}`);
          state.ids.evidenceId = measurement.evidence_item_id;
          state.ids.claimId = claim.claim_id;
          result = { measurement: 5, totalRows: 6, blankRows: 1, duplicateRowsIncluded: 2, evidenceLinked: true, claimLinked: true, countedUnit: definition.counted_unit, metricMeaning: "source records; each row human-defined as one programme session", period: [definition.period_start, definition.period_end], periodHumanAttested: state.attestedPeriod.attestedByOperator };
        } else if (index === 4) {
          if (!(await claimIsImpactFact())) throw new Error("internal_eligibility_blocked: the measured claim is not eligible for internal use; the canary bypasses nothing");
          result = { internalEligibility: "eligible_without_review", source: "impact_facts" };
        } else if (index === 5) {
          const draftResponse = await browser.probe(draftPath(state.ids.draftId));
          const draft = dataOf(draftResponse);
          const generated = (draft?.blocks || []).map((block) => block.text || "").join("\n");
          const citedClaimIds = new Set((draft?.blocks || []).flatMap((block) => block.supportingClaimIds || []));
          if (draftResponse.status !== 200 || draft.contentType !== "evidence_summary" || draft.audience !== "internal" || draft.citedClaimsCurrentlyEligible !== true || citedClaimIds.size !== 1 || !citedClaimIds.has(state.ids.claimId) || !/(?:5|five)\s+(?:nonblank\s+)?(?:source records?|programme sessions?)/i.test(generated) || !/source records?/i.test(generated) || !generated.includes(state.attestedPeriod?.start) || !generated.includes(state.attestedPeriod?.end) || /\b(?:participants?|outcomes?|attendance rates?|percentages?|caused|resulted in|led to|impact)\b/i.test(generated) || draft.internalReport?.available !== true) throw new Error(`live_internal_draft_or_citations_not_verified:${apiCode(draftResponse)}`);
          result = { draftId: state.ids.draftId, contentType: draft.contentType, audience: draft.audience, eligibleClaimCited: true, providerMetadata: "NOT_EXPOSED_BY_CUSTOMER_READ" };
        } else if (index === 6) {
          const markdownResponse = await browser.probeText(`${draftPath(state.ids.draftId)}/markdown`);
          if (markdownResponse.status !== 200) {
            let errorCode;
            try { errorCode = JSON.parse(markdownResponse.text)?.error?.code; } catch {}
            throw new Error(`authorized_markdown_download_failed:${errorCode || `http_${markdownResponse.status}`}`);
          }
          if (!/attachment/i.test(markdownResponse.disposition || "")) throw new Error("authorized_markdown_download_missing_attachment_disposition");
          const validation = validateMarkdown(markdownResponse.text, { periodStart: state.attestedPeriod?.start, periodEnd: state.attestedPeriod?.end, sourceVersionId: state.ids.sourceVersionId, claimId: state.ids.claimId, evidenceId: state.ids.evidenceId });
          if (!validation.ok) throw new Error(`downloaded_markdown_assertions_failed:${Object.entries(validation.checks).filter(([, ok]) => !ok).map(([key]) => key).join(",")}`);
          const reportDirectory = join(STATE_ROOT, "reports");
          await mkdir(reportDirectory, { recursive: true, mode: 0o700 });
          state.reportPath = join(reportDirectory, `${state.canaryId}.md`);
          if (existsSync(state.reportPath)) {
            if (await readFile(state.reportPath, "utf8") !== markdownResponse.text) throw new Error("existing_verified_report_differs_from_current_authorized_receipt");
          } else await writeFile(state.reportPath, markdownResponse.text, { mode: 0o600, flag: "wx" });
          result = { markdownDownload: "authorized_attachment", contentAssertions: "PASS", savedTo: `.kai-production-canary/runs/reports/${state.canaryId}.md` };
        }
      }

      state.stages.push({ stage: stageId, status: "PASS", evidenceClass: "TOOL_VERIFIED", verifiedAt: new Date().toISOString(), ...result });
      state.stageIndex += 1;
      state.pendingHumanAction = false;
      state.lastFailure = null;
      state.roleRequired = stageRole(Math.min(state.stageIndex, STAGES.length - 1));
      await saveState(state);
      console.log(`${stageId}: PASS ${JSON.stringify(result)}`);
      if (index === 6) {
        console.log(`CANARY PASS: ${state.canaryId}; report retrieved through the authorized internal report route. Provider identity is not exposed by the client read and remains NOT_CONFIRMED.`);
        return;
      }
    }
  } catch (error) {
    if (state?.stageIndex !== undefined) {
      state.lastFailure = { stage: stageName(state.stageIndex), status: "BLOCKED", failureKind: failureKind(String(error.message)), evidenceClass: "NOT_CONFIRMED", blocker: String(error.message).slice(0, 180), updatedAt: new Date().toISOString() };
      await saveState(state);
    }
    console.log(`BLOCKED at ${state ? stageName(state.stageIndex) : "preflight"}: ${String(error.message).slice(0, 240)}. State contains IDs/statuses only; no action will be replayed automatically.`);
    process.exitCode = 2;
  } finally {
    rl.close();
    if (browser) await browser.close();
  }
}

export async function launchBrowserHarnessForTest() {
  const browser = await launchChrome(new URL("about:blank"), { headless: true });
  const userAgent = await browser.evaluate("navigator.userAgent");
  await browser.close();
  return userAgent;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await interactive(parseArgs(process.argv.slice(2))); }
  catch (error) { console.error(`BLOCKED: ${error.message}`); process.exitCode = 2; }
}
