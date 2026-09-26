import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Browser acceptance of reviewed evidence -> P2-02 assessment -> P2-03
 * proposed claim, run only by
 *   node scripts/kai-client-knowledge-studio-browser-acceptance-local-postgres.js \
 *     __tests__/kai-reviewed-evidence-claim-proposal-browser-acceptance.integration.spec.js
 * against that runner's ephemeral loopback PostgreSQL. Skipped otherwise.
 *
 * Real: every KAI router/service/read model on the runner cluster,
 * resolveKaiActorContext with real memberships and global roles, the built
 * frontend bundle, a real headless Chrome over the DevTools protocol with one
 * isolated browser context (and harness cookie) per actor, the P1-06 review
 * work, the cockpit sensitivity decision and its P1-07 handoff, the
 * browser-driven P1-08 promotion and its server-side P2-01 handoff, the
 * browser-driven P2-12 decisions through the existing route, and the
 * server-side P2-02/P2-03 continuation that route now composes.
 * Simulated: the Get Kinder session login (req.user from a harness cookie),
 * the runner's synthetic kai.intake_batches / kai.intake_files mirrors, and
 * the P1-03..P1-05 rows of the fresh synthetic files (the P1 worker's output).
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

test("reviewed-evidence claim proposal browser acceptance isolation: a non-loopback runner URL is refused", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
});

if (!RUNNER_DATABASE_URL || !CHROME || !WORKDIR) {
  test("reviewed-evidence claim proposal browser acceptance requires its runner", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_DATABASE_URL);
  await runBrowserAcceptance();
}

// ---------------------------------------------------------------------------
// Minimal Chrome DevTools protocol client (Node's built-in WebSocket), the
// same shape as the other Knowledge Studio acceptance specs.
// ---------------------------------------------------------------------------

async function launchChrome() {
  const profileDir = join(WORKDIR, "chrome-profile-reviewed-evidence-claim-proposal");
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
  // An isolated browser context per actor: the harness login cookie is
  // per-context, so two actors never share a session.
  const { browserContextId } = await browser.send("Target.createBrowserContext", { disposeOnDetach: true });
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const requests = [];
  const byId = new Map();
  const exceptions = [];
  const listener = (message) => {
    if (message.sessionId !== sessionId) return;
    const { method, params } = message;
    if (method === "Network.requestWillBeSent" && params.type !== "Document" && params.request.url.includes("/api/")) {
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
  // Sets a <select> nested in the <label> whose text starts with labelText,
  // through React's value setter so its onChange runs.
  const selectByLabel = async (labelText, value) => {
    const ok = await evaluate(`(() => {
      const label = [...document.querySelectorAll("label")].find((el) => el.innerText.trim().startsWith(${JSON.stringify(labelText)}));
      const el = label && label.querySelector("select");
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return el.value === ${JSON.stringify(value)};
    })()`);
    assert.ok(ok, `select ${labelText} = ${value}`);
  };
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
    selectByLabel,
    selectProject,
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

async function runBrowserAcceptance() {
  const { Pool } = await import("pg");
  const express = (await import("express")).default;
  const seedPool = new Pool({ connectionString: RUNNER_DATABASE_URL, ssl: false, max: 4 });
  const { findOrCreateKaiUserByLegacyPublicUserdataId } = await import("../Backend/kai/db/kaiQueries.js");
  const { ensureSensitivityReviewQueueItem } = await import("../Backend/kai/services/kaiReviewQueueService.js");
  const { submitSensitivityProfileDecision } = await import("../Backend/kai/services/kaiReviewCockpitService.js");
  const sprint2IntakeApiRouter = (await import("../Backend/kai/routes/sprint2IntakeApi.js")).default;
  const kaiAccessAdministrationApiRouter = (await import("../Backend/kai/routes/kaiAccessAdministrationApi.js")).default;
  const { requireKaiSprint2Enabled } = await import("../Backend/kai/config/kaiSprint2Config.js");
  const { requireKaiSprint2Authenticated } = await import("../Backend/kai/middleware/kaiSprint2Authentication.js");
  const query = async (sql, params = []) => (await seedPool.query(sql, params)).rows;
  const ENV = { KAI_SPRINT2_ENABLED: "true" };
  const noAudit = () => ({ prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } });

  const ORG = "00000000-0000-4000-8000-000000000001";
  const ORG_B = "00000000-0000-4000-8000-0000000000e9";
  const PROJECT = "7e000000-0000-4000-8000-0000000000e7";
  const PROJECT_B = "7e000000-0000-4000-8000-0000000000e8";
  const BATCH = "1e000000-0000-4000-8000-0000000000e7";
  const BATCH_B = "1e000000-0000-4000-8000-0000000000e8";
  const FILE = "2e000000-0000-4000-8000-0000000000e7";
  const FILE_B = "2e000000-0000-4000-8000-0000000000e8";
  const FILE_NAME = "reviewed-claim-households.csv";
  const FILE_B_NAME = "reviewed-claim-project-b.csv";
  const FIELD_KEYS = ["households_served", "programme_month"];
  const USERS = Object.freeze({ gkReviewer: 981, clientAdmin: 982, gkOperator: 983 });

  await query(`INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES
                 ($1::uuid, 'Harbourline Synthetic Society', 'harbourline-synthetic'),
                 ($2::uuid, 'Second Synthetic Collective', 'second-synthetic-browser')
               ON CONFLICT (organization_id) DO NOTHING`, [ORG, ORG_B]);
  for (const [engagementId, batchId, code] of [[PROJECT, BATCH, "Project Claim Proposal"], [PROJECT_B, BATCH_B, "Project B Untouched"]]) {
    await query("INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code, project_metadata) VALUES ($1::uuid, $2::uuid, $3, '{}'::jsonb)",
      [engagementId, ORG, code]);
    await query(`INSERT INTO kai.intake_batches (intake_batch_id, organization_id, engagement_id, batch_code, processing_status, review_status)
                 VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'received', 'not_reviewed')`, [batchId, ORG, engagementId, `batch-${code}`]);
  }
  const kaiUserIds = {};
  for (const [legacyId, role, global, organizations] of [
    [USERS.gkReviewer, "gk_reviewer", true, [ORG, ORG_B]],
    [USERS.clientAdmin, "client_admin", false, [ORG]],
    [USERS.gkOperator, "gk_operator", true, [ORG]],
  ]) {
    await query("INSERT INTO public.userdata (id) VALUES ($1) ON CONFLICT DO NOTHING", [legacyId]);
    const kaiUser = await findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: legacyId, email: `user${legacyId}@harbourline.test` });
    kaiUserIds[role] = kaiUser.user_id;
    for (const organizationId of organizations) {
      await query("INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status) VALUES ($1::uuid, $2::uuid, $3, 'active')",
        [organizationId, kaiUser.user_id, role]);
    }
    if (global) {
      await query("INSERT INTO kai.user_roles (user_id, role_id) SELECT $1::uuid, role_id FROM kai.roles WHERE role_name = $2", [kaiUser.user_id, role]);
    }
  }
  const gkReviewerService = {
    actorType: "human",
    actorUserId: kaiUserIds.gk_reviewer,
    source: "public.userdata",
    kaiRoles: ["gk_reviewer"],
    platformSuperuser: false,
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" }],
  };

  /** P1-03..P1-05 rows of one fresh confirmed Project file (the P1 worker's output). */
  async function seedFreshFile(intakeFileId, name, checksumChar, { engagementId = PROJECT, batchId = BATCH, fieldKeys = FIELD_KEYS } = {}) {
    const checksum = checksumChar.repeat(64);
    await query(
      `INSERT INTO kai.intake_files (intake_file_id, intake_batch_id, organization_id, engagement_id, original_filename, safe_filename,
         checksum, hash_algorithm, upload_state, object_version_id, verified_checksum, verified_size_bytes, verified_at,
         mime_type, file_size_bytes, malware_scan_status, review_status, file_policy_status, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $5, $6, 'sha256', 'confirmed', 'synthetic-v1', $6, 512, now(),
         'text/csv', 512, 'clean', 'not_reviewed', 'passed', now())`,
      [intakeFileId, batchId, ORG, engagementId, name, checksum],
    );
    const [run] = await query(
      `INSERT INTO kai.intake_parser_runs (organization_id, intake_file_id, parser_name, parser_version, checksum, parser_status, started_at)
       VALUES ($1::uuid, $2::uuid, 'kai_local_profiling_kernel', '1.0.0', $3, 'running', now()) RETURNING parser_run_id::text`,
      [ORG, intakeFileId, checksum],
    );
    const profile = {
      status: "profiled", format: "csv",
      counts: { row_count: 1, column_count: fieldKeys.length, field_count: fieldKeys.length },
      fields: fieldKeys.map((key) => ({ field_key: key })),
    };
    const [fileProfile] = await query(
      `INSERT INTO kai.intake_file_profiles (organization_id, intake_file_id, parser_run_id, parser_name, parser_version, checksum, profile, profile_canonical_sha256)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'kai_local_profiling_kernel', '1.0.0', $4, $5::jsonb, encode(digest($5::jsonb::text, 'sha256'), 'hex'))
       RETURNING file_profile_id::text, profile_canonical_sha256`,
      [ORG, intakeFileId, run.parser_run_id, checksum, JSON.stringify(profile)],
    );
    await query("UPDATE kai.intake_parser_runs SET parser_status = 'completed', completed_at = now(), output_profile_id = $2::uuid WHERE parser_run_id = $1::uuid",
      [run.parser_run_id, fileProfile.file_profile_id]);
    const [dictionary] = await query(
      `INSERT INTO kai.data_dictionaries (organization_id, intake_file_id, file_profile_id, profile_canonical_sha256)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4) RETURNING data_dictionary_id::text`,
      [ORG, intakeFileId, fileProfile.file_profile_id, fileProfile.profile_canonical_sha256],
    );
    for (const key of fieldKeys) {
      await query(
        `INSERT INTO kai.data_dictionary_fields (data_dictionary_id, organization_id, file_profile_id, profile_field_key, field_label_safe, data_type)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $4, 'number')`,
        [dictionary.data_dictionary_id, ORG, fileProfile.file_profile_id, key],
      );
    }
    const [sensitivity] = await query(
      `INSERT INTO kai.intake_sensitivity_profiles (organization_id, intake_file_id, file_profile_id, data_dictionary_id, profile_canonical_sha256)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5) RETURNING intake_sensitivity_profile_id::text`,
      [ORG, intakeFileId, fileProfile.file_profile_id, dictionary.data_dictionary_id, fileProfile.profile_canonical_sha256],
    );
    return sensitivity.intake_sensitivity_profile_id;
  }

  /** Real P1-06 work, then the real cockpit 'reviewed' decision and its P1-07 handoff. */
  async function reachReviewableSourceCandidate(intakeSensitivityProfileId) {
    const ensured = await ensureSensitivityReviewQueueItem(
      { organizationId: ORG, intakeSensitivityProfileId, actorContext: gkReviewerService, now: new Date().toISOString() },
      { env: ENV, metadataOnlyAudit: noAudit() },
    );
    assert.equal(ensured.ok, true, JSON.stringify(ensured));
    const [item] = await query("SELECT updated_at FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid",
      [ensured.data.reviewQueueItem.review_queue_item_id]);
    const decided = await submitSensitivityProfileDecision({
      organizationId: ORG,
      intakeSensitivityProfileId,
      actorContext: gkReviewerService,
      payload: {
        expected_updated_at: new Date(item.updated_at).toISOString(),
        review_queue_item_id: ensured.data.reviewQueueItem.review_queue_item_id,
        decision: "reviewed",
        reviewed_snapshot: {
          reviewed_personal_data_status: "present",
          reviewed_minor_data_status: "absent",
          reviewed_health_housing_justice_immigration_status: "absent",
          reviewed_indigenous_governance_status: "unknown",
          reviewed_staff_notes_status: "absent",
          reviewed_story_testimonial_status: "absent",
          reviewed_small_cell_risk_status: "unknown",
          reviewed_financial_records_status: "absent",
          reviewed_consent_basis_status: "unknown",
          reviewed_allowed_use_status: "unknown",
          reviewed_llm_processing_allowed: false,
          reviewed_product_learning_allowed: false,
          reviewed_public_use_allowed: false,
          reviewed_funder_use_allowed: false,
        },
      },
    }, { env: ENV });
    assert.equal(decided.ok, true, JSON.stringify(decided));
    assert.equal(decided.data.source_candidate_handoff.status, "created");
    return decided.data.source_candidate_handoff.intake_source_candidate_id;
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
  // The same root element and bootstrap call as views/kai-review-cockpit.ejs.
  app.get("/gk-admin/kai-review-cockpit", (_req, res) => res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><title>KAI Review Cockpit</title>
    <link rel="stylesheet" href="/css/style.css" /></head>
    <body><div id="kai-review-cockpit-root"></div><script src="/js/bundles/entry.js"></script>
    <script>window.renderKaiReviewCockpit("#kai-review-cockpit-root");</script></body></html>`));
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

  const decisionPath = (candidateId) => `/api/kai/sprint2/intake/admin/review-cockpit/source-candidates/${candidateId}/decision`;
  const isExtractionRequest = (r) => /\/evidence-extraction(\?|$)/.test(new URL(r.url).pathname);

  // Client boundary (the evidence-pipeline acceptance's list).
  const ALLOWED_PATHS = new Set(["/api/kai/sprint2/intake/admin/review-cockpit/capabilities"]);
  const GK_ONLY_FRAGMENTS = ["/review-cockpit", "/evidence-library", "/claim-library", "/eligible-claims", "/traceability",
    "/review-queue", "/sources", "/client-followups", "/evidence-items", "/source-versions", "/data-dictionaries"];
  const GK_CONTROLS = ["Record decision", "Promote", "Approve", "Reject", "Extract evidence", "Retry evidence extraction", "Propose claim",
    "Sensitivity & allowed-use review", "Review cockpit"];
  function assertClientBoundary(page, label, body) {
    for (const r of page.requests()) {
      const path = new URL(r.url).pathname;
      if (ALLOWED_PATHS.has(path)) continue;
      for (const fragment of GK_ONLY_FRAGMENTS) assert.ok(!path.includes(fragment), `${label}: GK-only request ${r.method} ${path}`);
    }
    for (const control of GK_CONTROLS) assert.ok(!body.includes(control), `${label}: GK control visible: ${control}`);
  }

  /** Drives the GK cockpit to the open source-candidate item and promotes it. */
  async function promoteThroughCockpit(page, candidateId) {
    await page.goto("/gk-admin/kai-review-cockpit");
    await page.waitForText("KAI internal review cockpit");
    // This reviewer belongs to two organizations, so the cockpit asks for one.
    await page.waitForText(ORG_B);
    await page.selectByLabel("Organization", ORG);
    await page.waitFor(async () => page.evaluate(`(() => {
      const button = [...document.querySelectorAll("button")].find((el) => el.innerText.trim() === "Load queue");
      return Boolean(button && !button.disabled);
    })()`), "Load queue enabled (organization bootstrapped)");
    await page.selectByLabel("Queue type", "source_candidate_review");
    await page.selectByLabel("Queue status", "open");
    await page.clickButton("Load queue");
    await page.waitForText("source_candidate_review");
    await page.idle();
    // Queue rows carry no target id; open each open item until the detail is
    // the fresh candidate's.
    const openRows = await page.evaluate(`[...document.querySelectorAll(".kai-cockpit-queue tbody tr")].length`);
    let found = false;
    for (let row = 0; row < openRows && !found; row += 1) {
      await page.evaluate(`document.querySelectorAll(".kai-cockpit-queue tbody tr")[${row}].querySelector("button").click()`);
      await page.idle();
      found = (await page.text()).includes(candidateId);
    }
    assert.ok(found, `the fresh candidate is in the open source_candidate_review queue (${openRows} open)`);
    await page.selectByLabel("Decision outcome", "promoted");
    await page.selectByLabel("Reviewed source type", "organization_primary_record");
    const mark = page.mark();
    await page.clickButton("Promote");
    await page.waitForText("Recorded promoted.");
    await page.idle();
    return page.requestsSince(mark);
  }

  async function governedCounts() {
    const [row] = await query(`SELECT
      (SELECT count(*) FROM kai.evidence_items)::int AS evidence,
      (SELECT count(*) FROM kai.review_queue_items)::int AS queue_items,
      (SELECT count(*) FROM kai.review_queue_items WHERE queue_type = 'evidence_review')::int AS evidence_queue,
      (SELECT count(*) FROM kai.evidence_review_decisions)::int AS evidence_decisions,
      (SELECT count(*) FROM kai.claims)::int AS claims,
      (SELECT count(*) FROM kai.claim_evidence_links)::int AS claim_links,
      (SELECT count(*) FROM kai.review_queue_items WHERE queue_type = 'claim_review')::int AS claim_queue,
      (SELECT count(*) FROM kai.claim_review_decisions)::int AS claim_decisions`);
    return row;
  }
  const diff = (before, after) => Object.fromEntries(Object.keys(after).map((key) => [key, after[key] - before[key]]));
  async function evidenceRows(intakeFileId = FILE) {
    return query(
      `SELECT e.evidence_item_id::text, e.statement, e.evidence_review_status, e.support_strength, e.internal_only,
              e.public_use_allowed, e.funder_use_allowed, e.llm_processing_allowed,
              q.review_queue_item_id::text, q.queue_status, q.review_status
         FROM kai.evidence_items e
         JOIN kai.source_versions v ON v.organization_id = e.organization_id AND v.source_version_id = e.source_version_id
         JOIN kai.intake_source_candidates c ON c.organization_id = v.organization_id AND c.intake_source_candidate_id = v.intake_source_candidate_id
         JOIN kai.review_queue_items q ON q.organization_id = e.organization_id AND q.queue_type = 'evidence_review'
          AND q.target_object_type = 'evidence_item' AND q.target_object_id = e.evidence_item_id
        WHERE e.organization_id = $1::uuid AND c.intake_file_id = $2::uuid ORDER BY e.statement`, [ORG, intakeFileId]);
  }

  const GK_REVIEW_CONTROLS = ["Review evidence", "Record Evidence Review Decision"];
  const reviewPath = (evidenceItemId, reviewQueueItemId) =>
    `/api/kai/sprint2/intake/admin/organizations/${ORG}/evidence-items/${evidenceItemId}/evidence-review/${reviewQueueItemId}/complete`;
  const evidenceLibraryPath = (organizationId) => `/api/kai/sprint2/intake/admin/organizations/${organizationId}/evidence-library/candidates`;
  const isEvidenceReviewPost = (r) => r.method === "POST" && /\/evidence-review\/[^/]+\/complete$/.test(new URL(r.url).pathname);

  async function openGkEvidenceTab(page) {
    await page.goto("/impact-library");
    await page.waitForText("Knowledge Studio");
    await page.clickNav("Knowledge Studio");
    await page.waitFor(async () => page.evaluate(`Boolean(document.querySelector(".nav-tabs"))`), "Knowledge Studio tabs");
    await page.clickTab("Evidence");
    await page.idle();
  }
  /** innerText of the Evidence list item whose statement is `statement`. */
  const evidenceItemText = (page, statement) => page.evaluate(`(() => {
    const li = [...document.querySelectorAll("li.list-group-item")].find((el) => el.innerText.includes(${JSON.stringify(statement)}));
    return li ? li.innerText : null;
  })()`);
  const clickInEvidenceItem = (page, statement, label) => page.evaluate(`(() => {
    const li = [...document.querySelectorAll("li.list-group-item")].find((el) => el.innerText.includes(${JSON.stringify(statement)}));
    const button = li && [...li.querySelectorAll("button")].find((el) => el.innerText.trim() === ${JSON.stringify(label)} && !el.disabled);
    if (!button) return false;
    button.click();
    return true;
  })()`);
  async function recordDecision(page, statement, decision) {
    assert.ok(await clickInEvidenceItem(page, statement, "Review evidence"), `Review evidence offered for ${statement}`);
    await page.waitFor(async () => page.evaluate(`Boolean(document.querySelector('[aria-label="Evidence review"]'))`), "review panel");
    assert.ok(await page.evaluate(`(() => { const el = document.getElementById("evidence-library-review-decision-${decision}"); if (!el) return false; el.click(); return el.checked; })()`),
      `select ${decision}`);
    const mark = page.mark();
    assert.ok(await clickInEvidenceItem(page, statement, "Record Evidence Review Decision"), "record control enabled");
    await page.waitForText(`Evidence review decision recorded: ${decision}.`);
    await page.idle();
    return page.requestsSince(mark);
  }
  const { submitSourceCandidateDecision } = await import("../Backend/kai/services/kaiReviewCockpitService.js");
  const claimProposalPathFor = (evidenceItemId) => `/api/kai/sprint2/intake/admin/organizations/${ORG}/evidence-items/${evidenceItemId}/claim-proposal`;
  const isHiddenProposalRequest = (r) => /\/claim-proposal$|\/evidence-coverage-assessment$/.test(new URL(r.url).pathname);
  const claimLibraryPath = (organizationId) => `/api/kai/sprint2/intake/admin/organizations/${organizationId}/claim-library/candidates`;
  const claimsCardText = (page) => page.evaluate(`(() => {
    const heading = [...document.querySelectorAll("h5")].find((el) => el.innerText.trim() === "Claims");
    const card = heading && heading.closest(".admin-card");
    return card ? card.innerText : null;
  })()`);
  async function claimRows() {
    return query(
      `SELECT c.claim_id::text, c.evidence_item_id::text, c.claim_type, c.claim_status, c.claim_review_status, c.claim_strength,
              c.statement, c.internal_only, c.public_use_allowed, c.funder_use_allowed, c.llm_processing_allowed,
              c.product_learning_allowed, c.export_ready, c.created_by::text, c.created_by_type,
              q.review_queue_item_id::text AS claim_queue_id, q.queue_status, q.review_status
         FROM kai.claims c
         JOIN kai.review_queue_items q ON q.organization_id = c.organization_id AND q.queue_type = 'claim_review'
          AND q.target_object_type = 'claim' AND q.target_object_id = c.claim_id
        ORDER BY c.claim_id`);
  }

  const gkPage = await openPage(browser, { baseUrl, legacyUserId: USERS.gkReviewer });
  const clientPage = await openPage(browser, { baseUrl, legacyUserId: USERS.clientAdmin });
  const operatorPage = await openPage(browser, { baseUrl, legacyUserId: USERS.gkOperator });
  const results = {};
  let evidence;
  let supportedItem;
  let unsupportedItem;
  let proposed;
  let projectBEvidence;
  try {
    const profile = await seedFreshFile(FILE, FILE_NAME, "a");
    const candidate = await reachReviewableSourceCandidate(profile);
    // Project B: a second Project in the same organization whose evidence is
    // created through the same real services and never reviewed here.
    const candidateB = await reachReviewableSourceCandidate(
      // Distinct fields, so its evidence statements never collide with Project A's
      // in the organization-wide Evidence list.
      await seedFreshFile(FILE_B, FILE_B_NAME, "b", { engagementId: PROJECT_B, batchId: BATCH_B, fieldKeys: ["volunteer_hours", "site_code"] }));
    const promotedB = await submitSourceCandidateDecision({
      organizationId: ORG, intakeSourceCandidateId: candidateB, actorContext: gkReviewerService,
      payload: { outcome: "promoted", reviewed_source_type: "organization_primary_record" },
    }, { env: ENV });
    assert.equal(promotedB.data.evidence_extraction_handoff.status, "created");
    projectBEvidence = await evidenceRows(FILE_B);

    await test("case 1: fresh file -> cockpit promotion -> automatic P2-01 evidence, with no manual extraction request, visible on the Evidence tab", async () => {
      const before = await governedCounts();
      const requests = await promoteThroughCockpit(gkPage, candidate);
      assert.ok((await gkPage.text()).includes("Evidence extraction: 2 evidence item(s) created, awaiting GK evidence review."));
      assert.deepEqual(requests.filter((r) => r.method === "POST").map((r) => [new URL(r.url).pathname, r.status]), [[decisionPath(candidate), 200]]);
      assert.equal(requests.filter(isExtractionRequest).length, 0, "no evidence-extraction request from the browser");
      assert.deepEqual(diff(before, await governedCounts()), {
        evidence: 2, queue_items: 2, evidence_queue: 2, evidence_decisions: 0, claims: 0, claim_links: 0, claim_queue: 0, claim_decisions: 0,
      });
      evidence = await evidenceRows();
      assert.equal(evidence.length, 2);
      [supportedItem, unsupportedItem] = evidence;
      await openGkEvidenceTab(gkPage);
      for (const row of evidence) {
        await gkPage.waitForText(row.statement);
        const item = await evidenceItemText(gkPage, row.statement);
        assert.match(item, /needs_gk_review/);
        assert.match(item, /No claim proposed yet/);
      }
      assert.deepEqual(gkPage.exceptions, []);
      results.case1_upstream = "PASS";
    });

    let supportedRequests;
    await test("case 2/3: 'supported' for Evidence A sends only the P2-12 POST; the server runs P2-02 then P2-03 and the browser issues no hidden proposal request", async () => {
      const before = await governedCounts();
      supportedRequests = await recordDecision(gkPage, supportedItem.statement, "supported");
      console.log(`[reviewed-claim-browser] requests after supported: ${JSON.stringify(supportedRequests.map((r) => [r.method, new URL(r.url).pathname, r.status]))}`);
      assert.deepEqual(supportedRequests.filter((r) => r.method === "POST").map((r) => [new URL(r.url).pathname, r.status]),
        [[reviewPath(supportedItem.evidence_item_id, supportedItem.review_queue_item_id), 200]], "exactly the normal P2-12 request");
      assert.equal(supportedRequests.filter(isHiddenProposalRequest).length, 0, "no browser P2-02 or P2-03 request");
      assert.ok(supportedRequests.some((r) => r.method === "GET" && new URL(r.url).pathname === claimLibraryPath(ORG) && r.status === 200),
        "the Claim Library is re-read from the server");
      await gkPage.waitForText("KAI proposed an internal-only claim from this evidence. It still needs Get Kinder claim review before any use.");
      assert.deepEqual(diff(before, await governedCounts()), {
        evidence: 0, queue_items: 1, evidence_queue: 0, evidence_decisions: 1, claims: 1, claim_links: 1, claim_queue: 1, claim_decisions: 0,
      });
      const claims = await claimRows();
      assert.equal(claims.length, 1);
      [proposed] = claims;
      assert.equal(proposed.evidence_item_id, supportedItem.evidence_item_id);
      assert.deepEqual(
        [proposed.claim_type, proposed.claim_status, proposed.claim_review_status, proposed.claim_strength, proposed.queue_status, proposed.review_status],
        ["finding", "proposed", "needs_gk_review", "unassessed", "open", "needs_gk_review"]);
      assert.equal(proposed.created_by, kaiUserIds.gk_reviewer);
      assert.equal(proposed.created_by_type, "human");
      assert.deepEqual(gkPage.exceptions, []);
      results.case2_evidence_review_supported = "PASS";
      results.case3_server_continuation = "PASS";
    });

    await test("case 5: 'not_supported' for Evidence B succeeds through the same UI and proposes nothing", async () => {
      const before = await governedCounts();
      const requests = await recordDecision(gkPage, unsupportedItem.statement, "not_supported");
      assert.deepEqual(requests.filter((r) => r.method === "POST").map((r) => [new URL(r.url).pathname, r.status]),
        [[reviewPath(unsupportedItem.evidence_item_id, unsupportedItem.review_queue_item_id), 200]]);
      assert.equal(requests.filter(isHiddenProposalRequest).length, 0);
      await gkPage.waitForText("No claim was proposed: only evidence reviewed as supported can be proposed as a claim.");
      assert.deepEqual(diff(before, await governedCounts()), {
        evidence: 0, queue_items: 0, evidence_queue: 0, evidence_decisions: 1, claims: 0, claim_links: 0, claim_queue: 0, claim_decisions: 0,
      });
      const item = await evidenceItemText(gkPage, unsupportedItem.statement);
      console.log(`[reviewed-claim-browser] not_supported item:\n${item}`);
      assert.match(item, /reviewed_not_supported/);
      assert.match(item, /No claim proposed yet/);
      assert.doesNotMatch(item, /View source & traceability/);
      const [row] = (await evidenceRows()).filter((entry) => entry.evidence_item_id === unsupportedItem.evidence_item_id);
      assert.equal(row.support_strength, "reviewed_not_supported");
      assert.equal((await claimRows()).some((claim) => claim.evidence_item_id === unsupportedItem.evidence_item_id), false,
        "no claim rests on not_supported evidence");
      assert.deepEqual(gkPage.exceptions, []);
      results.case5_negative_evidence = "PASS";
    });

    await test("case 4: the existing Claims card shows the proposed claim text, needs_gk_review, and that Get Kinder claim review is still required", async () => {
      const card = await claimsCardText(gkPage);
      console.log(`[reviewed-claim-browser] Claims card:\n${card}`);
      assert.ok(card.includes(proposed.statement), "claim text");
      assert.ok(card.includes(proposed.claim_id));
      assert.match(card, /finding · needs_gk_review/);
      assert.match(card, /Get Kinder claim review required/);
      assert.match(card, /claim_review\/open/);
      assert.match(card, /1 shown/);
      assert.match(card, /internal audience eligibility:\s*(not currently eligible|eligibility unavailable)/);
      const supported = await evidenceItemText(gkPage, supportedItem.statement);
      assert.doesNotMatch(supported, /No claim proposed yet/);
      assert.match(supported, /View source & traceability/);
      const body = await gkPage.text();
      for (const forbidden of ["gs://", "storage.googleapis", "synthetic-v1", "object_key", kaiUserIds.gk_operator]) {
        assert.ok(!body.includes(forbidden), `page never shows ${forbidden}`);
      }
      // The auto-selected claim's single-claim traceability is P2-06's
      // existing fail-closed read until P2-04 gap state exists; recorded, not repaired.
      const trace = gkPage.requests().filter((r) => /\/traceability/.test(new URL(r.url).pathname));
      console.log(`[reviewed-claim-browser] traceability reads: ${JSON.stringify(trace.map((r) => r.status))}`);
      assert.ok(trace.every((r) => r.status === 409 || r.status === 200));
      assert.equal((await governedCounts()).claim_decisions, 0, "no claim-review decision has happened");
      assert.deepEqual(gkPage.exceptions, []);
      results.case4_claim_visible = "PASS";
    });

    await test("case 6: the client Project shows Evidence review Complete and Impact Fact review Waiting for Get Kinder, with no internal ids or reviewer controls", async () => {
      await clientPage.goto("/impact-library");
      await clientPage.waitForText("Knowledge Studio");
      await clientPage.clickNav("Knowledge Studio");
      await clientPage.waitFor(async () => clientPage.evaluate(`Boolean(document.getElementById("gk-shell-project-select"))`), "project selector");
      await clientPage.idle();
      await clientPage.selectProject(PROJECT);
      await clientPage.waitFor(async () => Boolean(await clientPage.pipelineFileText(FILE)), "pipeline entry");
      const entry = await clientPage.pipelineFileText(FILE);
      console.log(`[reviewed-claim-browser] client pipeline:\n${entry}`);
      assert.match(entry, /Evidence review\s+Complete/);
      assert.match(entry, /Impact Fact review\s+Waiting for Get Kinder/);
      const body = await clientPage.text();
      for (const forbidden of [
        proposed.claim_id, proposed.claim_queue_id, proposed.statement, supportedItem.evidence_item_id, unsupportedItem.evidence_item_id,
        supportedItem.review_queue_item_id, kaiUserIds.gk_reviewer, "needs_gk_review", "claim_review", "reviewed_not_supported",
        "Get Kinder claim review required", ...GK_REVIEW_CONTROLS,
      ]) {
        assert.ok(!body.includes(forbidden), `client never sees ${forbidden}`);
      }
      assert.ok(!body.includes("Reviewed for internal use"), "a proposal is not an Impact Fact");
      assert.equal(clientPage.requests().filter((r) => r.method === "POST").length, 0);
      assertClientBoundary(clientPage, "client", body);
      assert.deepEqual(clientPage.exceptions, []);
      results.case6_client_safe = "PASS";
    });

    await test("case 7: reload and revisit create no duplicate claim or claim_review item and send no write", async () => {
      const before = await governedCounts();
      const mark = gkPage.mark();
      await openGkEvidenceTab(gkPage);
      await gkPage.clickButton("Load claims");
      await gkPage.idle();
      await gkPage.waitFor(async () => (await claimsCardText(gkPage))?.includes(proposed.statement), "claim listed after reload");
      assert.match(await claimsCardText(gkPage), /1 shown/);
      assert.equal(gkPage.requestsSince(mark).filter((r) => r.method === "POST").length, 0);
      assert.deepEqual(diff(before, await governedCounts()), {
        evidence: 0, queue_items: 0, evidence_queue: 0, evidence_decisions: 0, claims: 0, claim_links: 0, claim_queue: 0, claim_decisions: 0,
      });
      assert.equal(await clickInEvidenceItem(gkPage, supportedItem.statement, "Review evidence"), false, "no re-review offered for a terminal item");
      assert.deepEqual(gkPage.exceptions, []);
      results.case7_replay_reload = "PASS";
    });

    await test("case 8: Project B and Organization B show none of Project A's claim or evidence and are unchanged", async () => {
      const rowsB = await evidenceRows(FILE_B);
      assert.deepEqual(rowsB.map((row) => [row.evidence_review_status, row.support_strength, row.queue_status]),
        projectBEvidence.map((row) => [row.evidence_review_status, row.support_strength, row.queue_status]));
      assert.equal((await claimRows()).some((claim) => rowsB.some((row) => row.evidence_item_id === claim.evidence_item_id)), false);
      await clientPage.selectProject(PROJECT_B);
      await clientPage.waitFor(async () => Boolean(await clientPage.pipelineFileText(FILE_B)), "Project B pipeline entry");
      const entryB = await clientPage.pipelineFileText(FILE_B);
      assert.match(entryB, /Evidence review\s+Waiting for Get Kinder/);
      assert.equal(await clientPage.pipelineFileText(FILE), null, "Project A's file is not in Project B");

      const mark = gkPage.mark();
      assert.ok(await gkPage.evaluate(`(() => { const b = document.querySelector(".gk-shell-org-switcher-btn"); if (!b) return false; b.click(); return true; })()`));
      await gkPage.waitFor(async () => gkPage.evaluate(`document.querySelectorAll(".gk-shell-org-switcher-option").length === 2`), "two organization options");
      assert.ok(await gkPage.evaluate(`(() => { const o = [...document.querySelectorAll(".gk-shell-org-switcher-option")].find((el) => el.getAttribute("aria-selected") === "false"); if (!o) return false; o.click(); return true; })()`));
      await gkPage.idle();
      if (!(await gkPage.evaluate(`[...document.querySelectorAll(".nav-tabs button.active")].some((el) => el.innerText.trim() === "Evidence")`))) {
        await gkPage.clickTab("Evidence");
        await gkPage.idle();
      }
      await gkPage.waitForText("No evidence extracted yet for this organization.");
      await gkPage.clickButton("Load claims");
      await gkPage.idle();
      const body = await gkPage.text();
      for (const forbidden of [proposed.statement, proposed.claim_id, supportedItem.statement, unsupportedItem.statement]) {
        assert.ok(!body.includes(forbidden), "Organization A's claim and evidence are not rendered under Organization B");
      }
      const since = gkPage.requestsSince(mark);
      assert.ok(since.some((r) => new URL(r.url).pathname === claimLibraryPath(ORG_B) && r.status === 200), "Organization B's own Claim Library read");
      assert.equal(since.filter((r) => r.method === "POST").length, 0);
      const [{ count: orgBClaims }] = await query("SELECT count(*)::int AS count FROM kai.claims WHERE organization_id = $1::uuid", [ORG_B]);
      assert.equal(orgBClaims, 0);
      assert.deepEqual(gkPage.exceptions, []);
      results.case8_isolation = "PASS";
    });

    await test("case 9: the operator gets no review or proposal control; the client's direct review and proposal requests are refused and write nothing", async () => {
      await openGkEvidenceTab(operatorPage);
      for (const row of evidence) await operatorPage.waitForText(row.statement);
      const body = await operatorPage.text();
      for (const control of GK_REVIEW_CONTROLS) assert.ok(!body.includes(control), `operator sees no ${control}`);
      assert.equal(operatorPage.requests().filter((r) => r.method === "POST").length, 0);

      const before = await governedCounts();
      const [pendingB] = projectBEvidence;
      const attempts = await clientPage.evaluate(`(async () => {
        const post = (path, body) => fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
          .then((r) => r.status);
        return {
          proposal: await post(${JSON.stringify(claimProposalPathFor(pendingB.evidence_item_id))}, {}),
          review: await post(${JSON.stringify(reviewPath(pendingB.evidence_item_id, pendingB.review_queue_item_id))},
            { expected_updated_at: new Date().toISOString(), decision: "supported" }),
        };
      })()`);
      console.log(`[reviewed-claim-browser] client direct attempts ${JSON.stringify(attempts)}`);
      assert.ok(attempts.proposal >= 400 && attempts.proposal < 500, "client cannot propose");
      assert.ok(attempts.review >= 400 && attempts.review < 500, "client cannot review");
      assert.deepEqual(diff(before, await governedCounts()), {
        evidence: 0, queue_items: 0, evidence_queue: 0, evidence_decisions: 0, claims: 0, claim_links: 0, claim_queue: 0, claim_decisions: 0,
      });
      assert.deepEqual(operatorPage.exceptions, []);
      results.case9_authorization = "PASS";
    });

    await test("case 10: PostgreSQL - one review-gated proposed claim with its open claim_review item, zero claim-review decisions, and no funder/public/export authority", async () => {
      const claims = await claimRows();
      assert.equal(claims.length, 1);
      const [claim] = claims;
      assert.deepEqual(
        [claim.claim_status, claim.claim_review_status, claim.claim_strength, claim.queue_status, claim.review_status],
        ["proposed", "needs_gk_review", "unassessed", "open", "needs_gk_review"]);
      assert.deepEqual(
        [claim.internal_only, claim.public_use_allowed, claim.funder_use_allowed, claim.llm_processing_allowed, claim.product_learning_allowed, claim.export_ready],
        [true, false, false, false, false, false]);
      const counts = await governedCounts();
      assert.equal(counts.claim_decisions, 0);
      assert.equal(counts.claim_queue, 1);
      assert.equal(counts.claim_links, 1);
      const [{ count: evidenceWidened }] = await query(
        "SELECT count(*)::int AS count FROM kai.evidence_items WHERE public_use_allowed OR funder_use_allowed OR llm_processing_allowed OR internal_only IS NOT TRUE");
      assert.equal(evidenceWidened, 0);
      results.case10_zero_approval = "PASS";
    });

    console.log(`[reviewed-claim-browser] results ${JSON.stringify(results)}`);
  } finally {
    await gkPage.close().catch(() => {});
    await clientPage.close().catch(() => {});
    await operatorPage.close().catch(() => {});
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await seedPool.end();
    const { default: ambientPool } = await import("../Backend/db/pg.js");
    await ambientPool.end().catch(() => {});
  }
}
