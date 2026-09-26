import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Browser acceptance of P2-12 human evidence review of evidence that has NO
 * claim, from the GK Knowledge Studio Evidence tab, run only by
 *   node scripts/kai-client-knowledge-studio-browser-acceptance-local-postgres.js \
 *     __tests__/kai-p2-12-no-claim-evidence-review-browser-acceptance.integration.spec.js
 * against that runner's ephemeral loopback PostgreSQL. Skipped otherwise.
 *
 * Real: every KAI router/service/read model on the runner cluster,
 * resolveKaiActorContext with real memberships and global roles, the built
 * frontend bundle, a real headless Chrome over the DevTools protocol with one
 * isolated browser context (and harness cookie) per actor, the P1-06 review
 * work, the cockpit sensitivity decision and its P1-07 handoff, the
 * browser-driven P1-08 promotion and its server-side P2-01 handoff, and the
 * browser-driven P2-12 decisions through the existing route.
 * Simulated: the Get Kinder session login (req.user from a harness cookie),
 * the runner's synthetic kai.intake_batches / kai.intake_files mirrors, the
 * P1-03..P1-05 rows of the fresh synthetic file (the P1 worker's output), and,
 * for the ambiguous-lineage case only, two synthetic decision rows written
 * after dropping the ledger's root-per-lineage index in this throwaway cluster.
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

test("no-claim evidence review browser acceptance isolation: a non-loopback runner URL is refused", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
});

if (!RUNNER_DATABASE_URL || !CHROME || !WORKDIR) {
  test("P2-12 no-claim evidence review browser acceptance requires its runner", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_DATABASE_URL);
  await runBrowserAcceptance();
}

// ---------------------------------------------------------------------------
// Minimal Chrome DevTools protocol client (Node's built-in WebSocket), the
// same shape as the other Knowledge Studio acceptance specs.
// ---------------------------------------------------------------------------

async function launchChrome() {
  const profileDir = join(WORKDIR, "chrome-profile-p2-12-no-claim-review");
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
  const PROJECT = "7c000000-0000-4000-8000-0000000000e7";
  const BATCH = "10000000-0000-4000-8000-0000000000e7";
  const FILE = "20000000-0000-4000-8000-0000000000e7";
  const FILE_NAME = "no-claim-review-households.csv";
  const FIELD_KEYS = ["households_served", "programme_month"];
  const USERS = Object.freeze({ gkReviewer: 971, clientAdmin: 972, gkOperator: 973 });

  await query(`INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES
                 ($1::uuid, 'Harbourline Synthetic Society', 'harbourline-synthetic'),
                 ($2::uuid, 'Second Synthetic Collective', 'second-synthetic-browser')
               ON CONFLICT (organization_id) DO NOTHING`, [ORG, ORG_B]);
  await query("INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code, project_metadata) VALUES ($1::uuid, $2::uuid, 'Project No-Claim Review', '{}'::jsonb)",
    [PROJECT, ORG]);
  await query(`INSERT INTO kai.intake_batches (intake_batch_id, organization_id, engagement_id, batch_code, processing_status, review_status)
               VALUES ($1::uuid, $2::uuid, $3::uuid, 'no-claim-review-2026', 'received', 'not_reviewed')`, [BATCH, ORG, PROJECT]);
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
      (SELECT count(*) FROM kai.claim_review_decisions)::int AS claim_decisions`);
    return row;
  }
  const diff = (before, after) => Object.fromEntries(Object.keys(after).map((key) => [key, after[key] - before[key]]));
  async function evidenceRows() {
    return query(
      `SELECT e.evidence_item_id::text, e.statement, e.evidence_review_status, e.support_strength, e.internal_only,
              e.public_use_allowed, e.funder_use_allowed, e.llm_processing_allowed,
              q.review_queue_item_id::text, q.queue_status, q.review_status
         FROM kai.evidence_items e
         JOIN kai.source_versions v ON v.organization_id = e.organization_id AND v.source_version_id = e.source_version_id
         JOIN kai.intake_source_candidates c ON c.organization_id = v.organization_id AND c.intake_source_candidate_id = v.intake_source_candidate_id
         JOIN kai.review_queue_items q ON q.organization_id = e.organization_id AND q.queue_type = 'evidence_review'
          AND q.target_object_type = 'evidence_item' AND q.target_object_id = e.evidence_item_id
        WHERE e.organization_id = $1::uuid AND c.intake_file_id = $2::uuid ORDER BY e.statement`, [ORG, FILE]);
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

  const gkPage = await openPage(browser, { baseUrl, legacyUserId: USERS.gkReviewer });
  const clientPage = await openPage(browser, { baseUrl, legacyUserId: USERS.clientAdmin });
  const operatorPage = await openPage(browser, { baseUrl, legacyUserId: USERS.gkOperator });
  const results = {};
  let evidence;
  try {
    const profile = await seedFreshFile(FILE, FILE_NAME, "f");
    const candidate = await reachReviewableSourceCandidate(profile);

    await test("case 10 (continuity): the GK promotes the fresh source in the cockpit; P2-01 evidence is created server-side with no browser extraction request", async () => {
      const before = await governedCounts();
      const requests = await promoteThroughCockpit(gkPage, candidate);
      assert.ok((await gkPage.text()).includes("Evidence extraction: 2 evidence item(s) created, awaiting GK evidence review."));
      assert.deepEqual(requests.filter((r) => r.method === "POST").map((r) => [new URL(r.url).pathname, r.status]), [[decisionPath(candidate), 200]]);
      assert.equal(requests.filter(isExtractionRequest).length, 0, "no evidence-extraction request from the browser");
      assert.deepEqual(diff(before, await governedCounts()),
        { evidence: 2, queue_items: 2, evidence_queue: 2, evidence_decisions: 0, claims: 0, claim_decisions: 0 });
      evidence = await evidenceRows();
      assert.equal(evidence.length, 2);
      for (const row of evidence) {
        assert.deepEqual([row.evidence_review_status, row.support_strength, row.queue_status, row.review_status],
          ["needs_gk_review", "unassessed", "open", "needs_gk_review"]);
      }
      results.case10_promotion = "PASS";
    });

    await test("case 1: the GK reviewer finds both no-claim evidence items on the Evidence tab with their posture and a direct Review evidence action", async () => {
      await openGkEvidenceTab(gkPage);
      for (const row of evidence) await gkPage.waitForText(row.statement);
      for (const row of evidence) {
        const item = await evidenceItemText(gkPage, row.statement);
        console.log(`[p2-12-no-claim-browser] reviewer Evidence item:\n${item}`);
        assert.match(item, /needs_gk_review/);
        assert.match(item, /unassessed/);
        assert.match(item, /No claim proposed yet/);
        assert.match(item, /Review evidence/);
        assert.doesNotMatch(item, /View source & traceability/, "no claim traceability detour exists or is needed");
      }
      const reads = gkPage.requests().filter((r) => new URL(r.url).pathname === evidenceLibraryPath(ORG));
      assert.ok(reads.length >= 1 && reads.every((r) => r.status === 200));
      assert.equal(gkPage.requests().filter((r) => /\/traceability/.test(r.url)).length, 0, "no traceability read");
      assert.deepEqual(gkPage.exceptions, []);
      results.case1_discovery = "PASS";
    });

    await test("case 2: the review panel shows the safe governed context only", async () => {
      assert.ok(await clickInEvidenceItem(gkPage, evidence[0].statement, "Review evidence"));
      await gkPage.waitFor(async () => gkPage.evaluate(`Boolean(document.querySelector('[aria-label="Evidence review"]'))`), "review panel");
      const panel = await gkPage.evaluate(`document.querySelector('[aria-label="Evidence review"]').innerText`);
      console.log(`[p2-12-no-claim-browser] review panel:\n${panel}`);
      for (const expected of ["Evidence type", "dictionary_field_presence_fact", "Sensitivity", "Support strength", "unassessed",
        "Evidence review status", "needs_gk_review", "Review queue", "open / needs_gk_review", "Internal only",
        "does not propose or approve a claim", "supported", "not_supported", "needs_more_information"]) {
        assert.ok(panel.includes(expected), `panel shows ${expected}`);
      }
      const body = await gkPage.text();
      for (const forbidden of ["gs://", "storage.googleapis", "X-Goog", "signature", "synthetic-v1", "object_key", "password", "token",
        kaiUserIds.gk_reviewer, kaiUserIds.gk_operator, ORG_B, FILE_NAME]) {
        assert.ok(!panel.includes(forbidden), `panel never shows ${forbidden}`);
        if (forbidden !== FILE_NAME) assert.ok(!body.includes(forbidden), `page never shows ${forbidden}`);
      }
      assert.ok(await clickInEvidenceItem(gkPage, evidence[0].statement, "Close"));
      results.case2_safe_detail = "PASS";
    });

    await test("case 3: 'supported' through the browser uses exactly the P2-12 POST, re-reads Evidence, and persists reviewed/reviewed_supported with no claim, queue, or audience change", async () => {
      const [first] = evidence;
      const before = await governedCounts();
      const requests = await recordDecision(gkPage, first.statement, "supported");
      console.log(`[p2-12-no-claim-browser] requests after supported: ${JSON.stringify(requests.map((r) => [r.method, new URL(r.url).pathname, r.status]))}`);
      assert.deepEqual(requests.filter((r) => r.method === "POST").map((r) => [new URL(r.url).pathname, r.status]),
        [[reviewPath(first.evidence_item_id, first.review_queue_item_id), 200]], "exactly the normal P2-12 request");
      assert.ok(requests.some((r) => r.method === "GET" && new URL(r.url).pathname === evidenceLibraryPath(ORG) && r.status === 200), "Evidence re-read");
      assert.deepEqual(diff(before, await governedCounts()),
        { evidence: 0, queue_items: 0, evidence_queue: 0, evidence_decisions: 1, claims: 0, claim_decisions: 0 });
      const [row] = (await evidenceRows()).filter((entry) => entry.evidence_item_id === first.evidence_item_id);
      assert.deepEqual([row.evidence_review_status, row.support_strength, row.queue_status, row.review_status],
        ["reviewed", "reviewed_supported", "resolved", "resolved"]);
      assert.equal(row.review_queue_item_id, first.review_queue_item_id, "the existing queue item was resolved");
      assert.deepEqual([row.internal_only, row.public_use_allowed, row.funder_use_allowed, row.llm_processing_allowed], [true, false, false, false]);
      const item = await evidenceItemText(gkPage, first.statement);
      assert.match(item, /reviewed_supported/);
      assert.match(item, /Current decision\s*supported/);
      assert.ok(!(await gkPage.text()).includes("Reviewed for internal use"), "no Impact Fact");
      assert.ok(await clickInEvidenceItem(gkPage, first.statement, "Close"));
      assert.equal(await clickInEvidenceItem(gkPage, first.statement, "Review evidence"), false, "a terminally reviewed item is no longer offered for review");
      assert.deepEqual(gkPage.exceptions, []);
      results.case3_supported = "PASS";
    });

    const clientBody = async () => {
      await clientPage.goto("/impact-library");
      await clientPage.waitForText("Knowledge Studio");
      await clientPage.clickNav("Knowledge Studio");
      await clientPage.waitFor(async () => clientPage.evaluate(`Boolean(document.getElementById("gk-shell-project-select"))`), "project selector");
      await clientPage.idle();
      await clientPage.selectProject(PROJECT);
      await clientPage.waitFor(async () => Boolean(await clientPage.pipelineFileText(FILE)), "pipeline entry");
      return clientPage.pipelineFileText(FILE);
    };
    function assertNoClientLeak(label, body) {
      for (const row of evidence) {
        assert.ok(!body.includes(row.statement), `${label}: no evidence statement`);
        assert.ok(!body.includes(row.review_queue_item_id), `${label}: no queue id`);
        assert.ok(!body.includes(row.evidence_item_id), `${label}: no evidence id`);
      }
      for (const forbidden of [kaiUserIds.gk_reviewer, "reviewed_supported", "reviewed_not_supported", "not_supported", ...GK_REVIEW_CONTROLS]) {
        assert.ok(!body.includes(forbidden), `${label}: no ${forbidden}`);
      }
      assert.equal(clientPage.requests().filter((r) => r.method === "POST").length, 0, `${label}: the client issues no write`);
      assertClientBoundary(clientPage, label, body);
    }

    await test("case 4: with one of two items reviewed, the client Project shows Evidence creation Complete and Evidence review Waiting for Get Kinder, with no GK data", async () => {
      const entry = await clientBody();
      console.log(`[p2-12-no-claim-browser] client pipeline (partial):\n${entry}`);
      assert.match(entry, /Evidence creation\s+Complete/);
      assert.match(entry, /Evidence review\s+Waiting for Get Kinder/);
      await clientPage.clickTab("Evidence");
      await clientPage.waitForText("Evidence has been created from 1 file and is waiting for Get Kinder evidence review.");
      assertNoClientLeak("client partial", await clientPage.text());
      assert.deepEqual(clientPage.exceptions, []);
      results.case4_client_partial = "PASS";
    });

    await test("case 5: 'not_supported' through the browser resolves item 2 as reviewed_not_supported; nothing becomes usable, claimable, or wider-audience", async () => {
      const [, second] = evidence;
      await openGkEvidenceTab(gkPage);
      await gkPage.waitForText(second.statement);
      const before = await governedCounts();
      const requests = await recordDecision(gkPage, second.statement, "not_supported");
      assert.deepEqual(requests.filter((r) => r.method === "POST").map((r) => [new URL(r.url).pathname, r.status]),
        [[reviewPath(second.evidence_item_id, second.review_queue_item_id), 200]]);
      assert.deepEqual(diff(before, await governedCounts()),
        { evidence: 0, queue_items: 0, evidence_queue: 0, evidence_decisions: 1, claims: 0, claim_decisions: 0 });
      const [row] = (await evidenceRows()).filter((entry) => entry.evidence_item_id === second.evidence_item_id);
      assert.deepEqual([row.evidence_review_status, row.support_strength, row.queue_status, row.review_status],
        ["reviewed", "reviewed_not_supported", "resolved", "resolved"]);
      assert.deepEqual([row.internal_only, row.public_use_allowed, row.funder_use_allowed, row.llm_processing_allowed], [true, false, false, false]);
      const item = await evidenceItemText(gkPage, second.statement);
      console.log(`[p2-12-no-claim-browser] not_supported item:\n${item}`);
      assert.match(item, /reviewed_not_supported/);
      assert.match(item, /Current decision\s*not_supported/);
      assert.doesNotMatch(item, /reviewed_supported|Eligible|eligible|Reviewed for internal use/, "never shown as supported or eligible");
      assert.deepEqual(gkPage.exceptions, []);
      results.case5_not_supported = "PASS";
    });

    await test("case 6: with both items reviewed and no claim, the client Project shows evidence review Complete and Impact Fact review waiting for Get Kinder, with zero Impact Facts", async () => {
      const entry = await clientBody();
      console.log(`[p2-12-no-claim-browser] client pipeline (all reviewed):\n${entry}`);
      assert.match(entry, /Evidence creation\s+Complete/);
      assert.match(entry, /Evidence review\s+Complete/);
      assert.match(entry, /Impact Fact review\s+Waiting for Get Kinder/);
      await clientPage.clickTab("Evidence");
      await clientPage.waitForText("Evidence from 1 file has been reviewed. Get Kinder has not yet completed the Impact Fact review.");
      const body = await clientPage.text();
      assert.ok(!body.includes("Reviewed for internal use") && !body.includes("1 shown"), "no reviewed Impact Fact");
      assertNoClientLeak("client all reviewed", body);
      assert.equal((await governedCounts()).claims, 0);
      assert.deepEqual(clientPage.exceptions, []);
      results.case6_client_after = "PASS";
    });

    await test("case 7: a read-only gk_operator reads the Evidence tab but is offered no review action or form and sends no review request", async () => {
      await openGkEvidenceTab(operatorPage);
      for (const row of evidence) await operatorPage.waitForText(row.statement);
      const body = await operatorPage.text();
      for (const row of evidence) assert.match(await evidenceItemText(operatorPage, row.statement), /reviewed/);
      for (const control of GK_REVIEW_CONTROLS) assert.ok(!body.includes(control), `operator sees no ${control}`);
      assert.equal(await operatorPage.evaluate(`document.querySelectorAll('[aria-label="Evidence review"], input[name="evidence-library-review-decision"]').length`), 0,
        "no decision form rendered");
      assert.equal(operatorPage.requests().filter(isEvidenceReviewPost).length, 0);
      assert.ok(operatorPage.requests().some((r) => new URL(r.url).pathname === evidenceLibraryPath(ORG) && r.status === 200), "Evidence Library read allowed");
      assert.deepEqual(operatorPage.exceptions, []);
      results.case7_operator = "PASS";
    });

    await test("case 8: switching the GK shell to another organization clears Organization A's evidence and offers no cross-tenant review action", async () => {
      await openGkEvidenceTab(gkPage);
      await gkPage.waitForText(evidence[0].statement);
      const mark = gkPage.mark();
      assert.ok(await gkPage.evaluate(`(() => { const b = document.querySelector(".gk-shell-org-switcher-btn"); if (!b) return false; b.click(); return true; })()`),
        "organization switcher present (reviewer has two organizations)");
      await gkPage.waitFor(async () => gkPage.evaluate(`document.querySelectorAll(".gk-shell-org-switcher-option").length === 2`), "two organization options");
      assert.ok(await gkPage.evaluate(`(() => { const o = [...document.querySelectorAll(".gk-shell-org-switcher-option")].find((el) => el.getAttribute("aria-selected") === "false"); if (!o) return false; o.click(); return true; })()`));
      await gkPage.idle();
      if (!(await gkPage.evaluate(`[...document.querySelectorAll(".nav-tabs button.active")].some((el) => el.innerText.trim() === "Evidence")`))) {
        await gkPage.clickTab("Evidence");
        await gkPage.idle();
      }
      await gkPage.waitForText("No evidence extracted yet for this organization.");
      const body = await gkPage.text();
      for (const row of evidence) assert.ok(!body.includes(row.statement), "Organization A evidence is not rendered under Organization B");
      for (const control of GK_REVIEW_CONTROLS) assert.ok(!body.includes(control));
      const since = gkPage.requestsSince(mark);
      assert.ok(since.some((r) => new URL(r.url).pathname === evidenceLibraryPath(ORG_B) && r.status === 200), "Organization B's own Evidence Library read");
      assert.equal(since.filter(isEvidenceReviewPost).length, 0);
      assert.deepEqual(gkPage.exceptions, []);
      results.case8_org_switch = "PASS";
      results.case8_held_late_response = "NOT_RUN (the established runner has no request hold/release facility; covered by the focused stale-response test)";
    });

    await test("case 9: ambiguous decision lineage makes the Evidence tab fail closed instead of showing one chosen decision", async () => {
      const [first] = evidence;
      await query("DROP INDEX kai.ux_evidence_review_decisions_p2_12_root_per_lineage");
      await query(
        `INSERT INTO kai.evidence_review_decisions (organization_id, evidence_item_id, review_queue_item_id, decision_outcome, decided_by, decided_by_role, target_updated_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'needs_more_information', $4::uuid, 'gk_reviewer', now())`,
        [ORG, first.evidence_item_id, first.review_queue_item_id, kaiUserIds.gk_reviewer]);
      const before = await governedCounts();
      // A fresh reviewer context loads the Evidence tab from scratch.
      const reviewerPage = await openPage(browser, { baseUrl, legacyUserId: USERS.gkReviewer });
      try {
        await openGkEvidenceTab(reviewerPage);
        await reviewerPage.waitForText("Evidence:");
        const body = await reviewerPage.text();
        console.log(`[p2-12-no-claim-browser] ambiguous-lineage Evidence tab: ${body.slice(body.indexOf("Evidence:"), body.indexOf("Evidence:") + 120)}`);
        for (const row of evidence) assert.ok(!body.includes(row.statement), "no evidence item is rendered from the ambiguous read");
        for (const control of GK_REVIEW_CONTROLS) assert.ok(!body.includes(control));
        assert.ok(reviewerPage.requests().some((r) => new URL(r.url).pathname === evidenceLibraryPath(ORG) && r.status === 500), "the read failed closed");
        assert.equal(reviewerPage.requests().filter(isEvidenceReviewPost).length, 0);
        assert.deepEqual(await governedCounts(), before, "nothing was written or repaired");
      } finally {
        await reviewerPage.close().catch(() => {});
      }
      results.case9_ambiguous = "PASS";
    });

    console.log(`[p2-12-no-claim-browser] results ${JSON.stringify(results)}`);
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
