import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Browser acceptance of the human file sensitivity review (B1A-2 Phase-5
 * decision) reached from Knowledge Studio after the Impact Library redesign,
 * run only by
 *   node scripts/kai-client-knowledge-studio-browser-acceptance-local-postgres.js \
 *     __tests__/kai-sensitivity-review-reachability-browser-acceptance.integration.spec.js
 * against that runner's ephemeral loopback PostgreSQL. Skipped otherwise.
 *
 * Package D gated the one Phase-5 review card to the Processing tab, while its
 * Review Queue entry point (Reviews tab) and its zero-queue file entry point
 * (Files tab Web Intake) only set the selected profile - the card stayed
 * hidden. This proves both entry points now open that card and that the
 * existing decision route records the reviewer's decision.
 *
 * Real: every KAI router/service/read model on the runner cluster,
 * resolveKaiActorContext with real memberships and global roles, the built
 * frontend bundle, a real headless Chrome over the DevTools protocol with one
 * isolated browser context (and harness cookie) per actor, the P1-06 review
 * work (browser-driven for the zero-queue file), the B1A-2 decision route,
 * its P1-07 handoff, and the client evidence-pipeline read.
 * Simulated: the Get Kinder session login (req.user from a harness cookie),
 * the runner's synthetic kai.intake_batches / kai.intake_files mirrors, the
 * P1-03..P1-05 rows of the two fresh synthetic files (the P1 worker's
 * output), and, for the queue path only, the earlier "start review work"
 * step (the real P1-06 service called directly).
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

test("sensitivity review reachability browser acceptance isolation: a non-loopback runner URL is refused", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
});

if (!RUNNER_DATABASE_URL || !CHROME || !WORKDIR) {
  test("sensitivity review reachability browser acceptance requires its runner", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_DATABASE_URL);
  await runBrowserAcceptance();
}

// ---------------------------------------------------------------------------
// Minimal Chrome DevTools protocol client (Node's built-in WebSocket), the
// same shape as the other Knowledge Studio acceptance specs.
// ---------------------------------------------------------------------------

async function launchChrome() {
  const profileDir = join(WORKDIR, "chrome-profile-sensitivity-review");
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
  const visibleButton = (label) => evaluate(`Boolean([...document.querySelectorAll("button")]
    .find((el) => el.offsetParent !== null && !el.disabled && el.innerText.trim() === ${JSON.stringify(label)}))`);
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
    visibleButton,
    activeTab: () => evaluate(`(() => { const el = document.querySelector(".nav-tabs button.active"); return el ? el.innerText.trim() : null; })()`),
    clickNav: (label) => clickWhere(`nav ${label}`, `() => [...document.querySelectorAll("[role=button], a, button")]
      .filter((el) => el.offsetParent !== null).find((el) => el.innerText.trim() === ${JSON.stringify(label)})`),
    clickTab: (label) => clickWhere(`tab ${label}`, `() => [...document.querySelectorAll(".nav-tabs button")]
      .filter((el) => el.offsetParent !== null).find((el) => el.innerText.trim() === ${JSON.stringify(label)})`),
    clickButton: (label) => clickWhere(`button ${label}`, `() => [...document.querySelectorAll("button")]
      .filter((el) => el.offsetParent !== null && !el.disabled).find((el) => el.innerText.trim() === ${JSON.stringify(label)})`),
    // The "Select" button on the visible list row that shows `rowText`.
    selectRow: (rowText) => clickWhere(`Select on ${rowText}`, `() => [...document.querySelectorAll("li")]
      .filter((el) => el.offsetParent !== null && el.innerText.includes(${JSON.stringify(rowText)}))
      .map((li) => [...li.querySelectorAll("button")].find((b) => b.innerText.trim() === "Select")).find(Boolean)`),
    clickInCard: (heading, label) => clickWhere(`${label} in ${heading}`, `() => {
      const h = [...document.querySelectorAll("h5")].find((el) => el.innerText.trim() === ${JSON.stringify(heading)});
      const card = h && h.closest(".admin-card");
      return card && [...card.querySelectorAll("button")].find((b) => b.innerText.trim() === ${JSON.stringify(label)});
    }`),
    // Sets the decision form's <select> on the row whose label is `rowLabel`,
    // through React's value setter so its onChange runs.
    setFormRow: async (rowLabel, value) => {
      const ok = await evaluate(`(() => {
        const label = [...document.querySelectorAll(".col-7")].find((el) => el.offsetParent !== null && el.innerText.trim() === ${JSON.stringify(rowLabel)});
        const el = label && label.parentElement.querySelector("select");
        if (!el) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
        setter.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return el.value === ${JSON.stringify(value)};
      })()`);
      assert.ok(ok, `form ${rowLabel} = ${value}`);
    },
    selectProject: async (engagementId) => {
      const ok = await evaluate(`(() => {
        const el = document.getElementById("gk-shell-project-select");
        if (!el) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
        setter.call(el, ${JSON.stringify(engagementId)});
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      })()`);
      assert.ok(ok, "project selector present");
    },
    pipelineFileText: (intakeFileId) => evaluate(`(() => {
      const el = document.querySelector('[data-pipeline-file="${intakeFileId}"]');
      return el ? el.innerText : null;
    })()`),
    // A same-origin request from this actor's real session (cookie), for the
    // direct-route negative checks.
    fetchJson: (method, path, body) => evaluate(`(async () => {
      const response = await fetch(${JSON.stringify(`${baseUrl}${path}`)}, {
        method: ${JSON.stringify(method)},
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        ${body === undefined ? "" : `body: ${JSON.stringify(JSON.stringify(body))},`}
      });
      let parsed = null;
      try { parsed = await response.json(); } catch { parsed = null; }
      return { status: response.status, errorCode: parsed?.error?.code ?? null };
    })()`),
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

  // Fresh synthetic organizations, so no smoke-seed queue row shares this
  // organization's Review Queue.
  const ORG = "00000000-0000-4000-8000-0000000000f1";
  const ORG_B = "00000000-0000-4000-8000-0000000000f2";
  const PROJECT = "7c000000-0000-4000-8000-0000000000f1";
  const BATCH = "10000000-0000-4000-8000-0000000000f1";
  const FILE_QUEUE = "20000000-0000-4000-8000-0000000000f1";
  const FILE_ZERO = "20000000-0000-4000-8000-0000000000f2";
  const NAMES = Object.freeze({ queue: "synthetic_annual_report_2025_26.csv", zero: "synthetic_programme_log_2025_26.csv" });
  const FIELD_KEYS = ["households_served", "programme_month"];
  const USERS = Object.freeze({ gkReviewer: 981, clientAdmin: 982, gkOutsider: 983, gkClientMember: 984 });

  await query(`INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES
                 ($1::uuid, 'Harbourline Synthetic Review Society', 'harbourline-synthetic-review'),
                 ($2::uuid, 'Other Synthetic Review Collective', 'other-synthetic-review')
               ON CONFLICT (organization_id) DO NOTHING`, [ORG, ORG_B]);
  await query("INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code, project_metadata) VALUES ($1::uuid, $2::uuid, 'Project Synthetic Review', '{}'::jsonb)",
    [PROJECT, ORG]);
  await query(`INSERT INTO kai.intake_batches (intake_batch_id, organization_id, engagement_id, batch_code, processing_status, review_status)
               VALUES ($1::uuid, $2::uuid, $3::uuid, 'synthetic-review-2026', 'received', 'not_reviewed')`, [BATCH, ORG, PROJECT]);
  const kaiUserIds = {};
  for (const [key, legacyId, role, global, organizations] of [
    ["gkReviewer", USERS.gkReviewer, "gk_reviewer", true, [ORG]],
    ["clientAdmin", USERS.clientAdmin, "client_admin", false, [ORG]],
    // A global GK reviewer whose only active membership is another organization.
    ["gkOutsider", USERS.gkOutsider, "gk_reviewer", true, [ORG_B]],
    // A global GK reviewer whose membership in this organization is a client role.
    ["gkClientMember", USERS.gkClientMember, ["gk_reviewer", "client_admin"], true, [ORG]],
  ]) {
    const [globalRole, membershipRole] = Array.isArray(role) ? role : [role, role];
    await query("INSERT INTO public.userdata (id) VALUES ($1) ON CONFLICT DO NOTHING", [legacyId]);
    const kaiUser = await findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: legacyId, email: `user${legacyId}@harbourline.test` });
    kaiUserIds[key] = kaiUser.user_id;
    for (const organizationId of organizations) {
      await query("INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status) VALUES ($1::uuid, $2::uuid, $3, 'active')",
        [organizationId, kaiUser.user_id, membershipRole]);
    }
    if (global) {
      await query("INSERT INTO kai.user_roles (user_id, role_id) SELECT $1::uuid, role_id FROM kai.roles WHERE role_name = $2", [kaiUser.user_id, globalRole]);
    }
  }
  const gkReviewerService = {
    actorType: "human",
    actorUserId: kaiUserIds.gkReviewer,
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

  const COCKPIT = "/api/kai/sprint2/intake/admin/review-cockpit";
  const decisionPath = (profileId, organizationId = ORG) => `${COCKPIT}/sensitivity-profiles/${profileId}/decision?organization_id=${organizationId}`;
  const reviewWorkPath = (profileId, organizationId = ORG) => `${COCKPIT}/sensitivity-profiles/${profileId}/review-work?organization_id=${organizationId}`;
  const profilePath = (profileId, organizationId = ORG) => `${COCKPIT}/sensitivity-profiles/${profileId}?organization_id=${organizationId}`;
  const pathOf = (r) => new URL(r.url).pathname;
  const posts = (requests) => requests.filter((r) => r.method === "POST").map((r) => [pathOf(r), r.status]);

  // The client boundary (the evidence-pipeline acceptance's list).
  const ALLOWED_PATHS = new Set([`${COCKPIT}/capabilities`]);
  const GK_ONLY_FRAGMENTS = ["/review-cockpit", "/evidence-library", "/claim-library", "/eligible-claims", "/traceability",
    "/review-queue", "/sources", "/client-followups", "/evidence-items", "/source-versions", "/data-dictionaries"];
  const GK_CONTROLS = ["Record decision", "Promote", "Approve", "Reject", "Submit review", "Needs more information",
    "Review sensitivity & allowed use", "Sensitivity & allowed-use review", "Review cockpit"];
  const DECISION_VALUE_LEAKS = ["reviewed_personal_data_status", "needs_more_information", "reviewed_snapshot", "allowed_use_status"];
  function assertClientBoundary(page, label, body) {
    for (const r of page.requests()) {
      const path = pathOf(r);
      if (ALLOWED_PATHS.has(path)) continue;
      for (const fragment of GK_ONLY_FRAGMENTS) assert.ok(!path.includes(fragment), `${label}: GK-only request ${r.method} ${path}`);
    }
    for (const control of GK_CONTROLS) assert.ok(!body.includes(control), `${label}: GK control visible: ${control}`);
    for (const leak of DECISION_VALUE_LEAKS) assert.ok(!body.includes(leak), `${label}: GK decision data visible: ${leak}`);
    assert.equal(page.requests().filter((r) => r.method === "POST").length, 0, `${label}: the client issues no write`);
  }

  async function governedCounts(profileId) {
    const [row] = await query(`SELECT
      (SELECT count(*) FROM kai.intake_sensitivity_review_decisions WHERE organization_id = $1::uuid AND intake_sensitivity_profile_id = $2::uuid)::int AS decisions,
      (SELECT count(*) FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'sensitivity_review' AND target_object_id = $2::uuid)::int AS sensitivity_queue,
      (SELECT count(*) FROM kai.audit_events WHERE organization_id = $1::uuid AND action = 'sensitivity_review_decision_recorded' AND actor_user_id = $3::uuid)::int AS decision_audits,
      (SELECT count(*) FROM kai.upload_lifecycle_audit a JOIN kai.intake_sensitivity_profiles p
          ON p.organization_id = a.organization_id AND p.intake_file_id = a.intake_file_id
        WHERE a.organization_id = $1::uuid AND p.intake_sensitivity_profile_id = $2::uuid AND a.operation = 'sensitivity_review_decision_recorded')::int AS lifecycle_audits,
      (SELECT count(*) FROM kai.intake_source_candidates WHERE organization_id = $1::uuid AND intake_sensitivity_profile_id = $2::uuid)::int AS source_candidates,
      (SELECT count(*) FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'source_candidate_review')::int AS source_queue,
      (SELECT count(*) FROM kai.sources WHERE organization_id = $1::uuid)::int AS sources,
      (SELECT count(*) FROM kai.source_versions WHERE organization_id = $1::uuid)::int AS source_versions,
      (SELECT count(*) FROM kai.evidence_items WHERE organization_id = $1::uuid)::int AS evidence,
      (SELECT count(*) FROM kai.claims WHERE organization_id = $1::uuid)::int AS claims`, [ORG, profileId, kaiUserIds.gkReviewer]);
    return row;
  }
  const diff = (before, after) => Object.fromEntries(Object.keys(after).map((key) => [key, after[key] - before[key]]));
  async function sensitivityQueueRow(profileId) {
    const [row] = await query(
      `SELECT review_queue_item_id::text, queue_status, review_status, updated_at FROM kai.review_queue_items
        WHERE organization_id = $1::uuid AND queue_type = 'sensitivity_review' AND target_object_id = $2::uuid`, [ORG, profileId]);
    return row || null;
  }
  async function decisionHead(profileId) {
    return query(
      `SELECT decision_outcome, decided_by::text FROM kai.intake_sensitivity_review_decisions
        WHERE organization_id = $1::uuid AND intake_sensitivity_profile_id = $2::uuid ORDER BY created_at`, [ORG, profileId]);
  }

  async function openKnowledgeStudio(page) {
    await page.goto("/impact-library");
    await page.waitForText("Knowledge Studio");
    await page.clickNav("Knowledge Studio");
    await page.waitFor(async () => page.evaluate(`Boolean(document.querySelector(".nav-tabs"))`), "Knowledge Studio tabs");
    await page.idle();
  }
  async function clientReviewsTab(page) {
    await openKnowledgeStudio(page);
    // gk_reviewer may not list Projects (list_engagement_contexts); a client may.
    await page.waitFor(async () => page.evaluate(`Boolean(document.getElementById("gk-shell-project-select"))`), "project selector");
    await page.selectProject(PROJECT);
    await page.waitFor(async () => Boolean(await page.pipelineFileText(FILE_QUEUE)), "pipeline entry");
    await page.clickTab("Reviews");
    await page.waitForText("Waiting for Get Kinder review");
    await page.idle();
    return page.text();
  }

  const gkPage = await openPage(browser, { baseUrl, legacyUserId: USERS.gkReviewer });
  const clientPage = await openPage(browser, { baseUrl, legacyUserId: USERS.clientAdmin });
  const outsiderPage = await openPage(browser, { baseUrl, legacyUserId: USERS.gkOutsider });
  const mixedPage = await openPage(browser, { baseUrl, legacyUserId: USERS.gkClientMember });
  const results = {};
  try {
    const profileQueue = await seedFreshFile(FILE_QUEUE, NAMES.queue, "a");
    const profileZero = await seedFreshFile(FILE_ZERO, NAMES.zero, "b");
    // Queue path: review work already opened earlier (the real P1-06 service),
    // so the item is on the organization's Review Queue.
    const ensured = await ensureSensitivityReviewQueueItem(
      { organizationId: ORG, intakeSensitivityProfileId: profileQueue, actorContext: gkReviewerService, now: new Date().toISOString() },
      { env: ENV, metadataOnlyAudit: noAudit() },
    );
    assert.equal(ensured.ok, true, JSON.stringify(ensured));
    const queueItemId = ensured.data.reviewQueueItem.review_queue_item_id;
    const staleQueueStamp = new Date((await sensitivityQueueRow(profileQueue)).updated_at).toISOString();

    await test("case 1: the client Reviews tab names the pending file sensitivity review, who owns it, and that this account cannot perform it - with no GK control or GK read", async () => {
      const body = await clientReviewsTab(clientPage);
      const reviews = body.slice(body.indexOf("Reviews\n"));
      console.log(`[sensitivity-review-browser] client Reviews (before):\n${reviews.slice(0, 1600)}`);
      assert.ok(body.includes(`${NAMES.queue}: Sensitivity review (Waiting for Get Kinder)`));
      assert.ok(body.includes(`${NAMES.zero}: Sensitivity review (Waiting for Get Kinder)`));
      assert.ok(body.includes("No action is currently required from you."));
      assert.ok(body.includes("Get Kinder confirms how the file's information may be used"), "the sensitivity review is explained");
      assert.ok(body.includes("This is not an Evidence or Impact Fact review."));
      assert.ok(body.includes("Get Kinder reviewers complete these reviews in Get Kinder\u2019s own review workspace"), "where it is done");
      assert.ok(body.includes("Your account does not have Get Kinder reviewer access for this organization"), "whether this user may act");
      assert.ok(!body.includes("Evidence and Impact Fact reviews are completed by Get Kinder reviewers."), "the old Evidence/Impact-Fact-only explanation is gone");
      assertClientBoundary(clientPage, "case 1", body);
      assert.deepEqual(clientPage.exceptions, []);
      results.case1_client_before = "PASS";
    });

    await test("case 2 (the regression): the GK Review Queue's sensitivity entry opens the review card on Processing", async () => {
      await openKnowledgeStudio(gkPage);
      await gkPage.clickTab("Reviews");
      await gkPage.waitForText("Sensitivity / allowed-use");
      await gkPage.waitFor(() => gkPage.visibleButton("Review sensitivity & allowed use"), "the Review Queue sensitivity entry");
      const mark = gkPage.mark();
      await gkPage.clickButton("Review sensitivity & allowed use");
      await gkPage.waitFor(() => gkPage.visibleButton("Submit review"), "the sensitivity review card's decision form", { timeout: 8000 });
      await gkPage.idle();
      assert.equal(await gkPage.activeTab(), "Processing", "the reviewer is taken to the tab that holds the card");
      const reads = gkPage.requestsSince(mark).filter((r) => r.method === "GET" && r.url.endsWith(profilePath(profileQueue)));
      assert.ok(reads.length >= 1 && reads.every((r) => r.status === 200), "the selected profile's detail was read");
      const body = await gkPage.text();
      assert.ok(body.includes("Needs review"));
      assert.ok(body.includes("open / needs_gk_review"));
      assert.ok(await gkPage.visibleButton("Needs more information"));
      assert.equal(posts(gkPage.requestsSince(mark)).length, 0, "opening the review writes nothing");
      assert.deepEqual(gkPage.exceptions, []);
      results.case2_queue_entry_opens_card = "PASS";
    });

    await test("case 3: the reviewer's 'reviewed' decision uses exactly the existing decision route, persists with audit, resolves only the sensitivity item, and promotes nothing", async () => {
      const before = await governedCounts(profileQueue);
      await gkPage.setFormRow("Personal data", "present");
      await gkPage.setFormRow("Minor data", "absent");
      const mark = gkPage.mark();
      await gkPage.clickButton("Submit review");
      await gkPage.waitForText("Review recorded.");
      await gkPage.idle();
      const since = gkPage.requestsSince(mark);
      console.log(`[sensitivity-review-browser] requests after Submit review: ${JSON.stringify(since.map((r) => [r.method, pathOf(r), r.status]))}`);
      assert.deepEqual(posts(since), [[`${COCKPIT}/sensitivity-profiles/${profileQueue}/decision`, 200]], "exactly the existing decision request");
      assert.ok(since.some((r) => r.method === "GET" && r.url.endsWith(profilePath(profileQueue)) && r.status === 200), "re-read after the decision");
      const delta = diff(before, await governedCounts(profileQueue));
      console.log(`[sensitivity-review-browser] governed delta: ${JSON.stringify(delta)}`);
      assert.deepEqual(delta, {
        decisions: 1, sensitivity_queue: 0, decision_audits: 1, lifecycle_audits: 1, source_candidates: 1, source_queue: 1,
        sources: 0, source_versions: 0, evidence: 0, claims: 0,
      });
      const queue = await sensitivityQueueRow(profileQueue);
      assert.equal(queue.review_queue_item_id, queueItemId, "the existing queue item was transitioned");
      assert.deepEqual([queue.queue_status, queue.review_status], ["resolved", "resolved"]);
      const [decision] = await decisionHead(profileQueue);
      assert.deepEqual([decision.decision_outcome, decision.decided_by], ["reviewed", kaiUserIds.gkReviewer], "decided by the human reviewer");
      const [candidate] = await query("SELECT candidate_status FROM kai.intake_source_candidates WHERE organization_id = $1::uuid AND intake_sensitivity_profile_id = $2::uuid",
        [ORG, profileQueue]);
      assert.equal(candidate.candidate_status, "needs_gk_review", "the source candidate awaits its own separate human decision");
      const body = await gkPage.text();
      assert.ok(body.includes("Reviewed"));
      assert.match(body, /Outcome\s*reviewed/);
      assert.deepEqual(gkPage.exceptions, []);
      results.case3_reviewed_decision = "PASS";
    });

    await test("case 4: a stale or unsupported decision is rejected by the existing route and persists nothing", async () => {
      const before = await governedCounts(profileQueue);
      const stale = await gkPage.fetchJson("POST", decisionPath(profileQueue), {
        expected_updated_at: staleQueueStamp, review_queue_item_id: queueItemId, decision: "needs_more_information",
      });
      assert.equal(stale.status, 409, JSON.stringify(stale));
      const unsupported = await gkPage.fetchJson("POST", decisionPath(profileQueue), {
        expected_updated_at: staleQueueStamp, review_queue_item_id: queueItemId, decision: "approved",
      });
      assert.deepEqual([unsupported.status, unsupported.errorCode], [422, "validation_blocker"], JSON.stringify(unsupported));
      assert.deepEqual(await governedCounts(profileQueue), before, "nothing persisted");
      results.case4_stale_and_unsupported = "PASS";
    });

    await test("case 5: the client sees the sensitivity review complete and the next Get Kinder stage, never the decision values", async () => {
      const body = await clientReviewsTab(clientPage);
      console.log(`[sensitivity-review-browser] client Reviews (after):\n${body.slice(body.indexOf("Waiting for Get Kinder review"), body.indexOf("Waiting for Get Kinder review") + 900)}`);
      assert.ok(body.includes(`${NAMES.queue}: Source review (Waiting for Get Kinder)`));
      assert.ok(body.includes("Get Kinder decides whether the file becomes a source that evidence can be created from."));
      assert.ok(body.includes(`${NAMES.zero}: Sensitivity review (Waiting for Get Kinder)`));
      await clientPage.clickTab("Files");
      await clientPage.waitFor(async () => Boolean(await clientPage.pipelineFileText(FILE_QUEUE)), "Files pipeline entry");
      const entry = await clientPage.pipelineFileText(FILE_QUEUE);
      assert.match(entry, /Sensitivity review\s+Complete/);
      assert.match(entry, /Source review\s+Waiting for Get Kinder/);
      assertClientBoundary(clientPage, "case 5", await clientPage.text());
      assert.deepEqual(clientPage.exceptions, []);
      results.case5_client_after = "PASS";
    });

    await test("case 6: the zero-queue file's review is opened from Files and started through the existing review-work route", async () => {
      // A gk_reviewer cannot list Projects, so Web Intake stays organization-wide:
      // load the organization's batches, then the batch's files.
      await openKnowledgeStudio(gkPage);
      assert.equal(await gkPage.activeTab(), "Files");
      await gkPage.clickButton("Load existing batches");
      await gkPage.waitForText("synthetic-review-2026");
      await gkPage.selectRow("synthetic-review-2026");
      await gkPage.idle();
      await gkPage.clickInCard("Batch files", "Load");
      await gkPage.waitForText(NAMES.zero);
      await gkPage.idle();
      await gkPage.selectRow(NAMES.zero);
      let mark = gkPage.mark();
      await gkPage.clickInCard("File status", "Refresh");
      await gkPage.waitFor(() => gkPage.visibleButton("Open sensitivity & allowed-use review"), "the Files sensitivity review entry");
      await gkPage.idle();
      assert.ok(gkPage.requestsSince(mark).some((r) => r.method === "GET" && r.url.includes(`/admin/review-cockpit/intake-files/${FILE_ZERO}/sensitivity-profile`) && r.status === 200),
        "the GK-only file lookup found the profile");
      await gkPage.clickButton("Open sensitivity & allowed-use review");
      await gkPage.waitForText("No sensitivity review work has been started for this source yet.");
      assert.equal(await gkPage.activeTab(), "Processing");
      assert.ok(gkPage.requests().some((r) => r.method === "GET" && r.url.endsWith(profilePath(profileZero)) && r.status === 200));
      assert.equal(await sensitivityQueueRow(profileZero), null, "no review work exists yet");

      const before = await governedCounts(profileZero);
      mark = gkPage.mark();
      await gkPage.clickInCard("Sensitivity & allowed-use review", "Review sensitivity & allowed use");
      await gkPage.waitFor(() => gkPage.visibleButton("Submit review"), "the decision form after review work starts");
      await gkPage.idle();
      assert.deepEqual(posts(gkPage.requestsSince(mark)), [[`${COCKPIT}/sensitivity-profiles/${profileZero}/review-work`, 201]]);
      mark = gkPage.mark();
      await gkPage.clickButton("Needs more information");
      await gkPage.waitForText("Marked as needing more information.");
      await gkPage.idle();
      assert.deepEqual(posts(gkPage.requestsSince(mark)), [[`${COCKPIT}/sensitivity-profiles/${profileZero}/decision`, 200]]);
      const delta = diff(before, await governedCounts(profileZero));
      console.log(`[sensitivity-review-browser] zero-queue governed delta: ${JSON.stringify(delta)}`);
      assert.deepEqual(delta, {
        decisions: 1, sensitivity_queue: 1, decision_audits: 1, lifecycle_audits: 1, source_candidates: 0, source_queue: 0,
        sources: 0, source_versions: 0, evidence: 0, claims: 0,
      });
      const queue = await sensitivityQueueRow(profileZero);
      assert.deepEqual([queue.queue_status, queue.review_status], ["open", "needs_gk_review"], "needs_more_information keeps the review open");
      assert.deepEqual((await decisionHead(profileZero)).map((d) => d.decision_outcome), ["needs_more_information"]);
      assert.deepEqual(gkPage.exceptions, []);
      results.case6_zero_queue_entry = "PASS";
    });

    await test("case 7: a client and a non-member GK reviewer cannot read or decide this organization's sensitivity review", async () => {
      const before = await governedCounts(profileZero);
      const queue = await sensitivityQueueRow(profileZero);
      const body = {
        expected_updated_at: new Date(queue.updated_at).toISOString(),
        review_queue_item_id: queue.review_queue_item_id,
        decision: "reviewed",
        reviewed_snapshot: {
          reviewed_personal_data_status: "absent", reviewed_minor_data_status: "absent",
          reviewed_health_housing_justice_immigration_status: "absent", reviewed_indigenous_governance_status: "absent",
          reviewed_staff_notes_status: "absent", reviewed_story_testimonial_status: "absent", reviewed_small_cell_risk_status: "absent",
          reviewed_financial_records_status: "absent", reviewed_consent_basis_status: "absent", reviewed_allowed_use_status: "unknown",
          reviewed_llm_processing_allowed: false, reviewed_product_learning_allowed: false,
          reviewed_public_use_allowed: false, reviewed_funder_use_allowed: false,
        },
      };
      await outsiderPage.goto("/impact-library");
      for (const [label, page] of [["client_admin", clientPage], ["non-member gk_reviewer", outsiderPage]]) {
        const decided = await page.fetchJson("POST", decisionPath(profileZero), body);
        assert.equal(decided.status, 403, `${label} decision: ${JSON.stringify(decided)}`);
        const work = await page.fetchJson("POST", reviewWorkPath(profileQueue));
        assert.equal(work.status, 403, `${label} review work: ${JSON.stringify(work)}`);
        const read = await page.fetchJson("GET", profilePath(profileZero));
        assert.equal(read.status, 403, `${label} profile read: ${JSON.stringify(read)}`);
      }
      // The outsider's own-organization Knowledge Studio offers nothing from this organization.
      const outsiderMark = outsiderPage.mark();
      await openKnowledgeStudio(outsiderPage);
      const outsiderBody = await outsiderPage.text();
      for (const name of Object.values(NAMES)) assert.ok(!outsiderBody.includes(name), `non-member sees no ${name}`);
      assert.ok(!outsiderPage.requestsSince(outsiderMark).some((r) => r.url.includes(ORG)), "non-member issues no request for this organization");
      assert.deepEqual(await governedCounts(profileZero), before, "nothing persisted");
      results.case7_authorization = "PASS";
    });

    await test("case 8: an AI/assistant actor and a feature-disabled service cannot record the human decision", async () => {
      const before = await governedCounts(profileZero);
      const queue = await sensitivityQueueRow(profileZero);
      const payload = {
        expected_updated_at: new Date(queue.updated_at).toISOString(),
        review_queue_item_id: queue.review_queue_item_id,
        decision: "needs_more_information",
      };
      const assistant = await submitSensitivityProfileDecision({
        organizationId: ORG, intakeSensitivityProfileId: profileZero, payload,
        actorContext: { ...gkReviewerService, actorType: "assistant" },
      }, { env: ENV });
      assert.equal(assistant.ok, false);
      assert.equal(assistant.error.code, "authorization_denied");
      const disabled = await submitSensitivityProfileDecision({
        organizationId: ORG, intakeSensitivityProfileId: profileZero, payload, actorContext: gkReviewerService,
      }, { env: { KAI_SPRINT2_ENABLED: "false" } });
      assert.equal(disabled.ok, false);
      assert.equal(disabled.error.code, "feature_disabled");
      assert.deepEqual(await governedCounts(profileZero), before, "nothing persisted");
      results.case8_ai_and_feature_gate = "PASS";
    });

    await test("case 9 (owner decision, not repaired): a global GK reviewer with a client-role membership gets the client Studio although the sensitivity routes authorize them; Reviews says so accurately", async () => {
      const before = await governedCounts(profileZero);
      const body = await clientReviewsTab(mixedPage);
      const tabs = await mixedPage.evaluate(`[...document.querySelectorAll(".nav-tabs button")].map((el) => el.innerText.trim())`);
      assert.deepEqual(tabs, ["Files", "Evidence", "Gaps", "Funder Requirements", "Generated Drafts", "Reviews"], "the client Studio, not the GK one");
      const note = await mixedPage.evaluate(`(() => { const el = document.querySelector("[data-get-kinder-review-access]"); return el ? el.innerText : null; })()`);
      console.log(`[sensitivity-review-browser] mixed-role access note: ${note}`);
      assert.match(note, /^Your Get Kinder role can complete this organization's sensitivity reviews, but your membership in this organization is not a Get Kinder membership/);
      const capabilities = mixedPage.requests().filter((r) => pathOf(r) === `/api/kai/sprint2/intake/admin/organizations/${ORG}/access-capabilities`);
      assert.ok(capabilities.length >= 1 && capabilities.every((r) => r.status === 200));
      // The existing sensitivity read route authorizes this actor (read only; nothing is decided here).
      const read = await mixedPage.fetchJson("GET", profilePath(profileZero));
      assert.equal(read.status, 200, JSON.stringify(read));
      for (const control of GK_CONTROLS) assert.ok(!body.includes(control), `no GK control rendered in the client Studio: ${control}`);
      assert.deepEqual(await governedCounts(profileZero), before, "nothing persisted");
      assert.deepEqual(mixedPage.exceptions, []);
      results.case9_mixed_role_gap = "PASS (gap demonstrated, message accurate)";
    });

    console.log(`[sensitivity-review-browser] results ${JSON.stringify(results)}`);
  } finally {
    await gkPage.close().catch(() => {});
    await clientPage.close().catch(() => {});
    await outsiderPage.close().catch(() => {});
    await mixedPage.close().catch(() => {});
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await seedPool.end();
    const { default: ambientPool } = await import("../Backend/db/pg.js");
    await ambientPool.end().catch(() => {});
  }
}
