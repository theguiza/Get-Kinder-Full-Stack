import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Browser acceptance of the P1-08 source promotion -> P2-01 evidence extraction
 * handoff through the actual GK product flow, run only by
 *   node scripts/kai-client-knowledge-studio-browser-acceptance-local-postgres.js \
 *     __tests__/kai-p2-01-evidence-extraction-handoff-browser-acceptance.integration.spec.js
 * against that runner's ephemeral loopback PostgreSQL. Skipped otherwise.
 *
 * Real: every KAI router/service/read model on the runner cluster,
 * resolveKaiActorContext with real memberships and global roles, the built
 * frontend bundle (GK review cockpit, GK internal Knowledge Studio, client
 * Knowledge Studio), a real headless Chrome over the DevTools protocol, the
 * P1-06 review work, the cockpit sensitivity decision and its P1-07 handoff,
 * the browser-driven P1-08 promotion, and its server-side P2-01 handoff.
 * Simulated: the Get Kinder session login (req.user from a harness cookie),
 * the runner's synthetic kai.intake_batches / kai.intake_files mirrors, the
 * P1-03..P1-05 rows of the two fresh synthetic files (the P1 worker's output),
 * and, for the failure case only, a throwaway-cluster trigger that makes every
 * evidence insert fail.
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

test("evidence handoff browser acceptance isolation: a non-loopback runner URL is refused", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
});

if (!RUNNER_DATABASE_URL || !CHROME || !WORKDIR) {
  test("P2-01 evidence extraction handoff browser acceptance requires its runner", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_DATABASE_URL);
  await runBrowserAcceptance();
}

// ---------------------------------------------------------------------------
// Minimal Chrome DevTools protocol client (Node's built-in WebSocket), the
// same shape as the other Knowledge Studio acceptance specs.
// ---------------------------------------------------------------------------

async function launchChrome() {
  const profileDir = join(WORKDIR, "chrome-profile-evidence-handoff");
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
  const PROJECT = "7c000000-0000-4000-8000-0000000000d1";
  const BATCH = "10000000-0000-4000-8000-0000000000d1";
  const FILE = Object.freeze({ normal: "20000000-0000-4000-8000-0000000000d1", failing: "20000000-0000-4000-8000-0000000000d2" });
  const NAMES = Object.freeze({ normal: "handoff-households.csv", failing: "handoff-retry.csv" });
  const FIELD_KEYS = ["households_served", "programme_month"];
  const USERS = Object.freeze({ gkReviewer: 961, clientAdmin: 962 });
  const NOW = new Date().toISOString();

  await query(`INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES ($1::uuid, 'Harbourline Synthetic Society', 'harbourline-synthetic')
               ON CONFLICT (organization_id) DO NOTHING`, [ORG]);
  await query("INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code, project_metadata) VALUES ($1::uuid, $2::uuid, 'Project Handoff', '{}'::jsonb)",
    [PROJECT, ORG]);
  await query(`INSERT INTO kai.intake_batches (intake_batch_id, organization_id, engagement_id, batch_code, processing_status, review_status)
               VALUES ($1::uuid, $2::uuid, $3::uuid, 'handoff-intake-2026', 'received', 'not_reviewed')`, [BATCH, ORG, PROJECT]);
  const kaiUserIds = {};
  for (const [legacyId, role, global] of [[USERS.gkReviewer, "gk_reviewer", true], [USERS.clientAdmin, "client_admin", false]]) {
    await query("INSERT INTO public.userdata (id) VALUES ($1) ON CONFLICT DO NOTHING", [legacyId]);
    const kaiUser = await findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: legacyId, email: `user${legacyId}@harbourline.test` });
    kaiUserIds[role] = kaiUser.user_id;
    await query("INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status) VALUES ($1::uuid, $2::uuid, $3, 'active')",
      [ORG, kaiUser.user_id, role]);
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
  async function seedFreshFile(intakeFileId, name, checksumChar) {
    const checksum = checksumChar.repeat(64);
    await query(
      `INSERT INTO kai.intake_files (intake_file_id, intake_batch_id, organization_id, engagement_id, original_filename, safe_filename,
         checksum, hash_algorithm, upload_state, object_version_id, verified_checksum, verified_size_bytes, verified_at,
         mime_type, file_size_bytes, malware_scan_status, review_status, file_policy_status, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $5, $6, 'sha256', 'confirmed', 'synthetic-v1', $6, 512, now(),
         'text/csv', 512, 'clean', 'not_reviewed', 'passed', now())`,
      [intakeFileId, BATCH, ORG, PROJECT, name, checksum],
    );
    const [run] = await query(
      `INSERT INTO kai.intake_parser_runs (organization_id, intake_file_id, parser_name, parser_version, checksum, parser_status, started_at)
       VALUES ($1::uuid, $2::uuid, 'kai_local_profiling_kernel', '1.0.0', $3, 'running', now()) RETURNING parser_run_id::text`,
      [ORG, intakeFileId, checksum],
    );
    const profile = {
      status: "profiled", format: "csv",
      counts: { row_count: 1, column_count: FIELD_KEYS.length, field_count: FIELD_KEYS.length },
      fields: FIELD_KEYS.map((key) => ({ field_key: key })),
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
    for (const key of FIELD_KEYS) {
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

  async function governedCounts() {
    const [row] = await query(`SELECT
      (SELECT count(*) FROM kai.intake_promotion_decisions)::int AS promotions,
      (SELECT count(*) FROM kai.sources)::int AS sources,
      (SELECT count(*) FROM kai.source_versions)::int AS source_versions,
      (SELECT count(*) FROM kai.source_locators)::int AS locators,
      (SELECT count(*) FROM kai.evidence_items)::int AS evidence,
      (SELECT count(*) FROM kai.review_queue_items WHERE queue_type = 'evidence_review')::int AS evidence_queue,
      (SELECT count(*) FROM kai.evidence_review_decisions)::int AS evidence_decisions,
      (SELECT count(*) FROM kai.claims)::int AS claims`);
    return row;
  }
  async function candidateLineage(intakeSourceCandidateId) {
    const versions = await query(
      `SELECT v.source_version_id::text, v.is_current, d.source_version_id::text AS decided_version
         FROM kai.source_versions v JOIN kai.intake_promotion_decisions d
           ON d.organization_id = v.organization_id AND d.intake_source_candidate_id = v.intake_source_candidate_id
        WHERE v.organization_id = $1::uuid AND v.intake_source_candidate_id = $2::uuid`, [ORG, intakeSourceCandidateId]);
    const evidence = versions.length === 0 ? [] : await query(
      `SELECT e.evidence_item_id::text, e.statement, e.evidence_review_status, q.queue_status
         FROM kai.evidence_items e JOIN kai.review_queue_items q ON q.organization_id = e.organization_id
          AND q.queue_type = 'evidence_review' AND q.target_object_type = 'evidence_item' AND q.target_object_id = e.evidence_item_id
        WHERE e.organization_id = $1::uuid AND e.source_version_id = $2::uuid ORDER BY e.statement`,
      [ORG, versions[0].source_version_id]);
    return { versions, evidence };
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

  const gkPage = await openPage(browser, { baseUrl, legacyUserId: USERS.gkReviewer });
  const clientPage = await openPage(browser, { baseUrl, legacyUserId: USERS.clientAdmin });
  const results = {};
  try {
    const normalProfile = await seedFreshFile(FILE.normal, NAMES.normal, "d");
    const normalCandidate = await reachReviewableSourceCandidate(normalProfile);

    await test("GK promotes a fresh source candidate in the review cockpit; evidence is created server-side with no second browser request", async () => {
      const before = await governedCounts();
      const requests = await promoteThroughCockpit(gkPage, normalCandidate);
      const body = await gkPage.text();
      console.log(`[evidence-handoff-browser] cockpit result: ${body.slice(body.indexOf("Recorded promoted."), body.indexOf("Recorded promoted.") + 200)}`);
      assert.ok(body.includes("Evidence extraction: 2 evidence item(s) created, awaiting GK evidence review."));
      assert.ok(!body.includes("Retry evidence extraction"), "no recovery control on success");
      console.log(`[evidence-handoff-browser] requests after Promote: ${JSON.stringify(requests.map((r) => [r.method, new URL(r.url).pathname, r.status]))}`);
      const posts = requests.filter((r) => r.method === "POST");
      assert.deepEqual(posts.map((r) => [new URL(r.url).pathname, r.status]), [[decisionPath(normalCandidate), 200]],
        "the browser issues exactly one privileged request: the normal source-candidate decision");
      assert.equal(requests.filter(isExtractionRequest).length, 0, "no evidence-extraction request from the browser");

      const after = await governedCounts();
      assert.deepEqual(
        Object.fromEntries(Object.keys(after).map((key) => [key, after[key] - before[key]])),
        { promotions: 1, sources: 1, source_versions: 1, locators: 2, evidence: 2, evidence_queue: 2, evidence_decisions: 0, claims: 0 },
      );
      const lineage = await candidateLineage(normalCandidate);
      assert.equal(lineage.versions.length, 1);
      assert.equal(lineage.versions[0].is_current, true);
      assert.equal(lineage.versions[0].decided_version, lineage.versions[0].source_version_id);
      assert.equal(lineage.evidence.length, 2);
      for (const row of lineage.evidence) {
        assert.equal(row.evidence_review_status, "needs_gk_review");
        assert.equal(row.queue_status, "open");
      }
      results.normalStatements = lineage.evidence.map((row) => row.statement);
      assert.deepEqual(gkPage.exceptions, []);
      results.promotion = "PASS";
    });

    await test("GK internal Knowledge Studio: the new evidence candidates are listed for GK review (needs_gk_review, no claim yet)", async () => {
      await gkPage.goto("/impact-library");
      await gkPage.waitForText("Knowledge Studio");
      await gkPage.clickNav("Knowledge Studio");
      await gkPage.waitFor(async () => gkPage.evaluate(`Boolean(document.querySelector(".nav-tabs"))`), "Knowledge Studio tabs");
      await gkPage.clickTab("Evidence");
      for (const statement of results.normalStatements) await gkPage.waitForText(statement);
      const body = await gkPage.text();
      const section = body.slice(body.indexOf(results.normalStatements[0]) - 20, body.indexOf(results.normalStatements[1]) + 200);
      console.log(`[evidence-handoff-browser] GK Evidence list excerpt:\n${section}`);
      assert.match(section, /needs_gk_review/);
      assert.match(section, /No claim proposed yet/);
      assert.deepEqual(gkPage.exceptions, []);
      results.gkEvidence = "PASS";
    });

    await test("client Knowledge Studio: the Project advances to evidence awaiting Get Kinder review, with no reviewed Impact Fact and no GK payload or control", async () => {
      const before = await governedCounts();
      await clientPage.goto("/impact-library");
      await clientPage.waitForText("Knowledge Studio");
      await clientPage.clickNav("Knowledge Studio");
      await clientPage.waitFor(async () => clientPage.evaluate(`Boolean(document.getElementById("gk-shell-project-select"))`), "project selector");
      await clientPage.idle();
      await clientPage.selectProject(PROJECT);
      await clientPage.waitFor(async () => Boolean(await clientPage.pipelineFileText(FILE.normal)), "pipeline entry");
      const entry = await clientPage.pipelineFileText(FILE.normal);
      console.log(`[evidence-handoff-browser] client pipeline entry:\n${entry}`);
      for (const [label, status] of [["Sensitivity review", "Complete"], ["Source review", "Complete"], ["Evidence creation", "Complete"],
        ["Evidence review", "Waiting for Get Kinder"]]) {
        assert.match(entry, new RegExp(`${label}\\s+${status}`), `${label} -> ${status}`);
      }
      await clientPage.clickTab("Evidence");
      await clientPage.waitForText("Evidence has been created from 1 file and is waiting for Get Kinder evidence review.");
      const body = await clientPage.text();
      assert.ok(!body.includes("Get Kinder has not yet created evidence"), "no longer waiting for extraction");
      assert.ok(!body.includes("Reviewed for internal use") && !body.includes("1 shown"), "no reviewed Impact Fact");
      for (const statement of results.normalStatements) assert.ok(!body.includes(statement), "no unreviewed evidence statement reaches the client");
      assertClientBoundary(clientPage, "client after extraction", body);
      assert.deepEqual(await governedCounts(), before, "browsing wrote nothing");
      assert.deepEqual(clientPage.exceptions, []);
      results.client = "PASS";
    });

    await test("failure/recovery: a failed server-side extraction is shown as such in the cockpit, the promotion stays committed, and Retry evidence extraction recovers through the replay", async () => {
      const failingProfile = await seedFreshFile(FILE.failing, NAMES.failing, "e");
      const failingCandidate = await reachReviewableSourceCandidate(failingProfile);
      await query(`CREATE FUNCTION kai.p2_01_handoff_browser_fail_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
                   BEGIN RAISE EXCEPTION 'synthetic P2-01 fault'; END $$`);
      await query(`CREATE TRIGGER p2_01_handoff_browser_fail_evidence BEFORE INSERT ON kai.evidence_items
                   FOR EACH ROW EXECUTE FUNCTION kai.p2_01_handoff_browser_fail_evidence()`);
      let before;
      let afterFailure;
      try {
        before = await governedCounts();
        await promoteThroughCockpit(gkPage, failingCandidate);
        afterFailure = await governedCounts();
      } finally {
        await query("DROP TRIGGER p2_01_handoff_browser_fail_evidence ON kai.evidence_items");
        await query("DROP FUNCTION kai.p2_01_handoff_browser_fail_evidence()");
      }
      let body = await gkPage.text();
      console.log(`[evidence-handoff-browser] cockpit failure result: ${body.slice(body.indexOf("Recorded promoted."), body.indexOf("Recorded promoted.") + 260)}`);
      assert.ok(body.includes("The source is promoted, but evidence extraction did not complete (validation_blocker). The promotion is saved; retry evidence extraction below."));
      assert.ok(!body.includes("synthetic P2-01 fault"), "no internal error detail");
      assert.ok(body.includes("Retry evidence extraction"));
      assert.deepEqual(
        Object.fromEntries(Object.keys(afterFailure).map((key) => [key, afterFailure[key] - before[key]])),
        { promotions: 1, sources: 1, source_versions: 1, locators: 0, evidence: 0, evidence_queue: 0, evidence_decisions: 0, claims: 0 },
        "the promotion, source, and source_version stay committed; no evidence exists",
      );

      const mark = gkPage.mark();
      await gkPage.clickButton("Retry evidence extraction");
      await gkPage.waitForText("Recorded promoted (replayed, no new write). Evidence extraction: 2 evidence item(s) created, awaiting GK evidence review.");
      await gkPage.idle();
      const requests = gkPage.requestsSince(mark);
      assert.deepEqual(requests.filter((r) => r.method === "POST").map((r) => [new URL(r.url).pathname, r.status]), [[decisionPath(failingCandidate), 200]]);
      assert.equal(requests.filter(isExtractionRequest).length, 0);
      body = await gkPage.text();
      assert.ok(!body.includes("Retry evidence extraction"), "the recovery control disappears once evidence exists");
      const afterRecovery = await governedCounts();
      assert.deepEqual(
        Object.fromEntries(Object.keys(afterRecovery).map((key) => [key, afterRecovery[key] - afterFailure[key]])),
        { promotions: 0, sources: 0, source_versions: 0, locators: 2, evidence: 2, evidence_queue: 2, evidence_decisions: 0, claims: 0 },
      );
      assert.deepEqual(gkPage.exceptions, []);
      results.failureRecovery = "PASS";
    });

    console.log(`[evidence-handoff-browser] results ${JSON.stringify({ ...results, normalStatements: undefined })}`);
  } finally {
    await gkPage.close().catch(() => {});
    await clientPage.close().catch(() => {});
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await seedPool.end();
    const { default: ambientPool } = await import("../Backend/db/pg.js");
    await ambientPool.end().catch(() => {});
  }
}
