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
export const SYNTHETIC_CSV_PATH = join(ROOT, "scripts", "fixtures", "kai-plan-a-production-synthetic-records.csv");

export const STAGES = [
  ["workspace", "Authenticate as the customer administrator; select the existing synthetic organization and engagement."],
  ["upload_processing", "In the customer Files UI, upload the supplied synthetic CSV. Wait for the deployed scan and P1 processing to finish."],
  ["sensitivity_source", "In Data Sources, inspect the source and record the human sensitivity, allowed-use, AI-use, and promotion decisions."],
  ["measurement", "Use Count records and attest the human-defined unit and reporting period; record the measurement through the UI."],
  ["gk_review", "Switch to the separately authorized GK reviewer account. Review evidence, claim, and all applicable coverage dimensions."],
  ["generation", "Return to the customer administrator and generate an internal Evidence Summary using the live application."],
  ["factual_review", "Inspect the generated text, citations, and limitations; approve factual content only if accurate."],
  ["release", "Use Release internal report and separately confirm the limitations as the customer administrator."],
  ["download_validation", "Open the customer receipt and download the actual Markdown report to the path supplied at start."]
];

export const MEASURED_LIMITATION_CODES = [
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
const REQUIRED_LIMITATION_WORDING = [
  /conflicting source indicators[^\n]*(accepted|limitation)/i,
  /duplicates?[^\n]*(risk flagged|limitation)/i,
  /missingness[^\n]*(risk flagged|limitation)/i,
  /requirement alignment[^\n]*(accepted|limitation)/i,
  /small.cell risk[^\n]*(accepted|limitation)/i,
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

export function validateMarkdown(markdown, { periodStart, periodEnd, sourceVersionId, claimId, evidenceId } = {}) {
  const content = String(markdown || "");
  const checks = {
    countFive: /(?:5|five)\s+(?:nonblank\s+)?source records?/i.test(content),
    blankExcluded: /blank record[^\n]*(excluded|exclude)/i.test(content),
    duplicatesIncluded: /duplicate[^\n]*(included|include)/i.test(content),
    sourceRecordUnit: /source records?/i.test(content),
    attestedPeriod: Boolean(periodStart && periodEnd && content.includes(periodStart) && content.includes(periodEnd)),
    sourceVersionCitation: Boolean(sourceVersionId && content.includes(sourceVersionId)),
    claimCitation: Boolean(claimId && content.includes(claimId)),
    evidenceCitation: Boolean(evidenceId && content.includes(evidenceId)),
    noRawCsvRows: !/^\d{4}-\d{2}-\d{2},[^\n]*$/m.test(content),
    unsupportedClaimsAbsent: !/\b(?:participants?|outcomes?|attendance rates?|percentages?|caused|resulted in|led to|impact)\b/i.test(content),
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
      if (!path.startsWith("/api/kai/sprint2/intake/")) throw new Error("Only the known KAI application API prefix is allowed");
      return evaluate(`(async()=>{const r=await fetch(${JSON.stringify(path)},{credentials:'same-origin',headers:{Accept:'application/json'}});let j=null;try{j=await r.json()}catch{};return {status:r.status,body:j}})()`);
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

async function interactive(args) {
  const mode = args.mode;
  if (!new Set(["preflight", "execute", "resume"]).has(mode)) throw new Error("Use --mode preflight, execute, or resume");
  if (mode !== "preflight" && args["owner-authorized"] !== true) throw new Error("Execution requires explicit --owner-authorized attestation of separate prior owner authorization");
  const target = safeTarget(args.url);
  const csv = readFileSync(SYNTHETIC_CSV_PATH, "utf8");
  const counts = countCsvRecords(csv);
  const expected = { totalDataRows: 6, blankDataRows: 1, countedRecords: 5, duplicateNonblankRowsIncluded: 2 };
  if (JSON.stringify(counts) !== JSON.stringify(expected)) throw new Error(`Synthetic fixture count mismatch: ${JSON.stringify(counts)}`);

  let state;
  if (mode === "resume") {
    if (!args["run-id"]) throw new Error("Resume requires --run-id");
    state = await readState(args["run-id"]);
    if (state.origin !== target.origin) throw new Error("Run URL origin does not match the saved correlation state");
  } else if (mode === "execute") {
    state = {
      runId: randomUUID(), origin: target.origin, canaryId: `KAI-SYNTH-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`,
      createdAt: new Date().toISOString(), organizationId: args["organization-id"] || null, engagementId: args["engagement-id"] || null,
      stages: Object.fromEntries(STAGES.map(([id]) => [id, { status: "NOT_STARTED" }]))
    };
    if (!state.organizationId || !state.engagementId) throw new Error("Execute requires existing --organization-id and --engagement-id; this runner never creates tenancy");
    await saveState(state);
  }

  const rl = createInterface({ input: stdin, output: stdout });
  let browser;
  try {
    browser = await launchChrome(new URL("/login", target).href);
    console.log(`Chrome opened at ${new URL("/login", target).href}. Sign in through the app UI; do not enter credentials in this terminal.`);
    await promptLine(rl, "Authenticate in the visible Chrome window as the currently required authorized human. For the GK review step, close this run and resume with the separately authorized GK reviewer account.");
    const session = await browser.probe("/admin/organizations");
    const sessionResult = cleanResult(session);
    console.log(`Authenticated organization-list probe: ${JSON.stringify(sessionResult)}`);
    if (sessionResult.status !== 200) {
      console.log(`BLOCKED: authorized application organization read returned HTTP ${sessionResult.status}${sessionResult.code ? ` (${sessionResult.code})` : ""}. No workflow operation was issued.`);
      process.exitCode = 2;
      return;
    }
    if (mode === "preflight") {
      const capabilities = await browser.probe(`/admin/organizations/${encodeURIComponent(args["organization-id"] || "00000000-0000-0000-0000-000000000000")}/access-capabilities`);
      console.log(`Selected-organization capability probe: ${JSON.stringify(cleanResult(capabilities))}`);
      console.log(`Browser: Chrome DevTools Protocol launched successfully; fixture: ${JSON.stringify(counts)}; API result bodies and identity details were not logged.`);
      console.log("Preflight does not establish live storage, scanner, worker, model provider, feature-flag, or synthetic-workspace readiness unless the authorized application response explicitly exposes it.");
      return;
    }

    console.log(`run_id=${state.runId} canary_id=${state.canaryId}`);
    console.log(`State file: .kai-production-canary/runs/${state.runId}.json`);
    const unconfirmed = Object.entries(state.stages).find(([, stage]) => ["NOT_CONFIRMED", "WAITING_FOR_HUMAN"].includes(stage.status));
    if (unconfirmed) {
      console.log(`BLOCKED: saved stage ${unconfirmed[0]} is ${unconfirmed[1].status}; stage-specific authoritative readback is unavailable. Resume will not repeat or skip an upload, measurement, review, generation, or release.`);
      process.exitCode = 2;
      return;
    }
    const start = Math.max(0, STAGES.findIndex(([id]) => state.stages[id]?.status !== "PASS"));
    for (let index = start; index < STAGES.length; index += 1) {
      const [stageId, instruction] = STAGES[index];
      const current = state.stages[stageId]?.status;
      if (current === "PASS") continue;
      if (stageId === "gk_review") {
        console.log("WAITING_FOR_HUMAN: GK review needs a separate authorized reviewer identity. Close this session and resume using that account; customer session is not reused as GK.");
        state.stages[stageId] = { status: "WAITING_FOR_HUMAN", updatedAt: new Date().toISOString() };
        await saveState(state);
        return;
      }
      console.log(`\nSTAGE ${index + 1}/${STAGES.length}: ${stageId}\n${instruction}`);
      console.log("Use only the existing application UI. This runner does not issue uploads, approvals, measurements, generation, or releases.");
      await promptLine(rl, instruction);
      const verification = stageId === "workspace"
        ? await browser.probe(`/admin/organizations/${encodeURIComponent(state.organizationId)}/access-capabilities`)
        : null;
      const verified = verification ? cleanResult(verification) : null;
      if (verified && verified.status !== 200) {
        state.stages[stageId] = { status: verified.status === 401 ? "BLOCKED" : "FAIL", code: verified.code || `http_${verified.status}`, updatedAt: new Date().toISOString() };
        await saveState(state);
        console.log(`Stage ${stageId}: ${state.stages[stageId].status}; verification=${JSON.stringify(verified)}`);
        process.exitCode = 2;
        return;
      }
      state.stages[stageId] = { status: "NOT_CONFIRMED", ...(verified ? { verification: verified } : {}), updatedAt: new Date().toISOString() };
      await saveState(state);
      console.log(`Stage ${stageId}: NOT_CONFIRMED. Human checkpoint acknowledged; authoritative stage-specific verification is not implemented for this operation.`);
      console.log(`Resume command: DATABASE_URL=${SENTINEL_DATABASE_URL} node scripts/kai-sprint2-plan-a-production-synthetic-canary.js --mode resume --owner-authorized --url ${target.origin} --run-id ${state.runId}`);
      return;
    }
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
